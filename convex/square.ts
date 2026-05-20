// No "use node" needed — Square is HTTP-only and fetch() is available in
// Convex's default V8 runtime per the project guidelines.

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { computeDepositCents } from "../lib/booking";

// Square's REST API base URLs. We choose between them based on
// NEXT_PUBLIC_SQUARE_ENVIRONMENT, which is also what the frontend reads when
// it instantiates the Web Payments SDK — keeping the variable client-readable
// means the two halves of the integration can never silently drift apart.
const SANDBOX_BASE = "https://connect.squareupsandbox.com/v2";
const PRODUCTION_BASE = "https://connect.squareup.com/v2";
// Pin the Square API version we tested against. Square enforces forward
// compatibility but new fields aren't returned for older versions, so we
// won't accidentally start parsing fields that don't exist yet.
const SQUARE_API_VERSION = "2024-10-17";

type SquareEnvironment = "sandbox" | "production";

function squareEnv(): SquareEnvironment {
  const raw = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "sandbox";
  return raw === "production" ? "production" : "sandbox";
}

function squareBase(): string {
  return squareEnv() === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
}

function requireAccessToken(): string {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN is not set");
  return token;
}

function requireLocationId(): string {
  // Square's payments endpoint requires a location_id and the SDK on the
  // frontend needs the same one. We deliberately use the NEXT_PUBLIC_ var
  // here so the same value is read by both halves — there's no separate
  // server-side SQUARE_LOCATION_ID. Convex exposes NEXT_PUBLIC_* env vars
  // to actions just like Node would.
  const id = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!id) throw new Error("NEXT_PUBLIC_SQUARE_LOCATION_ID is not set");
  return id;
}

function requireApplicationId(): string {
  const id = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID;
  if (!id) throw new Error("NEXT_PUBLIC_SQUARE_APPLICATION_ID is not set");
  return id;
}

