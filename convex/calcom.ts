// No "use node" — fetch() is in the default Convex runtime per guidelines.

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api } from "./_generated/api";

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
    // are pushed to Cal.com from the Stripe webhook, so it knows about all of them.
    const json = (await res.json()) as { data?: Record<string, Array<{ start: string }>> };
    const day = json.data?.[args.dateISO.slice(0, 10)] ?? [];
    return day.map((slot) => slot.start);
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

// INTERNAL: actually creates a booking in Cal.com after Stripe confirms payment.
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
