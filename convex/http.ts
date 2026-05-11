import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

// Mounts /.well-known/openid-configuration, /api/auth/signin/*, etc.
auth.addHttpRoutes(http);

// Stripe webhook: only place that writes a confirmed booking. Reads booking
// details from PaymentIntent metadata (set by stripe.createPaymentIntent),
// places the slot in Cal.com, then inserts the row in Convex.
//
// In the Stripe dashboard webhook, subscribe to: `payment_intent.succeeded`
// (we no longer use Checkout Sessions, so checkout.session.completed is unused).
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sig = req.headers.get("stripe-signature");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !secret) return new Response("Missing signature/secret", { status: 400 });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-04-22.dahlia",
    });

    const body = await req.text();
    let event: import("stripe").Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, secret);
    } catch (err) {
      console.error("Stripe signature verification failed", err);
      return new Response("Bad signature", { status: 400 });
    }

    // Refund handler: catches refunds initiated from the Stripe dashboard
    // (the admin Refund button updates our DB synchronously; this is for
    // refunds done outside the app + as defense in depth). applyRefund is
    // idempotent — safe to fire on every charge update.
    if (event.type === "charge.refunded") {
      const charge = event.data.object as import("stripe").Stripe.Charge;
      const paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : (charge.payment_intent?.id ?? "");
      if (!paymentIntentId) return new Response("no payment intent", { status: 200 });

      const booking = await ctx.runQuery(internal.bookings.getInternalByPaymentIntent, {
        paymentIntentId,
      });
      if (!booking) {
        console.warn(`Refund webhook: no booking with payment intent ${paymentIntentId}`);
        return new Response("ignored", { status: 200 });
      }
      await ctx.runMutation(internal.bookings.applyRefund, {
        bookingId: booking._id,
        totalRefundedCents: charge.amount_refunded,
      });
      return new Response("ok", { status: 200 });
    }

    if (event.type !== "payment_intent.succeeded") {
      return new Response("ignored", { status: 200 });
    }

    const intent = event.data.object as import("stripe").Stripe.PaymentIntent;
    const meta = intent.metadata ?? {};

    const serviceId = meta.serviceId as Id<"services"> | undefined;
    const slotStart = Number(meta.slotStart);
    const slotEnd = Number(meta.slotEnd);
    const depositCents = Number(meta.depositCents);
    if (!serviceId || !Number.isFinite(slotStart) || !Number.isFinite(depositCents)) {
      console.error("Webhook missing required metadata", meta);
      return new Response("bad metadata", { status: 400 });
    }

    // 1) Insert the booking FIRST. Atomic on stripePaymentIntentId — Convex
    //    serializes mutations on the same document, so two simultaneous
    //    webhook deliveries will only get one `isNew: true` back. We use
    //    that flag to gate the Cal.com call and prevent duplicate calendar
    //    bookings / confirmation emails.
    const { id: bookingId, isNew } = await ctx.runMutation(
      internal.bookings.upsertFromWebhook,
      {
        stripePaymentIntentId: intent.id,
        serviceId,
        slotStart,
        slotEnd,
        customerName: meta.customerName ?? "",
        customerEmail: meta.customerEmail ?? "",
        customerPhone: meta.customerPhone ?? "",
        vehicleInfo: meta.vehicleInfo ?? "",
        notes: meta.notes || undefined,
        depositAmountCents: depositCents,
      },
    );

    if (!isNew) {
      // Stripe replay / parallel delivery — booking already exists, do nothing.
      return new Response("already processed", { status: 200 });
    }

    // 2) Only the first webhook to insert reaches here — safe to call Cal.com.
    //    If Cal.com fails, the booking still exists (admin will see it without
    //    a calComBookingId and can manually reconcile).
    try {
      const service = await ctx.runQuery(api.services.get, { id: serviceId });
      const eventTypeId = service?.calcomEventTypeId ?? Number(process.env.CALCOM_EVENT_TYPE_ID);
      if (eventTypeId && Number.isFinite(eventTypeId)) {
        const calComBookingId: string = await ctx.runAction(
          internal.calcom.createBookingInternal,
          {
            eventTypeId,
            slotStartISO: new Date(slotStart).toISOString(),
            customerName: meta.customerName ?? "",
            customerEmail: meta.customerEmail ?? "",
            customerPhone: meta.customerPhone ?? "",
            vehicleInfo: meta.vehicleInfo ?? "",
            notes: meta.notes || undefined,
          },
        );
        await ctx.runMutation(internal.bookings.setCalcomBookingId, {
          bookingId,
          calComBookingId,
        });
      } else {
        console.error(
          `No Cal.com event type configured for service ${serviceId} — booking saved without calendar entry`,
        );
      }
    } catch (err) {
      console.error("Cal.com booking failed (booking will still be saved)", err);
    }

    return new Response("ok", { status: 200 });
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
      // Cal.com sends customer + host emails for the reschedule itself —
      // we don't fire any additional notification.
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default http;
