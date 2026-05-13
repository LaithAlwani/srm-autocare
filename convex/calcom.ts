// No "use node" — fetch() is in the default Convex runtime per guidelines.

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api } from "./_generated/api";
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

// PUBLIC: list available slots for a given service + day. Used by /book step 2.
// Returns ISO8601 strings the client converts to local time.
export const listSlots = action({
  args: { serviceId: v.id("services"), dateISO: v.string() },
  handler: async (ctx, args): Promise<string[]> => {
    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");
    const eventTypeId = resolveEventTypeId(service.calcomEventTypeId);

    const start = new Date(args.dateISO);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const url = new URL(`${CALCOM_BASE}/slots`);
    url.searchParams.set("eventTypeId", String(eventTypeId));
    url.searchParams.set("start", start.toISOString());
    url.searchParams.set("end", end.toISOString());

    const res = await fetch(url, { headers: authHeaders("2024-09-04") });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cal.com slots failed: ${res.status} ${body}`);
    }
    // Response shape (2024-09-04): { status: "success", data: { "YYYY-MM-DD": [{ start }] } }
    // Cal.com is the single source of truth for availability — confirmed bookings
    // are pushed to Cal.com after Moneris confirms payment, so it knows about all of them.
    const json = (await res.json()) as { data?: Record<string, Array<{ start: string }>> };
    const day = json.data?.[args.dateISO.slice(0, 10)] ?? [];
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
    if (args.lengthInMinutes !== undefined) body.lengthInMinutes = args.lengthInMinutes;
    if (args.description !== undefined) body.description = args.description;
    if (Object.keys(body).length === 0) return;

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
  },
  handler: async (ctx, args): Promise<string | null> => {
    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");
    const eventTypeId = resolveEventTypeId(service.calcomEventTypeId);

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + (args.withinDays ?? 30));

    const url = new URL(`${CALCOM_BASE}/slots`);
    url.searchParams.set("eventTypeId", String(eventTypeId));
    url.searchParams.set("start", start.toISOString());
    url.searchParams.set("end", end.toISOString());

    const res = await fetch(url, { headers: authHeaders("2024-09-04") });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cal.com slots failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as {
      data?: Record<string, Array<{ start: string }>>;
    };
    // Response keys are date strings; iterate in sorted order and return the
    // first one whose array is non-empty (Cal.com already filters past slots).
    const days = Object.keys(json.data ?? {}).sort();
    for (const day of days) {
      if ((json.data?.[day]?.length ?? 0) > 0) return day;
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

// INTERNAL: actually creates a booking in Cal.com after Moneris confirms payment.
// Called from the webhook handler in http.ts which provides the resolved eventTypeId.
export const createBookingInternal = internalAction({
  args: {
    eventTypeId: v.number(),
    slotStartISO: v.string(),
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
