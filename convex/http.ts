import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// Mounts /.well-known/openid-configuration, /api/auth/signin/*, etc.
auth.addHttpRoutes(http);

// Moneris async notification — optional defense-in-depth handler. The happy
// path is that the customer pays, the iframe fires `payment_receipt`, and
// our verifyAndConfirm action in moneris.ts immediately confirms the
// booking. This webhook catches:
//
//   - Customers who close the tab between Moneris approving and our verify
//     call coming back (rare but possible). Notification arrives later and
//     promotes the draft to confirmed via the same idempotent mutation.
//   - Refunds initiated directly inside Moneris's Merchant Resource Center
//     (admin Refund button updates the row synchronously; this catches the
//     out-of-band case).
//
// Configure in MRC → Admin → Asynchronous Notifications:
//   URL    https://<convex-site-url>/moneris/notification
//   Method POST
//   Secret stored as MONERIS_HMAC_KEY on the Convex deployment
//
// Moneris signs the body with HMAC-SHA1 and sends the digest in the
// `X-Moneris-Signature` header.
http.route({
  path: "/moneris/notification",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.MONERIS_HMAC_KEY;
    if (!secret) return new Response("Missing MONERIS_HMAC_KEY", { status: 500 });

    const sig = req.headers.get("x-moneris-signature");
    if (!sig) return new Response("Missing signature", { status: 400 });

    const body = await req.text();
    const expected = await hmacSha1Hex(secret, body);
    if (!timingSafeEqual(expected, sig.toLowerCase())) {
      return new Response("Bad signature", { status: 400 });
    }

    type MonerisPayload = {
      txn_type?: string; // "purchase" | "refund" | ...
      order_no?: string;
      transaction_no?: string;
      original_transaction_no?: string;
      response_code?: string;
      amount?: string;
    };
    let event: MonerisPayload;
    try {
      event = JSON.parse(body) as MonerisPayload;
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    const code = Number(event.response_code ?? "999");
    if (!Number.isFinite(code) || code > 49) {
      // Moneris response codes 00-49 are approvals; ignore declines.
      return new Response("ignored (declined)", { status: 200 });
    }
    const amountCents = Math.round(Number(event.amount ?? "0") * 100);

    if (event.txn_type === "purchase") {
      if (!event.order_no || !event.transaction_no) {
        return new Response("bad purchase payload", { status: 400 });
      }
      // Idempotent — verifyAndConfirm has almost certainly already fired.
      // confirmFromMoneris returns isNew=false in that case.
      const result = await ctx.runMutation(internal.bookings.confirmFromMoneris, {
        orderNo: event.order_no,
        monerisTxnId: event.transaction_no,
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
              const calComBookingId: string = await ctx.runAction(
                internal.calcom.createBookingInternal,
                {
                  eventTypeId,
                  slotStartISO: new Date(data.booking.slotStart).toISOString(),
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
              console.error("Cal.com booking failed from Moneris webhook", err);
            }
          }
        }
      }
      return new Response("ok", { status: 200 });
    }

    if (event.txn_type === "refund") {
      // Refunds reference the ORIGINAL purchase txn id — that's the one we
      // saved on the booking row.
      const originalTxn = event.original_transaction_no;
      if (!originalTxn) return new Response("bad refund payload", { status: 400 });
      const booking = await ctx.runQuery(internal.bookings.getInternalByMonerisTxn, {
        monerisTxnId: originalTxn,
      });
      if (!booking) {
        console.warn(`Refund webhook: no booking with moneris txn ${originalTxn}`);
        return new Response("ignored", { status: 200 });
      }
      // Webhook payload is the amount of THIS refund, not the cumulative
      // total. Add it to whatever's already recorded.
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

// HMAC-SHA256 of `body` using `secret`, hex-encoded. Uses Web Crypto so it
// runs in Convex's default V8 runtime without needing "use node".
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

// HMAC-SHA1 — Moneris's notification signature uses SHA1 (legacy).
async function hmacSha1Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default http;
