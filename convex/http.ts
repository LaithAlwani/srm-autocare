import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

// Mounts /.well-known/openid-configuration, /api/auth/signin/*, etc.
auth.addHttpRoutes(http);

// Stripe webhook: only place that writes a confirmed booking. Reads booking
// details from Stripe session metadata (set by stripe.createCheckoutSession),
// places the slot in Cal.com, then inserts the row in Convex.
//
// Configure with `stripe listen --forward-to <CONVEX_SITE_URL>/stripe/webhook`
// in dev, or add the prod URL as a Stripe webhook endpoint.
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

    if (event.type !== "checkout.session.completed") {
      return new Response("ignored", { status: 200 });
    }

    const session = event.data.object as import("stripe").Stripe.Checkout.Session;
    const meta = session.metadata ?? {};

    const serviceId = meta.serviceId as Id<"services"> | undefined;
    const slotStart = Number(meta.slotStart);
    const slotEnd = Number(meta.slotEnd);
    const depositCents = Number(meta.depositCents);
    if (!serviceId || !Number.isFinite(slotStart) || !Number.isFinite(depositCents)) {
      console.error("Webhook missing required metadata", meta);
      return new Response("bad metadata", { status: 400 });
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? "");

    // 1) Insert the booking FIRST. This is atomic on stripeSessionId — Convex
    //    serializes mutations on the same document, so two simultaneous
    //    webhook deliveries will only get one `isNew: true` back. We use that
    //    flag to gate the Cal.com call and prevent duplicate calendar
    //    bookings / confirmation emails.
    const { id: bookingId, isNew } = await ctx.runMutation(
      internal.bookings.upsertFromWebhook,
      {
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
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

export default http;
