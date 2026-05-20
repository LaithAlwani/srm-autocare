// No "use node" — fetch() is in the default Convex runtime per guidelines.

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { siteConfig } from "../config/site";

// One-liner shop address used as the in-person location for every Cal.com
// event type we create. Keep `config/site.ts` as the single source of truth.
function shopAddress(): string {
  const a = siteConfig.address;
  return `${a.street}, ${a.city}, ${a.state} ${a.zip}, ${a.country}`;
}

const CALCOM_BASE = "https://api.cal.com/v2";

// Each Cal.com v2 endpoint pins to its own version — they don't share one.
// Slots: 2024-09-04 (older versions don't have /v2/slots and 404).
// Bookings: 2024-08-13.
function authHeaders(version: string): Record<string, string> {
  const apiKey = process.env.CALCOM_API_KEY;
  if (!apiKey) throw new Error("CALCOM_API_KEY is not set");
  return {
    Authorization: `Bearer ${apiKey}`,
    "cal-api-version": version,
    "Content-Type": "application/json",
  };
}

// Build the array of allowed booking lengths for a service's event type.
// Customers can stack add-ons that lengthen the appointment, so each event
// type exposes a 15-minute-stepped range from the base service duration up
// to base + MAX_ADDON_BUFFER_MINUTES. Cal.com uses these when blocking
// subsequent slots so longer bookings don't get overlapped.
const MAX_ADDON_BUFFER_MINUTES = 240;
function durationOptions(baseMinutes: number): number[] {
  const opts: number[] = [];
  for (let d = baseMinutes; d <= baseMinutes + MAX_ADDON_BUFFER_MINUTES; d += 15) {
    opts.push(d);
  }
  return opts;
}

// How often Cal.com offers a slot start time, in minutes. When unset Cal.com
// defaults this to the event's duration, which causes phantom gaps right
// after non-hour-aligned bookings (e.g. a 1:00-2:30 booking would block 2:30
// because the 60-min event only considers 2:00 and 3:00 as candidates).
// 30 minutes keeps the slot grid uncluttered while still resolving the
// :30-aligned boundaries that mixed service + add-on lengths produce.
// Trade-off: a booking ending on a :15 or :45 boundary leaves up to 15
// minutes idle until the next slot opens.
const SLOT_INTERVAL_MINUTES = 30;

// Round a desired length up to the nearest entry in `durationOptions` so we
// can always hand Cal.com a value it accepts. Add-ons are 15-minute-rounded
// in admin so this is usually a no-op, but it guards against drift.
export function snapDurationToOption(baseMinutes: number, desired: number): number {
  const opts = durationOptions(baseMinutes);
  for (const opt of opts) if (opt >= desired) return opt;
  return opts[opts.length - 1];
}

// Resolves the Cal.com event type ID for a service, falling back to the
// CALCOM_EVENT_TYPE_ID env var when the service hasn't been linked to a
// specific event type. Throws if neither is configured.
function resolveEventTypeId(serviceCalcomEventTypeId: number | undefined | null): number {
  if (typeof serviceCalcomEventTypeId === "number") return serviceCalcomEventTypeId;
  const fallback = process.env.CALCOM_EVENT_TYPE_ID;
  if (!fallback) {
    throw new Error(
      "No Cal.com event type configured for this service. Set one on the service in /admin/services or set CALCOM_EVENT_TYPE_ID as a fallback.",
    );
  }
  return Number(fallback);
}

// Recreates a Cal.com event type for a service whose stored ID no longer
// exists in Cal.com (manual deletion is the usual cause). Patches the
// service row with the new ID and returns it. Only called from the slot
// lookups as part of the 404 self-heal path — we don't try to repair the
// service from elsewhere because the booking flow is the only customer-
// visible surface that should never go down.
async function rehealEventType(
  ctx: ActionCtx,
  service: Doc<"services">,
): Promise<number> {
  const { eventTypeId } = await ctx.runAction(internal.calcom.createEventTypeInternal, {
    title: service.name,
    slug: service.slug,
    lengthInMinutes: service.durationMinutes,
    description: service.description,
  });
  await ctx.runMutation(internal.services.setCalcomEventTypeIdInternal, {
    id: service._id as Id<"services">,
    calcomEventTypeId: eventTypeId,
  });
  return eventTypeId;
}

// One slots fetch — returns parsed body or throws a 404-tagged error so the
// caller can decide whether to heal-and-retry.
async function fetchSlots(
  eventTypeId: number,
  startISO: string,
  endISO: string,
  duration: number,
): Promise<Record<string, Array<{ start: string }>>> {
  const url = new URL(`${CALCOM_BASE}/slots`);
  url.searchParams.set("eventTypeId", String(eventTypeId));
  url.searchParams.set("start", startISO);
  url.searchParams.set("end", endISO);
  url.searchParams.set("duration", String(duration));

  const res = await fetch(url, { headers: authHeaders("2024-09-04") });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Cal.com slots failed: ${res.status} ${body}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as { data?: Record<string, Array<{ start: string }>> };
  return json.data ?? {};
}

