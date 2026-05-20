import { v } from "convex/values";
import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireAdmin } from "./users";

// Status enums kept in one place so every validator on this file stays in sync.
const STATUS_LITERALS = [
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("cancelled"),
  v.literal("completed"),
] as const;

// PUBLIC: success page polls this with our Square idempotency key (used as
// the `order_no` URL token) to show confirmation. Returns null until
// confirmAndCharge (or the webhook) has promoted the draft to confirmed/paid.
export const getBySquareIdempotency = query({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_square_idempotency_key", (q) =>
        q.eq("squareIdempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (!booking) return null;
    const service = await ctx.db.get(booking.serviceId);
    return { ...booking, serviceName: service?.name ?? "Service" };
  },
});

// INTERNAL: same lookup as getBySquareIdempotency but available to the
// webhook + confirmAndCharge without needing auth context.
export const getInternalBySquareIdempotency = internalQuery({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bookings")
      .withIndex("by_square_idempotency_key", (q) =>
        q.eq("squareIdempotencyKey", args.idempotencyKey),
      )
      .unique();
  },
});

// INTERNAL: lookup for the Square refund webhook — finds bookings by their
// Square payment id (set when payment was confirmed).
export const getInternalBySquarePaymentId = internalQuery({
  args: { squarePaymentId: v.string() },
  handler: async (ctx, args) => {
    // No dedicated index; scans the most recent few hundred bookings for the
    // matching payment id. Fine at our scale (a single shop), and avoids
    // burning an index slot on a low-cardinality use case.
    const recent = await ctx.db.query("bookings").order("desc").take(500);
    return recent.find((b) => b.squarePaymentId === args.squarePaymentId) ?? null;
  },
});

// INTERNAL: bundle a booking + its service for the post-payment flow, which
// needs both to call Cal.com.
export const getForCalcomDispatch = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return null;
    const service = await ctx.db.get(booking.serviceId);
    return { booking, service };
  },
});

// INTERNAL: insert a draft booking BEFORE the Square card form is shown, so
// the confirm call + webhook can find it by idempotency key and so the slot
// is effectively soft-held while the customer is in checkout. Status starts
// at pending; the cron sweeps abandoned drafts after 30 minutes.
//
// `selectedAddOns` is a SNAPSHOT (name/price/duration captured at booking
// time), not just IDs, so historical bookings stay readable even if the
// admin later edits or deletes the add-on row.
export const createDraft = internalMutation({
  args: {
    squareIdempotencyKey: v.string(),
    serviceId: v.id("services"),
    slotStart: v.number(),
    slotEnd: v.number(),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
    depositAmountCents: v.number(),
    selectedAddOns: v.optional(
      v.array(
        v.object({
          id: v.id("addOns"),
          name: v.string(),
          priceCents: v.number(),
          durationMinutes: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("bookings", {
      squareIdempotencyKey: args.squareIdempotencyKey,
      serviceId: args.serviceId,
      slotStart: args.slotStart,
      slotEnd: args.slotEnd,
      customerName: args.customerName,
      customerEmail: args.customerEmail,
      customerPhone: args.customerPhone,
      vehicleInfo: args.vehicleInfo,
      notes: args.notes,
      depositAmountCents: args.depositAmountCents,
      selectedAddOns: args.selectedAddOns,
      paymentStatus: "pending",
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

// INTERNAL: promote a draft booking to confirmed/paid once Square confirms
// payment. Idempotent — running twice (once from confirmAndCharge, once from
// the payment.updated webhook) is safe; only the first call returns
// isNew=true so the caller can gate Cal.com side effects.
export const confirmFromPayment = internalMutation({
  args: {
    idempotencyKey: v.string(),
    squarePaymentId: v.string(),
    amountCents: v.number(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_square_idempotency_key", (q) =>
        q.eq("squareIdempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (!booking) {
      throw new Error(`No draft booking for Square idempotency key ${args.idempotencyKey}`);
    }
    if (booking.paymentStatus === "paid" || booking.status === "confirmed") {
      return { id: booking._id, isNew: false };
    }
    await ctx.db.patch(booking._id, {
      squarePaymentId: args.squarePaymentId,
      paymentStatus: "paid",
      status: "confirmed",
    });
    return { id: booking._id, isNew: true };
  },
});

// INTERNAL: stamp the Cal.com booking id onto a row after we've placed it.
export const setCalcomBookingId = internalMutation({
  args: { bookingId: v.id("bookings"), calComBookingId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookingId, { calComBookingId: args.calComBookingId });
  },
});

// INTERNAL: lookup helper used by the Cal.com webhook + reschedule action.
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
// over and patch the new times.
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

// ADMIN: paginated list with optional status filter. We exclude `pending`
// rows by default — those are mid-checkout drafts that haven't paid yet,
// and they get auto-swept by the cleanup cron. Admins should never see them.
export const listForAdmin = query({
  args: {
    status: v.optional(v.union(...STATUS_LITERALS)),
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
      : await (async () => {
          // No filter requested — pull more than the asked limit so we can
          // drop drafts client-side and still return up to `limit` real rows.
          const raw = await ctx.db
            .query("bookings")
            .order("desc")
            .take(limit + 50);
          return raw.filter((b) => b.status !== "pending").slice(0, limit);
        })();
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
// refund action (immediately after Square accepts the request) AND by the
// Square webhook. Uses the higher of {existing, incoming} totals so
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

// ADMIN: issue a refund for a booking. Defaults to the remaining unrefunded
// balance; supports partial refunds. Hits Square first, then patches the
// row only if Square accepted — never marks something refunded that wasn't
// actually refunded by the processor.
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
    if (!booking.squarePaymentId) {
      throw new Error("Booking has no Square payment — nothing to refund");
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

    const refund = await ctx.runAction(internal.square.createRefundInternal, {
      squarePaymentId: booking.squarePaymentId,
      amountCents: amount,
      reason: args.reason,
    });

    await ctx.runMutation(internal.bookings.applyRefund, {
      bookingId: args.bookingId,
      totalRefundedCents: alreadyRefunded + refund.refundedCents,
    });

    return { ok: true, refundedCents: alreadyRefunded + refund.refundedCents };
  },
});

// ADMIN: cancel a booking — calls Cal.com to cancel its calendar entry first,
// then flips our row's status. Cal.com webhook will also fire BOOKING_CANCELLED
// but markCancelled is idempotent.
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
    await ctx.runMutation(internal.bookings.markCancelled, {
      uid: booking.calComBookingId ?? "",
    });
    if (!booking.calComBookingId) {
      await ctx.runMutation(internal.bookings.forceStatus, {
        bookingId: args.bookingId,
        status: "cancelled",
      });
    }
    return { ok: true };
  },
});

// INTERNAL: status setter that doesn't require a calcom uid lookup.
export const forceStatus = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    status: v.union(...STATUS_LITERALS),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookingId, { status: args.status });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("bookings"),
    status: v.union(...STATUS_LITERALS),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.id, { status: args.status });
  },
});

// INTERNAL: cron sweep — drop draft bookings (status=pending) older than 30
// minutes. They represent customers who opened the Square card form and
// abandoned checkout; leaving them around clogs the pending list and gives
// false impressions of held slots.
export const cleanupAbandonedDrafts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    let removed = 0;
    while (true) {
      const batch = await ctx.db
        .query("bookings")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .take(100);
      const stale = batch.filter((b) => b.createdAt < cutoff);
      for (const row of stale) {
        await ctx.db.delete(row._id);
        removed++;
      }
      if (stale.length < batch.length || batch.length < 100) break;
    }
    return { removed };
  },
});
