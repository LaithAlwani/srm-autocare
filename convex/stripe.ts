"use node";

import { v } from "convex/values";
import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { api } from "./_generated/api";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

// PUBLIC: creates a PaymentIntent for the deposit and returns its client secret.
// The frontend renders Stripe Elements / PaymentElement using this secret —
// the entire card form lives inside our /book page so we control every pixel.
//
// Booking details ride on PaymentIntent.metadata, just like before. The
// webhook (`payment_intent.succeeded`) reads them back and writes the booking
// row only after Stripe confirms payment.
export const createPaymentIntent = action({
  args: {
    serviceId: v.id("services"),
    slotStart: v.number(),
    slotEnd: v.number(),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> => {
    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");
    if (!service.active) throw new Error("Service is not bookable");

    const stripe = stripeClient();
    const intent = await stripe.paymentIntents.create({
      amount: service.depositCents,
      currency: "cad",
      receipt_email: args.customerEmail,
      automatic_payment_methods: { enabled: true },
      description: `${service.name} — booking deposit (${new Date(args.slotStart).toLocaleString(
        "en-CA",
        {
          timeZone: "America/New_York",
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        },
      )})`,
      metadata: {
        serviceId: String(args.serviceId),
        slotStart: String(args.slotStart),
        slotEnd: String(args.slotEnd),
        customerName: args.customerName.slice(0, 200),
        customerEmail: args.customerEmail.slice(0, 200),
        customerPhone: args.customerPhone.slice(0, 50),
        vehicleInfo: args.vehicleInfo.slice(0, 500),
        notes: (args.notes ?? "").slice(0, 500),
        depositCents: String(service.depositCents),
      },
    });

    if (!intent.client_secret) {
      throw new Error("Stripe did not return a client secret");
    }
    return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
  },
});

// INTERNAL: refund a previously-captured PaymentIntent. If amountCents is
// omitted Stripe issues a full refund; otherwise it's a partial refund.
// In test mode refunds typically settle instantly; in prod they take 5–10
// business days to appear on the customer's statement. We update the booking
// row as soon as Stripe accepts the request; the charge.refunded webhook
// later re-confirms via the same idempotent path.
export const createRefundInternal = internalAction({
  args: {
    paymentIntentId: v.string(),
    amountCents: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (
    _ctx,
    args,
  ): Promise<{ refundId: string; status: string; amountCents: number }> => {
    const stripe = stripeClient();
    const refund = await stripe.refunds.create({
      payment_intent: args.paymentIntentId,
      ...(args.amountCents ? { amount: args.amountCents } : {}),
      reason: "requested_by_customer",
      metadata: args.reason ? { reason: args.reason.slice(0, 500) } : undefined,
    });
    return {
      refundId: refund.id,
      status: refund.status ?? "unknown",
      amountCents: refund.amount,
    };
  },
});
