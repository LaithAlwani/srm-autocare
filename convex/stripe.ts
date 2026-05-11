"use node";

import { v } from "convex/values";
import Stripe from "stripe";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

// PUBLIC: customer kicks off the Stripe Checkout flow from /book.
// Booking details ride in the Stripe session metadata — nothing is written to
// Convex until the webhook fires after a successful payment + Cal.com booking.
// This keeps the DB free of abandoned-checkout noise.
//
// Stripe metadata limits: max 50 keys, 500 chars per value, 8KB total. Our
// payload fits easily; long `notes` is truncated to stay within limits.
export const createCheckoutSession = action({
  args: {
    serviceId: v.id("services"),
    slotStart: v.number(),
    slotEnd: v.number(),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");
    if (!service.active) throw new Error("Service is not bookable");

    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: args.customerEmail,
      success_url: `${args.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: args.cancelUrl,
      line_items: [
        {
          price_data: {
            currency: "cad",
            product_data: {
              name: `${service.name} — booking deposit`,
              description: `Deposit for ${new Date(args.slotStart).toLocaleString()}`,
            },
            unit_amount: service.depositCents,
          },
          quantity: 1,
        },
      ],
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

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  },
});