// PUBLIC: list available slots for a given service + day. Used by /book.
// `totalDurationMinutes` lets the booking flow ask for slots that have
// enough consecutive free time for the service PLUS any selected add-ons —
// Cal.com filters out shorter windows so customers can't book a 90-min
// detail into a slot with only 60 minutes of breathing room.
// Returns ISO8601 strings the client converts to local time.
export const listSlots = action({
  args: {
    serviceId: v.id("services"),
    dateISO: v.string(),
    totalDurationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");
    let eventTypeId = resolveEventTypeId(service.calcomEventTypeId);
    const duration =
      args.totalDurationMinutes !== undefined
        ? snapDurationToOption(service.durationMinutes, args.totalDurationMinutes)
        : service.durationMinutes;

    const start = new Date(args.dateISO);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    // Response shape (2024-09-04): { data: { "YYYY-MM-DD": [{ start }] } }
    // Cal.com is the single source of truth for availability — confirmed
    // bookings are pushed to Cal.com after Square confirms payment.
    let data: Record<string, Array<{ start: string }>>;
    try {
      data = await fetchSlots(eventTypeId, startISO, endISO, duration);
    } catch (err) {
      // If the event type ID we have on file no longer exists in Cal.com
      // (admin deleted it directly), heal once: recreate the event type
      // from the service definition, patch the row, retry. We only heal
      // when the service had its own ID — never for the env fallback.
      const status = (err as { status?: number }).status;
      if (status === 404 && typeof service.calcomEventTypeId === "number") {
        eventTypeId = await rehealEventType(ctx, service);
        data = await fetchSlots(eventTypeId, startISO, endISO, duration);
      } else {
        throw err;
      }
    }
    const day = data[args.dateISO.slice(0, 10)] ?? [];
    return day.map((slot) => slot.start);
  },
});

