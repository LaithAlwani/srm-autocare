import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// Mounts /.well-known/openid-configuration, /api/auth/signin/*, etc.
auth.addHttpRoutes(http);

// Square webhook — optional defense-in-depth handler. The happy path is
// that the customer pays, our confirmAndCharge action in square.ts confirms
// the booking synchronously, and this webhook is a no-op. It catches:
//
//   - Customers who close the tab between Square approving and our
//     confirmAndCharge returning. The `payment.updated` event arrives later
//     and promotes the draft via the same idempotent mutation.
//   - Refunds initiated directly inside the Square Dashboard (admin Refund
//     button updates the row synchronously; this catches the out-of-band case).
//
// Configure in Square Developer Dashboard → Webhook Subscriptions:
//   Notification URL  https://<convex-site-url>/square/webhook
//   Events            payment.updated, refund.updated
//   Signature key     stored as SQUARE_WEBHOOK_SIGNATURE_KEY on the deployment
//
// Square signs the request with HMAC-SHA256 over the notification URL
// concatenated with the raw body and ships the digest as base64 in the
// `x-square-hmacsha256-signature` header.
http.route({
  path: "/square/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (!secret) return new Response("Missing SQUARE_WEBHOOK_SIGNATURE_KEY", { status: 500 });

    const sig = req.headers.get("x-square-hmacsha256-signature");
    if (!sig) return new Response("Missing signature", { status: 400 });

    const body = await req.text();
    // Square's HMAC is computed over (notification URL + body), not body
    // alone. We must hash exactly what Square hashed, which means using the
    // public-facing URL we registered in the dashboard — req.url here is
    // the internal Convex URL, so we rebuild it from a configured value.
    const notificationUrl =
      process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ??
      `${process.env.CONVEX_SITE_URL ?? ""}/square/webhook`;
    const expected = await hmacSha256Base64(secret, notificationUrl + body);
    if (!timingSafeEqual(expected, sig)) {
      return new Response("Bad signature", { status: 400 });
    }

    type SquareWebhook = {
      type?: string;
      data?: {
        object?: {
          payment?: {
            id?: string;
            status?: string;
            amount_money?: { amount?: number };
            reference_id?: string;
          };
          refund?: {
            id?: string;
            status?: string;
            payment_id?: string;
            amount_money?: { amount?: number };
          };
        };
      };
    };
    let event: SquareWebhook;
    try {
      event = JSON.parse(body) as SquareWebhook;
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    if (event.type === "payment.updated") {
      const payment = event.data?.object?.payment;
      if (!payment?.id || !payment.reference_id) {
        return new Response("bad payment payload", { status: 400 });
      }
      // Only act on completed payments. Square will fire payment.updated for
      // CREATED / PENDING transitions too — those are noise for our use case.
      if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
        return new Response("ignored (not completed)", { status: 200 });
      }
      const amountCents = payment.amount_money?.amount ?? 0;
      // Idempotent — confirmAndCharge has almost certainly already fired.
      // confirmFromPayment returns isNew=false in that case.
      const result = await ctx.runMutation(internal.bookings.confirmFromPayment, {
        idempotencyKey: payment.reference_id,
        squarePaymentId: payment.id,
        amountCents,
      });
      // Webhook firing first (rare) means we still need to schedule Cal.com.
      if (result.isNew) {
        const data = await ctx.runQuery(internal.bookings.getForCalcomDispatch, {
          bookingId: result.id,
        });
        if (data) {
          const eventTypeId =
            data.service?.calcomEventTypeId ?? Number(process.env.CALCOM_EVENT_TYPE_ID);
          if (eventTypeId && Number.isFinite(eventTypeId)) {
            try {
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
                bookingId: result.id,
                calComBookingId,
              });
            } catch (err) {
              console.error("Cal.com booking failed from Square webhook", err);
            }
          }
        }
      }
      return new Response("ok", { status: 200 });
    }

    if (event.type === "refund.updated") {
      const refund = event.data?.object?.refund;
      if (!refund?.payment_id) {
        return new Response("bad refund payload", { status: 400 });
      }
      // Only act on completed/pending refunds. Square also fires this when a
      // refund is REJECTED — leave the booking alone in that case.
      if (refund.status !== "COMPLETED" && refund.status !== "PENDING") {
        return new Response("ignored (refund not settled)", { status: 200 });
      }
      const booking = await ctx.runQuery(internal.bookings.getInternalBySquarePaymentId, {
        squarePaymentId: refund.payment_id,
      });
      if (!booking) {
        console.warn(`Refund webhook: no booking with Square payment ${refund.payment_id}`);
        return new Response("ignored", { status: 200 });
      }
      // Square's webhook payload is the cumulative refund amount for this
      // specific refund row. A payment can have multiple partial refunds, so
      // we sum what's on the booking already with the incoming amount. The
      // applyRefund mutation picks max(existing, incoming) to stay
      // monotonic in case events arrive out of order.
      const amountCents = refund.amount_money?.amount ?? 0;
      const newTotal = (booking.refundedAmountCents ?? 0) + amountCents;
      await ctx.runMutation(internal.bookings.applyRefund, {
        bookingId: booking._id,
        totalRefundedCents: newTotal,
      });
      return new Response("ok", { status: 200 });
    }

    return new Response("ignored", { status: 200 });
  }),
});

