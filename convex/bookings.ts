import { v } from "convex/values";
import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
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

// INTERNAL: lookup helper used by the Cal.com webhook + notification action.
export const getByCalcomUid = internalQuery({
  args: { calComBookingId: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_calcom_uid", (q) =>
        q.eq("calComBookingId", args.calComBookingId),
      )
      .unique();
    if (!booking) return null;
    const service = await ctx.db.get(booking.serviceId);
    return { ...booking, serviceName: service?.name ?? "Service" };
  },
});

// INTERNAL: applied when Cal.com fires BOOKING_RESCHEDULED. The reschedule
// webhook payload references the OLD booking via `rescheduleUid` and ships a
// brand-new `uid` for the new booking — we swap the row's calComBookingId
// over and patch the new times. Returns the previous slot so the notifier
// can render a "moved from X to Y" email.
export const applyReschedule = internalMutation({
  args: {
    oldUid: v.string(),
    newUid: v.string(),
    slotStart: v.number(),
    slotEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_calcom_uid", (q) => q.eq("calComBookingId", args.oldUid))
      .unique();
    if (!booking) {
      console.warn(`Reschedule webhook: no booking with calcom uid ${args.oldUid}`);
      return null;
    }
    const previous = { slotStart: booking.slotStart, slotEnd: booking.slotEnd };
    // Capture the very first booked time once. Subsequent reschedules update
    // slotStart/slotEnd but leave originalSlotStart untouched so the admin
    // always sees the true original.
    const captureOriginal = booking.originalSlotStart === undefined;
    await ctx.db.patch(booking._id, {
      calComBookingId: args.newUid,
      slotStart: args.slotStart,
      slotEnd: args.slotEnd,
      rescheduledAt: Date.now(),
      ...(captureOriginal
        ? { originalSlotStart: booking.slotStart, originalSlotEnd: booking.slotEnd }
        : {}),
    });
    return { bookingId: booking._id, previous };
  },
});

// INTERNAL: applied when Cal.com fires BOOKING_CANCELLED. Sets the status
// without deleting the row so we keep the audit trail (deposit info, etc.).
export const markCancelled = internalMutation({
  args: { uid: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_calcom_uid", (q) => q.eq("calComBookingId", args.uid))
      .unique();
    if (!booking) {
      console.warn(`Cancel webhook: no booking with calcom uid ${args.uid}`);
      return null;
    }
    if (booking.status === "cancelled") return booking._id;
    await ctx.db.patch(booking._id, { status: "cancelled" });
    return booking._id;
  },
});