// INTERNAL: create a Cal.com event type. Returns the new event type's id so
// the caller can stamp it onto the service row. We pre-configure the custom
// booking fields ("vehicle", "notes") that our booking flow expects to be
// present, so the admin doesn't have to add them in Cal.com manually.
export const createEventTypeInternal = internalAction({
  args: {
    title: v.string(),
    slug: v.string(),
    lengthInMinutes: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<{ eventTypeId: number }> => {
    const res = await fetch(`${CALCOM_BASE}/event-types`, {
      method: "POST",
      headers: authHeaders("2024-06-14"),
      body: JSON.stringify({
        title: args.title,
        slug: args.slug,
        lengthInMinutes: args.lengthInMinutes,
        // Allow longer booking lengths so customers can stack add-ons that
        // extend the appointment. Cal.com uses these when listing slots and
        // creating bookings, and respects the chosen length when blocking
        // subsequent overlap.
        lengthInMinutesOptions: durationOptions(args.lengthInMinutes),
        slotInterval: SLOT_INTERVAL_MINUTES,
        ...(args.description ? { description: args.description } : {}),
        // In-person at the shop. `public: true` shows the address on the
        // booking confirmation so the customer knows where to go.
        locations: [
          {
            type: "address",
            address: shopAddress(),
            public: true,
          },
        ],
        bookingFields: [
          {
            type: "text",
            slug: "vehicle",
            label: "Vehicle (year, make, model, color)",
            placeholder: "e.g. 2024 Porsche 911 GT3 — Guards Red",
            required: true,
          },
          {
            type: "textarea",
            slug: "notes",
            label: "Notes",
            placeholder:
              "Anything we should know about the vehicle's condition or your goals.",
            required: false,
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cal.com create event type failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as { data?: { id?: number } };
    if (!json.data?.id) throw new Error("Cal.com did not return an event type id");
    return { eventTypeId: json.data.id };
  },
});

// INTERNAL: keep a Cal.com event type in sync with the service row when the
// admin edits its name / duration / description. Other fields (booking
// fields, availability, etc.) are managed in Cal.com's UI.
export const updateEventTypeInternal = internalAction({
  args: {
    eventTypeId: v.number(),
    title: v.optional(v.string()),
    lengthInMinutes: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<void> => {
    const body: Record<string, unknown> = {};
    if (args.title !== undefined) body.title = args.title;
    if (args.lengthInMinutes !== undefined) {
      body.lengthInMinutes = args.lengthInMinutes;
      // Re-derive the allowed lengths from the new base so add-ons keep
      // working after the admin changes the service duration.
      body.lengthInMinutesOptions = durationOptions(args.lengthInMinutes);
    }
    if (args.description !== undefined) body.description = args.description;
    // Always reassert slotInterval — pre-existing event types created before
    // we set this default would otherwise keep their old (duration-aligned)
    // interval forever. Cheap to send every time, and lets the repair action
    // call this with no other fields just to fix the interval.
    body.slotInterval = SLOT_INTERVAL_MINUTES;

    const res = await fetch(`${CALCOM_BASE}/event-types/${args.eventTypeId}`, {
      method: "PATCH",
      headers: authHeaders("2024-06-14"),
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) {
      const errBody = await res.text();
      throw new Error(`Cal.com update event type failed: ${res.status} ${errBody}`);
    }
  },
});

// INTERNAL: delete a Cal.com event type. Idempotent — 404 is treated as success.
export const deleteEventTypeInternal = internalAction({
  args: { eventTypeId: v.number() },
  handler: async (_ctx, args): Promise<void> => {
    const res = await fetch(`${CALCOM_BASE}/event-types/${args.eventTypeId}`, {
      method: "DELETE",
      headers: authHeaders("2024-06-14"),
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Cal.com delete event type failed: ${res.status} ${body}`);
    }
  },
});

// PUBLIC: scans Cal.com for the next day that has at least one available slot
// for this service. Used by the booking page to auto-select the nearest open
// date so the customer isn't dropped on an empty grid. Returns the date as
// `YYYY-MM-DD` (Cal.com's response keys), or null if nothing in the window.
export const findNextAvailableDate = action({
  args: {
    serviceId: v.id("services"),
    withinDays: v.optional(v.number()),
    totalDurationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");
    let eventTypeId = resolveEventTypeId(service.calcomEventTypeId);
    const duration =
      args.totalDurationMinutes !== undefined
        ? snapDurationToOption(service.durationMinutes, args.totalDurationMinutes)
        : service.durationMinutes;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + (args.withinDays ?? 30));
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    let data: Record<string, Array<{ start: string }>>;
    try {
      data = await fetchSlots(eventTypeId, startISO, endISO, duration);
    } catch (err) {
      // Same self-heal as listSlots — covered both paths because either may
      // be the first call after the event type goes missing.
      const status = (err as { status?: number }).status;
      if (status === 404 && typeof service.calcomEventTypeId === "number") {
        eventTypeId = await rehealEventType(ctx, service);
        data = await fetchSlots(eventTypeId, startISO, endISO, duration);
      } else {
        throw err;
      }
    }
    // Response keys are date strings; iterate in sorted order and return the
    // first one whose array is non-empty (Cal.com already filters past slots).
    const days = Object.keys(data).sort();
    for (const day of days) {
      if ((data[day]?.length ?? 0) > 0) return day;
    }
    return null;
  },
});

// INTERNAL: cancel an existing Cal.com booking. Cal.com emails the customer
// the cancellation. Idempotent — Cal.com returns 400/404 if it's already
// cancelled, which we treat as success.
export const cancelBookingInternal = internalAction({
  args: {
    bookingUid: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<void> => {
    const res = await fetch(
      `${CALCOM_BASE}/bookings/${args.bookingUid}/cancel`,
      {
        method: "POST",
        headers: authHeaders("2024-08-13"),
        body: JSON.stringify({
          cancellationReason: args.reason ?? "Cancelled by admin",
        }),
      },
    );
    if (!res.ok && res.status !== 400 && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Cal.com cancel failed: ${res.status} ${body}`);
    }
  },
});

// INTERNAL: reschedule an existing Cal.com booking to a new start time.
// Cal.com will email the customer with the updated invite. The webhook
// (BOOKING_RESCHEDULED) fires back to /calcom/webhook which updates our row.
export const rescheduleBookingInternal = internalAction({
  args: {
    bookingUid: v.string(),
    slotStartISO: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<void> => {
    const res = await fetch(
      `${CALCOM_BASE}/bookings/${args.bookingUid}/reschedule`,
      {
        method: "POST",
        headers: authHeaders("2024-08-13"),
        body: JSON.stringify({
          start: args.slotStartISO,
          reschedulingReason: args.reason ?? "Rescheduled by admin",
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cal.com reschedule failed: ${res.status} ${body}`);
    }
  },
});

// INTERNAL: actually creates a booking in Cal.com after Square confirms payment.
// Called from the webhook handler in http.ts which provides the resolved eventTypeId.
export const createBookingInternal = internalAction({
  args: {
    eventTypeId: v.number(),
    slotStartISO: v.string(),
    // Optional override; when omitted Cal.com uses the event type's default
    // length. Pass this when the appointment has been extended by add-ons.
    lengthInMinutes: v.optional(v.number()),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<string> => {
    const res = await fetch(`${CALCOM_BASE}/bookings`, {
      method: "POST",
      headers: authHeaders("2024-08-13"),
      body: JSON.stringify({
        eventTypeId: args.eventTypeId,
        start: args.slotStartISO,
        ...(args.lengthInMinutes !== undefined
          ? { lengthInMinutes: args.lengthInMinutes }
          : {}),
        attendee: {
          name: args.customerName,
          email: args.customerEmail,
          timeZone: "America/New_York",
          phoneNumber: args.customerPhone,
          language: "en",
        },
        bookingFieldsResponses: {
          vehicle: args.vehicleInfo,
          notes: args.notes ?? "",
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cal.com create booking failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as { data?: { id?: number; uid?: string } };
    return json.data?.uid ?? String(json.data?.id ?? "");
  },
});