// Centralized Square REST call. Returns the parsed JSON body on success and
// throws with Square's `errors[]` payload on failure so callers get a
// debuggable message instead of "500 Internal Server Error".
async function squareRequest<TResponse>(
  path: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  const res = await fetch(`${squareBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireAccessToken()}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_API_VERSION,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Square's error responses always include `errors: [{ code, detail, ... }]`.
    // Surface the first one so logs are scannable; fall back to raw text.
    try {
      const parsed = JSON.parse(text) as {
        errors?: Array<{ code?: string; detail?: string }>;
      };
      const first = parsed.errors?.[0];
      const detail = first?.detail ?? text;
      const code = first?.code ?? String(res.status);
      throw new Error(`Square ${path} failed (${code}): ${detail}`);
    } catch (parseErr) {
      // If text isn't JSON, surface the raw response.
      if (parseErr instanceof Error && parseErr.message.startsWith("Square")) throw parseErr;
      throw new Error(`Square ${path} failed: ${res.status} ${text}`);
    }
  }
  return JSON.parse(text) as TResponse;
}

// PUBLIC: writes a draft booking row keyed by a freshly-generated idempotency
// key, then returns everything the frontend needs to mount Square's Web
// Payments SDK and complete the charge. The draft is what guarantees we have
// somewhere to look the booking up by when the payment.updated webhook
// arrives — same defense-in-depth pattern any synchronous-charge flow uses.
export const createDraftBooking = action({
  args: {
    serviceId: v.id("services"),
    slotStart: v.number(),
    slotEnd: v.number(),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
    // Add-on IDs selected by the customer. We re-fetch the rows server-side
    // so the client can't tamper with prices/durations.
    addOnIds: v.optional(v.array(v.id("addOns"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    idempotencyKey: string;
    depositCents: number;
    applicationId: string;
    locationId: string;
    environment: SquareEnvironment;
  }> => {
    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");
    if (!service.active) throw new Error("Service is not bookable");

    // Resolve add-on IDs to authoritative server-side rows so we can trust
    // the prices + durations. Build snapshots for the booking row.
    const addOnRows =
      args.addOnIds && args.addOnIds.length > 0
        ? await ctx.runQuery(internal.addOns.getMany, { ids: args.addOnIds })
        : [];
    const selectedAddOns = addOnRows.map((row) => ({
      id: row._id,
      name: row.name,
      priceCents: row.priceCents,
      durationMinutes: row.durationMinutes,
    }));
    const addOnsTotalCents = selectedAddOns.reduce((sum, a) => sum + a.priceCents, 0);
    const addOnsTotalMinutes = selectedAddOns.reduce(
      (sum, a) => sum + a.durationMinutes,
      0,
    );

    // Square accepts idempotency keys up to 45 chars. `srm-` + a UUID (36
    // chars without hyphens collapsed; 40 with hyphens) fits cleanly.
    const idempotencyKey = `srm-${crypto.randomUUID()}`.slice(0, 45);
    // Deposit is a fixed fraction (33%) of the full appointment total —
    // service price plus every selected add-on. Computed server-side so the
    // client can never short-pay by tampering with the value.
    const totalCents = service.priceFromCents + addOnsTotalCents;
    const depositCents = computeDepositCents(totalCents);
    // Recompute slot end from total duration so it's authoritative server-side.
    const slotEnd =
      args.slotStart + (service.durationMinutes + addOnsTotalMinutes) * 60 * 1000;

    await ctx.runMutation(internal.bookings.createDraft, {
      squareIdempotencyKey: idempotencyKey,
      serviceId: args.serviceId,
      slotStart: args.slotStart,
      slotEnd,
      customerName: args.customerName,
      customerEmail: args.customerEmail,
      customerPhone: args.customerPhone,
      vehicleInfo: args.vehicleInfo,
      notes: args.notes,
      depositAmountCents: depositCents,
      selectedAddOns: selectedAddOns.length > 0 ? selectedAddOns : undefined,
    });

    return {
      idempotencyKey,
      depositCents,
      applicationId: requireApplicationId(),
      locationId: requireLocationId(),
      environment: squareEnv(),
    };
  },
});

// PUBLIC: called by the frontend once it has tokenized the card via Square's
// Web Payments SDK. We charge synchronously and confirm the booking in one
// hop. The webhook is only there as defense-in-depth for the rare tab-close
// window between Square approving and this action returning.
export const confirmAndCharge = action({
  args: {
    idempotencyKey: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true; bookingId: Id<"bookings"> }> => {
    const draft = await ctx.runQuery(internal.bookings.getInternalBySquareIdempotency, {
      idempotencyKey: args.idempotencyKey,
    });
    if (!draft) {
      throw new Error(`No draft booking for idempotency key ${args.idempotencyKey}`);
    }
    // If a prior call already settled this, short-circuit so a double-click
    // doesn't double-charge. Same idempotency story Square enforces server-
    // side, just one round-trip earlier.
    if (draft.paymentStatus === "paid" && draft.squarePaymentId) {
      return { ok: true, bookingId: draft._id };
    }

    type SquarePayment = {
      payment?: {
        id?: string;
        status?: string;
        amount_money?: { amount?: number; currency?: string };
      };
    };
    const response = await squareRequest<SquarePayment>("/payments", {
      source_id: args.sourceId,
      idempotency_key: args.idempotencyKey,
      amount_money: {
        amount: draft.depositAmountCents,
        currency: "CAD",
      },
      location_id: requireLocationId(),
      reference_id: args.idempotencyKey,
      note: `SRM Auto Care deposit — ${args.idempotencyKey}`,
      autocomplete: true,
    });

    const payment = response.payment;
    if (!payment?.id) {
      throw new Error("Square /payments returned no payment");
    }
    // Square uses COMPLETED for autocompleted card payments. APPROVED is the
    // pre-capture status; we don't use delayed capture so we never expect it,
    // but we accept it just in case Square's behavior shifts.
    const status = payment.status ?? "";
    if (status !== "COMPLETED" && status !== "APPROVED") {
      throw new Error(`Square payment is in unexpected state: ${status}`);
    }
    const amountCents = payment.amount_money?.amount ?? draft.depositAmountCents;

    const { id, isNew } = await ctx.runMutation(internal.bookings.confirmFromPayment, {
      idempotencyKey: args.idempotencyKey,
      squarePaymentId: payment.id,
      amountCents,
    });

    if (isNew) {
      await placeCalcomBooking(ctx, id);
    }

    return { ok: true, bookingId: id };
  },
});

// Helper: fires the Cal.com booking once we know payment is confirmed.
// Failures are logged but never re-thrown — payment has already been
// captured at this point and admin can reconcile manually if Cal.com is down.
async function placeCalcomBooking(
  ctx: { runQuery: any; runAction: any; runMutation: any },
  bookingId: Id<"bookings">,
): Promise<void> {
  try {
    const data = await ctx.runQuery(internal.bookings.getForCalcomDispatch, {
      bookingId,
    });
    if (!data) return;
    const eventTypeId =
      data.service?.calcomEventTypeId ?? Number(process.env.CALCOM_EVENT_TYPE_ID);
    if (!eventTypeId || !Number.isFinite(eventTypeId)) {
      console.error(
        `No Cal.com event type configured for service ${data.booking.serviceId} — booking saved without calendar entry`,
      );
      return;
    }
    // Derive total appointment length from slotEnd - slotStart so Cal.com
    // blocks subsequent slots for the full add-on-extended duration.
    const totalMinutes = Math.max(
      1,
      Math.round((data.booking.slotEnd - data.booking.slotStart) / 60000),
    );
    const calComBookingId: string = await ctx.runAction(
      internal.calcom.createBookingInternal,
      {
        eventTypeId,
        slotStartISO: new Date(data.booking.slotStart).toISOString(),
        lengthInMinutes: totalMinutes,
        customerName: data.booking.customerName,
        customerEmail: data.booking.customerEmail,
        customerPhone: data.booking.customerPhone,
        vehicleInfo: data.booking.vehicleInfo,
        notes: data.booking.notes,
      },
    );
    await ctx.runMutation(internal.bookings.setCalcomBookingId, {
      bookingId,
      calComBookingId,
    });
  } catch (err) {
    console.error("Cal.com booking failed (booking is paid; admin can reconcile)", err);
  }
}

// INTERNAL: hits Square's /refunds endpoint for an existing payment. Returns
// the refunded amount so the caller (bookings.adminRefund / the webhook) can
// patch the booking row. Throws on declines so we never mark something as
// refunded that Square refused.
export const createRefundInternal = internalAction({
  args: {
    squarePaymentId: v.string(),
    amountCents: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<{ refundedCents: number }> => {
    type SquareRefund = {
      refund?: {
        id?: string;
        status?: string;
        amount_money?: { amount?: number; currency?: string };
      };
    };
    const response = await squareRequest<SquareRefund>("/refunds", {
      idempotency_key: `srm-refund-${crypto.randomUUID()}`.slice(0, 45),
      payment_id: args.squarePaymentId,
      amount_money: {
        amount: args.amountCents,
        currency: "CAD",
      },
      ...(args.reason ? { reason: args.reason.slice(0, 192) } : {}),
    });
    const refund = response.refund;
    // Square returns PENDING for card refunds (settles overnight) and
    // COMPLETED for cash equivalents. PENDING is the happy path for our
    // use case — money is committed even if the bank takes a day to settle.
    const status = refund?.status ?? "";
    if (status !== "PENDING" && status !== "COMPLETED" && status !== "APPROVED") {
      throw new Error(`Square refund is in unexpected state: ${status}`);
    }
    const refundedCents = refund?.amount_money?.amount ?? args.amountCents;
    return { refundedCents };
  },
});