// ADMIN: paginated list with optional status filter.
export const listForAdmin = query({
  args: {
    status: v.optional(
      v.union(
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

// ADMIN: kick off a reschedule from /admin/bookings. Calls Cal.com's reschedule
// API; the BOOKING_RESCHEDULED webhook fires back to /calcom/webhook and
// updates our DB through applyReschedule. Cal.com handles the customer email.
export const adminReschedule = action({
  args: {
    bookingId: v.id("bookings"),
    slotStartISO: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const me = await ctx.runQuery(api.users.currentUser);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      throw new Error("Not authorized");
    }
    const booking = await ctx.runQuery(internal.bookings.getInternal, {
      id: args.bookingId,
    });
    if (!booking) throw new Error("Booking not found");
    if (!booking.calComBookingId) {
      throw new Error("This booking has no Cal.com entry to reschedule");
    }
    await ctx.runAction(internal.calcom.rescheduleBookingInternal, {
      bookingUid: booking.calComBookingId,
      slotStartISO: args.slotStartISO,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("bookings") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

// INTERNAL: idempotent setter for refund state. Called both by the admin
// refund action (immediately after Stripe accepts the request) AND by the
// charge.refunded webhook (defense in depth + handles refunds initiated from
// the Stripe dashboard). Uses the higher of {existing, incoming} totals so
// out-of-order webhook deliveries don't roll back the state.
export const applyRefund = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    totalRefundedCents: v.number(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return;
    const next = Math.max(booking.refundedAmountCents ?? 0, args.totalRefundedCents);
    const isFull = next >= booking.depositAmountCents;
    await ctx.db.patch(args.bookingId, {
      refundedAmountCents: next,
      paymentStatus: isFull ? "refunded" : "partially_refunded",
    });
  },
});

// INTERNAL: lookup by Stripe PaymentIntent — used by the charge.refunded
// webhook to find which booking a refund applies to.
export const getInternalByPaymentIntent = internalQuery({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bookings")
      .withIndex("by_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.paymentIntentId),
      )
      .unique();
  },
});

// ADMIN: issue a refund for a cancelled booking. amountCents is the amount
// to refund (in cents), defaulting to the remaining unrefunded balance.
// Throws if the booking isn't refundable or the amount exceeds the balance.
export const adminRefund = action({
  args: {
    bookingId: v.id("bookings"),
    amountCents: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true; refundedCents: number }> => {
    const me = await ctx.runQuery(api.users.currentUser);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      throw new Error("Not authorized");
    }
    const booking = await ctx.runQuery(internal.bookings.getInternal, {
      id: args.bookingId,
    });
    if (!booking) throw new Error("Booking not found");
    if (!booking.stripePaymentIntentId) {
      throw new Error("Booking has no Stripe payment intent — nothing to refund");
    }
    if (booking.paymentStatus === "refunded") {
      throw new Error("Booking is already fully refunded");
    }

    const alreadyRefunded = booking.refundedAmountCents ?? 0;
    const remaining = booking.depositAmountCents - alreadyRefunded;
    if (remaining <= 0) {
      throw new Error("Nothing left to refund");
    }
    const amount = args.amountCents ?? remaining;
    if (amount <= 0 || amount > remaining) {
      throw new Error(`Refund amount must be between 1 and ${remaining} cents`);
    }

    const refund = await ctx.runAction(internal.stripe.createRefundInternal, {
      paymentIntentId: booking.stripePaymentIntentId,
      amountCents: amount,
      reason: args.reason,
    });

    await ctx.runMutation(internal.bookings.applyRefund, {
      bookingId: args.bookingId,
      totalRefundedCents: alreadyRefunded + refund.amountCents,
    });

    return { ok: true, refundedCents: alreadyRefunded + refund.amountCents };
  },
});

// ADMIN: cancel a booking — calls Cal.com to cancel its calendar entry first
// (so the customer gets the standard Cal.com cancellation email), then flips
// our row's status. The Cal.com webhook will also fire BOOKING_CANCELLED but
// markCancelled is idempotent, so the second update is a no-op.
export const adminCancel = action({
  args: {
    bookingId: v.id("bookings"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const me = await ctx.runQuery(api.users.currentUser);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      throw new Error("Not authorized");
    }
    const booking = await ctx.runQuery(internal.bookings.getInternal, {
      id: args.bookingId,
    });
    if (!booking) throw new Error("Booking not found");
    if (booking.status === "cancelled") return { ok: true };

    if (booking.calComBookingId) {
      await ctx.runAction(internal.calcom.cancelBookingInternal, {
        bookingUid: booking.calComBookingId,
        reason: args.reason,
      });
    }
    // Update local row directly too — the webhook will arrive eventually but
    // we want the admin UI to reflect the change immediately.
    await ctx.runMutation(internal.bookings.markCancelled, {
      uid: booking.calComBookingId ?? "",
    });
    // Fallback for bookings without a Cal.com uid (markCancelled keys by uid):
    if (!booking.calComBookingId) {
      await ctx.runMutation(internal.bookings.forceStatus, {
        bookingId: args.bookingId,
        status: "cancelled",
      });
    }
    return { ok: true };
  },
});

// INTERNAL: status setter that doesn't require a calcom uid lookup. Used as
// a fallback in adminCancel when a booking has no Cal.com uid.
export const forceStatus = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    status: v.union(
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("completed"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookingId, { status: args.status });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("bookings"),
    status: v.union(
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