// Cal.com webhook: reflects rescheduling and cancellation made directly from
// the customer's confirmation email back into our DB so /admin/bookings stays
// authoritative. Configure in Cal.com → Settings → Developer → Webhooks:
//   URL    https://<convex-site-url>/calcom/webhook
//   Events BOOKING_RESCHEDULED, BOOKING_CANCELLED
//   Secret stored as CALCOM_WEBHOOK_SECRET on the Convex deployment
http.route({
  path: "/calcom/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.CALCOM_WEBHOOK_SECRET;
    if (!secret) return new Response("Missing CALCOM_WEBHOOK_SECRET", { status: 500 });

    const sig = req.headers.get("x-cal-signature-256");
    if (!sig) return new Response("Missing signature", { status: 400 });

    const body = await req.text();
    const expected = await hmacSha256Hex(secret, body);
    if (!timingSafeEqual(expected, sig)) {
      return new Response("Bad signature", { status: 400 });
    }

    type CalPayload = {
      triggerEvent?: string;
      payload?: {
        uid?: string;
        rescheduleUid?: string;
        startTime?: string;
        endTime?: string;
        cancellationReason?: string;
      };
    };
    let event: CalPayload;
    try {
      event = JSON.parse(body) as CalPayload;
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    const trigger = event.triggerEvent;
    const p = event.payload ?? {};

    if (trigger === "BOOKING_RESCHEDULED") {
      const oldUid = p.rescheduleUid;
      const newUid = p.uid;
      const start = p.startTime ? Date.parse(p.startTime) : NaN;
      const end = p.endTime ? Date.parse(p.endTime) : NaN;
      if (!oldUid || !newUid || !Number.isFinite(start) || !Number.isFinite(end)) {
        console.error("Reschedule webhook missing fields", p);
        return new Response("bad payload", { status: 400 });
      }
      await ctx.runMutation(internal.bookings.applyReschedule, {
        oldUid,
        newUid,
        slotStart: start,
        slotEnd: end,
      });
      return new Response("ok", { status: 200 });
    }

    if (trigger === "BOOKING_CANCELLED") {
      const uid = p.uid;
      if (!uid) return new Response("bad payload", { status: 400 });
      await ctx.runMutation(internal.bookings.markCancelled, { uid });
      return new Response("ok", { status: 200 });
    }

    return new Response("ignored", { status: 200 });
  }),
});

// HMAC-SHA256 of `body` using `secret`, hex-encoded. Used by the Cal.com
// webhook. Uses Web Crypto so it runs in Convex's default V8 runtime
// without needing "use node".
async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// HMAC-SHA256, base64-encoded. Square ships its webhook signature in base64.
async function hmacSha256Base64(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default http;
