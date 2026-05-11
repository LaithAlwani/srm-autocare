import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { requireAdmin } from "./users";

// PUBLIC: success page polls this with a stripe payment intent id to show
// confirmation. Returns null until the webhook has processed the payment and
// inserted the row. (We also support stripeSessionId for backward compat with
// any older Checkout-based bookings.)
export const getByPaymentIntent = query({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.paymentIntentId),
      )
      .unique();
    if (!booking) return null;
    const service = await ctx.db.get(booking.serviceId);
    return { ...booking, serviceName: service?.name ?? "Service" };
  },
});

export const getBySession = query({
  args: { stripeSessionId: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_stripe_session", (q) =>
        q.eq("stripeSessionId", args.stripeSessionId),
      )
      .unique();
    if (!booking) return null;
    const service = await ctx.db.get(booking.serviceId);
    return { ...booking, serviceName: service?.name ?? "Service" };
  },
});

// INTERNAL: webhook calls this FIRST after Stripe confirms payment, BEFORE
// touching Cal.com. Returns `{ id, isNew }` so the caller can tell whether
// this invocation actually inserted the row (isNew=true) or found a
// previously-inserted row (isNew=false). Convex serializes mutations on the
// same document, so even if Stripe delivers the webhook twice in parallel,
// only the first call sees isNew=true. Caller uses this to gate side effects
// like the Cal.com booking — preventing duplicate calendar entries / emails.
//
// Keyed on stripePaymentIntentId — every PaymentIntent is unique to one
// payment attempt, so this is the right idempotency key for the
// `payment_intent.succeeded` webhook event.
export const upsertFromWebhook = internalMutation({
  args: {
    stripePaymentIntentId: v.string(),
    serviceId: v.id("services"),
    slotStart: v.number(),
    slotEnd: v.number(),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
    depositAmountCents: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("bookings")
      .withIndex("by_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
      )
      .unique();
    if (existing) return { id: existing._id, isNew: false };
    const id = await ctx.db.insert("bookings", {
      stripePaymentIntentId: args.stripePaymentIntentId,
      serviceId: args.serviceId,
      slotStart: args.slotStart,
      slotEnd: args.slotEnd,
      customerName: args.customerName,
      customerEmail: args.customerEmail,
      customerPhone: args.customerPhone,
      vehicleInfo: args.vehicleInfo,
      notes: args.notes,
      depositAmountCents: args.depositAmountCents,
      paymentStatus: "paid",
      status: "confirmed",
      createdAt: Date.now(),
    });
    return { id, isNew: true };
  },
});

// INTERNAL: stamp the Cal.com booking id onto a row after we've placed it.
// Called only by the webhook, only for newly-inserted bookings.
export const setCalcomBookingId = internalMutation({
  args: { bookingId: v.id("bookings"), calComBookingId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookingId, { calComBookingId: args.calComBookingId });
  },
});

// ADMIN: paginated list with optional status filter.
export const listForAdmin = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("confirmed"),
        v.literal("cancelled"),
        v.literal("completed"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = args.limit ?? 50;
    const rows = args.status
      ? await ctx.db
          .query("bookings")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .order("desc")
          .take(limit)
      : await ctx.db.query("bookings").order("desc").take(limit);
    return await Promise.all(
      rows.map(async (b) => {
        const service = await ctx.db.get(b.serviceId);
        return { ...b, serviceName: service?.name ?? "—" };
      }),
    );
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("bookings"),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("completed"),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.id, { status: args.status });
  },
});
