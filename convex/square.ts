// No "use node" needed — Square is HTTP-only and fetch() is available in
// Convex's default V8 runtime per the project guidelines.

import { v } from "convex/values";
import { action, internalAction, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { computeDepositCents } from "../lib/booking";
import { SLOT_COLLISION_ERROR } from "./bookings";

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

// PUBLIC: read-only handshake the booking page does on mount of the Payment
// step. Returns the public SDK configuration the Web Payments SDK needs to
// initialize. No DB write — the row only exists after Square approves the
// charge. Frontend generates its own idempotency key (UUID), which Square
// dedupes server-side, so a Pay button double-click can't double-charge.
export const getSquareConfig = query({
  args: {},
  handler: async (): Promise<{
    applicationId: string;
    locationId: string;
    environment: SquareEnvironment;
  }> => {
    return {
      applicationId: requireApplicationId(),
      locationId: requireLocationId(),
      environment: squareEnv(),
    };
  },
});

// PUBLIC: the entire booking pipeline in one action. Takes the full booking
// payload + the freshly-tokenized card source, hits Square's /payments
// endpoint, and ONLY on a successful charge inserts the booking row with
// status=confirmed/paid. No more pre-flight draft rows blocking slots while
// a customer abandons checkout.
//
// Failure semantics:
//   - Service inactive / add-ons missing / slot taken → throws before
//     charging; the customer's card is never touched.
//   - Square declines → throws with a friendly error; no booking row
//     created.
//   - Square charges, our insert mutation fails (extremely rare, Convex
//     outage mid-action) → customer is charged but no booking exists;
//     they get an error, admin reconciles from the Square dashboard.
//
// The squareIdempotencyKey check on the insert is the safety net for
// action retries — calling this twice with the same key reuses the
// existing row instead of double-booking.
export const confirmAndCharge = action({
  args: {
    idempotencyKey: v.string(),
    sourceId: v.string(),
    serviceId: v.id("services"),
    slotStart: v.number(),
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
  ): Promise<{ ok: true; bookingId: Id<"bookings">; idempotencyKey: string }> => {
    // Idempotency short-circuit: if a previous call with the same key
    // already landed a booking, return it. Prevents action retries from
    // creating duplicates.
    const existing = await ctx.runQuery(
      internal.bookings.getInternalBySquareIdempotency,
      { idempotencyKey: args.idempotencyKey },
    );
    if (existing) {
      return {
        ok: true,
        bookingId: existing._id,
        idempotencyKey: args.idempotencyKey,
      };
    }

    // 1. Validate service + resolve add-ons server-side (price integrity).
    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");
    if (!service.active) throw new Error("Service is not bookable");

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

    const totalCents = service.priceFromCents + addOnsTotalCents;
    const depositCents = computeDepositCents(totalCents);
    const slotEnd =
      args.slotStart + (service.durationMinutes + addOnsTotalMinutes) * 60 * 1000;

    // 2. Slot collision check. Race-window between two simultaneous bookers
    //    is wafer-thin for a single-shop app but cheap to guard against.
    const taken = await ctx.runQuery(internal.bookings.slotIsTaken, {
      slotStart: args.slotStart,
      slotEnd,
    });
    if (taken) {
      throw new Error(
        "Sorry, that time slot was just booked by someone else. Please pick another time.",
      );
    }

    // 3. Charge Square. Errors here throw and the customer's card is not
    //    debited (Square only debits on approval).
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
      amount_money: { amount: depositCents, currency: "CAD" },
      location_id: requireLocationId(),
      reference_id: args.idempotencyKey,
      note: `SRM Auto Care deposit — ${args.idempotencyKey}`,
      autocomplete: true,
    });

    const payment = response.payment;
    if (!payment?.id) {
      throw new Error("Square /payments returned no payment");
    }
    // COMPLETED = autocomplete card charge; APPROVED = pre-capture (we
    // don't use that mode but accept it in case Square's behavior shifts).
    const status = payment.status ?? "";
    if (status !== "COMPLETED" && status !== "APPROVED") {
      throw new Error(`Square payment is in unexpected state: ${status}`);
    }

    // 4. Insert the booking with confirmed status. The mutation does a
    //    final serializable slot-collision check; if it throws the
    //    tagged collision error we auto-refund the just-completed
    //    Square charge so the customer isn't charged for a slot that
    //    raced out from under them.
    let id: Id<"bookings">;
    let isNew: boolean;
    try {
      const result = await ctx.runMutation(
        internal.bookings.createConfirmedInternal,
        {
          squareIdempotencyKey: args.idempotencyKey,
          squarePaymentId: payment.id,
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
        },
      );
      id = result.id;
      isNew = result.isNew;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(SLOT_COLLISION_ERROR)) {
        // Race lost — refund the Square charge and surface a friendly
        // error. We use the action-level helper so the refund stays a
        // single source of truth.
        try {
          await squareRequest("/refunds", {
            idempotency_key: `srm-collision-refund-${args.idempotencyKey}`.slice(0, 45),
            payment_id: payment.id,
            amount_money: { amount: depositCents, currency: "CAD" },
            reason: "Slot was booked by another customer simultaneously",
          });
        } catch (refundErr) {
          // If the auto-refund itself fails, log loudly — admin needs
          // to manually refund. Customer still gets the error message
          // below; their card is charged until admin reconciles.
          console.error(
            `[square confirm] Auto-refund FAILED for orphan payment ${payment.id} (collision). Manual refund needed.`,
            refundErr,
          );
        }
        throw new Error(
          "Sorry, that time slot was just booked by someone else. Your card has been refunded — please pick another time.",
        );
      }
      // Non-collision error after a successful charge. Customer is
      // charged but no booking exists — log for admin reconciliation.
      console.error(
        `[square confirm] Insert failed AFTER Square charged ${payment.id} (ref ${args.idempotencyKey}). Manual reconciliation needed.`,
        err,
      );
      throw err;
    }

    // 5. Fan out the post-booking side effects on the first insert only.
    if (isNew) {
      await dispatchPostBooking(ctx, id);
    }

    return { ok: true, bookingId: id, idempotencyKey: args.idempotencyKey };
  },
});

// Helper: fires every side effect that follows a freshly-confirmed
// booking — customer email, owner notification, and a best-effort
// Google Calendar push. All three run in parallel and any individual
// failure is swallowed (logged) so the payment-cleared response back
// to the customer is never blocked by a downstream hiccup.
async function dispatchPostBooking(
  ctx: { runAction: any; runMutation: any },
  bookingId: Id<"bookings">,
): Promise<void> {
  const [, , gcalResult] = await Promise.allSettled([
    ctx.runAction(internal.emails.sendBookingConfirmation, { bookingId }),
    ctx.runAction(internal.emails.sendOwnerBookingNotification, { bookingId }),
    ctx.runAction(internal.googleCalendar.createEventInternal, { bookingId }),
  ]);
  if (gcalResult.status === "fulfilled" && typeof gcalResult.value === "string") {
    await ctx.runMutation(internal.bookings.setGoogleCalendarEventId, {
      bookingId,
      googleCalendarEventId: gcalResult.value,
    });
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
