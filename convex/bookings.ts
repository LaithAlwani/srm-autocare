import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./users";
import { computeDepositCents } from "../lib/booking";
import {
  resolveBusinessHours,
  parseHHMM,
  dayKey,
  weekdayInZone,
  epochAt,
} from "../lib/businessHours";

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

// INTERNAL: bundle a booking + its service for any post-state-change
// dispatch — confirmation email, Google Calendar push, reschedule email,
// cancellation email.
export const getForDispatch = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return null;
    const service = await ctx.db.get(booking.serviceId);
    return { booking, service };
  },
});

// Tag thrown errors so the caller (confirmAndCharge action) can distinguish
// a slot-collision (needs auto-refund) from any other failure (rethrow
// as-is).
export const SLOT_COLLISION_ERROR = "SLOT_COLLISION";

// INTERNAL: insert a fully-paid booking AFTER Square approved the charge.
// Returns `isNew: false` if a row with the same idempotency key already
// exists (so action retries don't create duplicates) and `isNew: true`
// otherwise so the caller can gate post-payment side effects (emails,
// calendar push).
//
// Convex mutations are serializable — only one runs at a time per
// deployment. We exploit that here: the slot-collision check + insert
// both happen inside this mutation, so a concurrent booker who passed
// the action's pre-charge check still gets caught here. Throwing the
// tagged SLOT_COLLISION error tells confirmAndCharge to auto-refund
// the just-completed Square payment before surfacing an error to the
// customer.
//
// `selectedAddOns` is a SNAPSHOT (name/price/duration captured at
// booking time), not just IDs, so historical bookings stay readable
// even if the admin later edits or deletes the add-on row.
export const createConfirmedInternal = internalMutation({
  args: {
    squareIdempotencyKey: v.string(),
    squarePaymentId: v.string(),
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
    // 1. Idempotency dedupe — if an earlier confirmAndCharge attempt
    //    already landed this booking and a retry is hitting us, return
    //    the existing row. Pairs with Square's own idempotency dedupe
    //    on /payments.
    const existing = await ctx.db
      .query("bookings")
      .withIndex("by_square_idempotency_key", (q) =>
        q.eq("squareIdempotencyKey", args.squareIdempotencyKey),
      )
      .unique();
    if (existing) {
      return { id: existing._id, isNew: false };
    }

    // 2. Slot collision check INSIDE the mutation — guaranteed
    //    serializable. Two concurrent confirmAndCharge calls for the
    //    same slot will see each other here, and the second one throws.
    const candidates = await ctx.db
      .query("bookings")
      .withIndex("by_slot_start", (q) =>
        q.gte("slotStart", args.slotStart - 24 * 60 * 60 * 1000),
      )
      .take(200);
    const conflict = candidates.some(
      (b) =>
        b.status === "confirmed" &&
        b.slotStart < args.slotEnd &&
        b.slotEnd > args.slotStart,
    );
    if (conflict) {
      throw new Error(SLOT_COLLISION_ERROR);
    }

    const id = await ctx.db.insert("bookings", {
      squareIdempotencyKey: args.squareIdempotencyKey,
      squarePaymentId: args.squarePaymentId,
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
      paymentStatus: "paid",
      status: "confirmed",
      createdAt: Date.now(),
    });
    return { id, isNew: true };
  },
});

// INTERNAL: insert mutation for the admin-manual "new booking" flow.
// Same serializable slot-collision guard as createConfirmedInternal so
// admin entries can't double-book on top of a customer who just paid
// online. No idempotency key (admin doesn't generate one) and no Square
// payment id — paymentStatus reflects whatever the admin recorded.
export const adminCreateBookingInternal = internalMutation({
  args: {
    serviceId: v.id("services"),
    slotStart: v.number(),
    slotEnd: v.number(),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
    depositAmountCents: v.number(),
    paymentStatus: v.union(v.literal("paid"), v.literal("pending")),
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
    const candidates = await ctx.db
      .query("bookings")
      .withIndex("by_slot_start", (q) =>
        q.gte("slotStart", args.slotStart - 24 * 60 * 60 * 1000),
      )
      .take(200);
    const conflict = candidates.some(
      (b) =>
        b.status === "confirmed" &&
        b.slotStart < args.slotEnd &&
        b.slotEnd > args.slotStart,
    );
    if (conflict) {
      throw new Error(SLOT_COLLISION_ERROR);
    }

    return await ctx.db.insert("bookings", {
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
      paymentStatus: args.paymentStatus,
      status: "confirmed",
      createdAt: Date.now(),
    });
  },
});

// ADMIN: create a booking manually from the admin UI — walk-ins, phone
// bookings, owner-blocked time, etc. No Square interaction. Optional
// `sendConfirmationEmail` controls whether the customer gets the
// branded confirmation (admin might want a silent booking for blocking
// off time). Google Calendar push always fires (assuming the
// integration is connected) so the owner's calendar stays accurate.
export const adminCreateBooking = action({
  args: {
    serviceId: v.id("services"),
    slotStartISO: v.string(),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
    addOnIds: v.optional(v.array(v.id("addOns"))),
    // Optional override — when omitted we use the standard 33% rule.
    // Admin can set 0 for a comped booking.
    depositAmountCentsOverride: v.optional(v.number()),
    // "paid" = admin collected (cash/etransfer/etc). "pending" = will
    // collect at appointment. Defaults to "paid".
    paymentStatus: v.optional(v.union(v.literal("paid"), v.literal("pending"))),
    sendConfirmationEmail: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ ok: true; bookingId: Id<"bookings"> }> => {
    const me = await ctx.runQuery(api.users.currentUser);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      throw new Error("Not authorized");
    }

    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");

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
    const depositAmountCents =
      args.depositAmountCentsOverride !== undefined
        ? args.depositAmountCentsOverride
        : computeDepositCents(totalCents);

    const slotStart = new Date(args.slotStartISO).getTime();
    if (!Number.isFinite(slotStart)) throw new Error("Invalid slotStartISO");
    const slotEnd =
      slotStart + (service.durationMinutes + addOnsTotalMinutes) * 60 * 1000;

    let bookingId: Id<"bookings">;
    try {
      bookingId = await ctx.runMutation(
        internal.bookings.adminCreateBookingInternal,
        {
          serviceId: args.serviceId,
          slotStart,
          slotEnd,
          customerName: args.customerName.trim(),
          customerEmail: args.customerEmail.trim(),
          customerPhone: args.customerPhone.trim(),
          vehicleInfo: args.vehicleInfo.trim(),
          notes: args.notes?.trim() || undefined,
          depositAmountCents,
          paymentStatus: args.paymentStatus ?? "paid",
          selectedAddOns: selectedAddOns.length > 0 ? selectedAddOns : undefined,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(SLOT_COLLISION_ERROR)) {
        throw new Error(
          "That slot already has a confirmed booking. Pick another time or cancel the existing one first.",
        );
      }
      throw err;
    }

    // Fan out post-booking side effects:
    //   - confirmation email (admin can suppress for silent bookings)
    //   - Google Calendar push (always, so owner's calendar stays accurate)
    // Owner notification is skipped because the admin is the owner —
    // emailing themselves about a booking they just created is noise.
    const [, gcal] = await Promise.allSettled([
      args.sendConfirmationEmail === false
        ? Promise.resolve()
        : ctx.runAction(internal.emails.sendBookingConfirmation, { bookingId }),
      ctx.runAction(internal.googleCalendar.createEventInternal, { bookingId }),
    ]);
    if (gcal.status === "fulfilled" && typeof gcal.value === "string") {
      await ctx.runMutation(internal.bookings.setGoogleCalendarEventId, {
        bookingId,
        googleCalendarEventId: gcal.value,
      });
    }

    return { ok: true, bookingId };
  },
});

// INTERNAL: read-only slot collision check used by confirmAndCharge right
// before it hits Square. Returns true if any *confirmed* booking overlaps
// the requested [slotStart, slotEnd) window. The reschedule flow can
// exclude itself; the public booking flow always passes undefined.
export const slotIsTaken = internalQuery({
  args: {
    slotStart: v.number(),
    slotEnd: v.number(),
    excludeBookingId: v.optional(v.id("bookings")),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("bookings")
      .withIndex("by_slot_start", (q) =>
        q.gte("slotStart", args.slotStart - 24 * 60 * 60 * 1000),
      )
      .take(200);
    return rows.some(
      (b) =>
        b._id !== args.excludeBookingId &&
        b.status === "confirmed" &&
        b.slotStart < args.slotEnd &&
        b.slotEnd > args.slotStart,
    );
  },
});

// INTERNAL: stamp the Google Calendar event id onto a booking after the
// dispatch helper has successfully pushed it. Used so subsequent
// reschedule / cancel actions know which event to PATCH or DELETE.
export const setGoogleCalendarEventId = internalMutation({
  args: { bookingId: v.id("bookings"), googleCalendarEventId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookingId, {
      googleCalendarEventId: args.googleCalendarEventId,
    });
  },
});

// INTERNAL: apply a reschedule in-place. Captures original slot times on
// the first reschedule so the admin UI can still show "originally booked
// for X". Idempotent against same-value patches.
export const applyRescheduleInternal = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    newSlotStart: v.number(),
    newSlotEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error("Booking not found");
    const previousSlotStart = booking.slotStart;
    const captureOriginal = booking.originalSlotStart === undefined;
    await ctx.db.patch(args.bookingId, {
      slotStart: args.newSlotStart,
      slotEnd: args.newSlotEnd,
      rescheduledAt: Date.now(),
      ...(captureOriginal
        ? { originalSlotStart: booking.slotStart, originalSlotEnd: booking.slotEnd }
        : {}),
    });
    return { previousSlotStart };
  },
});

// ADMIN: paginated list with optional status + date filter. We exclude
// `pending` rows by default — those are mid-checkout drafts that haven't
// paid yet, and they get auto-swept by the cleanup cron. Admins should
// never see them.
//
// `dateISO` (YYYY-MM-DD in business TZ) narrows the list to bookings on
// that single day — used by the calendar strip in /admin/bookings to
// scope the view to "what's on today / tomorrow / etc." When omitted the
// query falls back to the upcoming-first ordering.
export const listForAdmin = query({
  args: {
    status: v.optional(v.union(...STATUS_LITERALS)),
    dateISO: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = args.limit ?? 50;

    // Compute the day window if a date was supplied. We do this in the
    // server's TZ (America/Toronto matches the business — the same zone
    // every customer sees on their booking confirmation). Anything outside
    // [dayStart, dayEnd) is filtered out.
    let dayStart: number | null = null;
    let dayEnd: number | null = null;
    if (args.dateISO) {
      const [y, m, d] = args.dateISO.split("-").map(Number);
      // Local-midnight; for a single-shop app the tiny TZ skew between
      // server UTC and Toronto wall-clock doesn't change which bookings
      // land in which day (slotStart is the canonical timestamp).
      dayStart = new Date(y, m - 1, d).getTime();
      dayEnd = new Date(y, m - 1, d + 1).getTime();
    }

    // Pull a generous batch so the partition + filter below still has
    // plenty to work with after dropping drafts. When filtering by date
    // we use by_slot_start for a tight scan.
    const rawByStatus = dayStart !== null
      ? await ctx.db
          .query("bookings")
          .withIndex("by_slot_start", (q) =>
            q.gte("slotStart", dayStart!).lt("slotStart", dayEnd!),
          )
          .take(limit + 100)
      : args.status
        ? await ctx.db
            .query("bookings")
            .withIndex("by_status", (q) => q.eq("status", args.status!))
            .take(limit + 100)
        : await ctx.db.query("bookings").take(limit + 100);

    // Always hide pending drafts — they're mid-checkout rows the cleanup
    // cron will sweep. Then apply the status filter (it's still useful
    // when narrowed to a date — e.g. show only CANCELLED on that day).
    const filtered = rawByStatus
      .filter((b) => b.status !== "pending")
      .filter((b) => !args.status || b.status === args.status);

    let sorted: typeof filtered;
    if (dayStart !== null) {
      // Day-scoped view: time-of-day ascending so morning bookings come first.
      sorted = filtered.sort((a, b) => a.slotStart - b.slotStart).slice(0, limit);
    } else {
      // All-time view: upcoming first (ASC), past after (DESC).
      const now = Date.now();
      const upcoming = filtered
        .filter((b) => b.slotStart >= now)
        .sort((a, b) => a.slotStart - b.slotStart);
      const past = filtered
        .filter((b) => b.slotStart < now)
        .sort((a, b) => b.slotStart - a.slotStart);
      sorted = [...upcoming, ...past].slice(0, limit);
    }

    return await Promise.all(
      sorted.map(async (b) => {
        const service = await ctx.db.get(b.serviceId);
        return { ...b, serviceName: service?.name ?? "—" };
      }),
    );
  },
});

// ADMIN: kick off a reschedule from /admin/bookings. Patches the booking
// row in place, then fires the customer email + Google Calendar update.
// Side effects are best-effort — the row state change is what's
// authoritative.
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
    if (booking.status === "cancelled") {
      throw new Error("Cancelled bookings can't be rescheduled");
    }

    const newSlotStart = new Date(args.slotStartISO).getTime();
    if (!Number.isFinite(newSlotStart)) {
      throw new Error("Invalid slotStartISO");
    }
    // Preserve the existing appointment length (service + any add-ons).
    const lengthMs = booking.slotEnd - booking.slotStart;
    const newSlotEnd = newSlotStart + lengthMs;

    const { previousSlotStart } = await ctx.runMutation(
      internal.bookings.applyRescheduleInternal,
      {
        bookingId: args.bookingId,
        newSlotStart,
        newSlotEnd,
      },
    );

    // Email + GCal in parallel, ignoring individual failures.
    await Promise.allSettled([
      ctx.runAction(internal.emails.sendBookingRescheduled, {
        bookingId: args.bookingId,
        previousSlotStart,
      }),
      booking.googleCalendarEventId
        ? ctx.runAction(internal.googleCalendar.updateEventInternal, {
            googleEventId: booking.googleCalendarEventId,
            bookingId: args.bookingId,
          })
        : Promise.resolve(),
    ]);

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

// ADMIN: cancel a booking. Flips the row's status, then fires the
// cancellation email + best-effort Google Calendar deletion.
// Idempotent on already-cancelled rows.
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

    await ctx.runMutation(internal.bookings.forceStatus, {
      bookingId: args.bookingId,
      status: "cancelled",
    });

    await Promise.allSettled([
      ctx.runAction(internal.emails.sendBookingCancelled, {
        bookingId: args.bookingId,
        refundedCents: booking.refundedAmountCents,
        reason: args.reason,
      }),
      booking.googleCalendarEventId
        ? ctx.runAction(internal.googleCalendar.deleteEventInternal, {
            googleEventId: booking.googleCalendarEventId,
          })
        : Promise.resolve(),
    ]);

    return { ok: true };
  },
});

// INTERNAL: status setter when callers already have the bookingId in hand.
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

// ADMIN: aggregate dashboard stats — bookings + revenue for today vs
// yesterday, this week vs last week, plus today's slot utilization
// percentage. Revenue is the full appointment value (service price +
// add-ons), NOT the deposit collected, because the dashboard's job is
// to show how much the shop earned, not how much sat in escrow.
export const getDashboardStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const hoursRow = await ctx.db
      .query("siteContent")
      .withIndex("by_key", (q) => q.eq("key", "businessHours"))
      .unique();
    const hours = resolveBusinessHours(hoursRow?.value);

    // Today + comparison windows, all in the business TZ so "today"
    // means what the shop owner thinks today means.
    const now = Date.now();
    const todayKey = dayKey(hours.timeZone, now);
    const todayStart = epochAt(todayKey, "00:00", hours.timeZone);
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const yesterdayEnd = todayStart;
    const thisWeekStart = todayEnd - 7 * 24 * 60 * 60 * 1000;
    const thisWeekEnd = todayEnd;
    const lastWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;
    const lastWeekEnd = thisWeekStart;

    // Pull a generous batch covering the lookback window. The by_slot_start
    // index gives us cheap range scans; we filter status + add-on revenue
    // in JS. 14 days of bookings for a single-bay shop fits well under
    // any reasonable limit.
    const rows = await ctx.db
      .query("bookings")
      .withIndex("by_slot_start", (q) => q.gte("slotStart", lastWeekStart))
      .take(500);
    const confirmed = rows.filter((b) => b.status === "confirmed");

    // Service prices are needed to compute total appointment value.
    // Cache lookups so a popular service isn't re-fetched per booking.
    const servicePriceCache = new Map<string, number>();
    async function priceFor(serviceId: Id<"services">): Promise<number> {
      const cached = servicePriceCache.get(serviceId);
      if (cached !== undefined) return cached;
      const service = await ctx.db.get(serviceId);
      const price = service?.priceFromCents ?? 0;
      servicePriceCache.set(serviceId, price);
      return price;
    }

    type Bucket = { bookings: number; revenueCents: number };
    const empty = (): Bucket => ({ bookings: 0, revenueCents: 0 });
    const today = empty();
    const yesterday = empty();
    const thisWeek = empty();
    const lastWeek = empty();
    let bookedMinutesToday = 0;

    for (const b of confirmed) {
      const addOnsTotal = (b.selectedAddOns ?? []).reduce(
        (sum, a) => sum + a.priceCents,
        0,
      );
      const fullCents = (await priceFor(b.serviceId)) + addOnsTotal;
      if (b.slotStart >= todayStart && b.slotStart < todayEnd) {
        today.bookings++;
        today.revenueCents += fullCents;
        bookedMinutesToday += Math.round((b.slotEnd - b.slotStart) / 60000);
      }
      if (b.slotStart >= yesterdayStart && b.slotStart < yesterdayEnd) {
        yesterday.bookings++;
        yesterday.revenueCents += fullCents;
      }
      if (b.slotStart >= thisWeekStart && b.slotStart < thisWeekEnd) {
        thisWeek.bookings++;
        thisWeek.revenueCents += fullCents;
      }
      if (b.slotStart >= lastWeekStart && b.slotStart < lastWeekEnd) {
        lastWeek.bookings++;
        lastWeek.revenueCents += fullCents;
      }
    }

    // Slot utilization today — booked minutes vs total business-hours
    // minutes for today's weekday. If today is closed (Sunday by
    // default) or blacked out, total is 0 and we report 100% to avoid
    // a divide-by-zero "0%" that looks like an empty calendar.
    const weekday = weekdayInZone(hours.timeZone, now);
    const schedule = hours.weekly.find((d) => d.day === weekday);
    const openMin = parseHHMM(schedule?.open ?? null);
    const closeMin = parseHHMM(schedule?.close ?? null);
    const isBlackout = hours.blackoutDates.includes(todayKey);
    const dayMinutesTotal =
      isBlackout || openMin === null || closeMin === null || closeMin <= openMin
        ? 0
        : closeMin - openMin;
    const utilizationPercent =
      dayMinutesTotal === 0
        ? 100
        : Math.min(
            100,
            Math.round((bookedMinutesToday / dayMinutesTotal) * 100),
          );

    return {
      today: {
        ...today,
        bookedMinutes: bookedMinutesToday,
        availableMinutes: Math.max(0, dayMinutesTotal - bookedMinutesToday),
        totalMinutes: dayMinutesTotal,
        utilizationPercent,
        isOpen: dayMinutesTotal > 0,
      },
      yesterday,
      thisWeek,
      lastWeek,
    };
  },
});

// INTERNAL: cron-driven 24h reminder. Returns the booking ids that need a
// reminder right now — confirmed rows whose appointment is between 23h
// and 25h from now AND that haven't been reminded yet. The 2h-wide
// window gives the hourly cron plenty of slack so no booking can fall
// through the cracks due to scheduling drift.
//
// Filtering on status=confirmed via the by_status index keeps the scan
// cheap; cancellation/completion both leave that index, so they're
// naturally excluded.
export const findBookingsNeedingReminder = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const windowStart = now + 23 * 60 * 60 * 1000;
    const windowEnd = now + 25 * 60 * 60 * 1000;
    const candidates = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "confirmed"))
      .take(500);
    return candidates
      .filter(
        (b) =>
          !b.reminderSentAt &&
          b.slotStart >= windowStart &&
          b.slotStart < windowEnd,
      )
      .map((b) => b._id);
  },
});

// INTERNAL: stamps the reminder timestamp so the same booking can't be
// reminded twice if a future cron run somehow re-includes it.
export const markReminderSent = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.bookingId);
    if (!row || row.reminderSentAt) return;
    await ctx.db.patch(args.bookingId, { reminderSentAt: Date.now() });
  },
});

// INTERNAL: hourly cron entry-point. Loops candidates, fires the email
// action, then marks the row as reminded. The mark happens AFTER the
// send so a transient Resend failure leaves the booking eligible for
// retry on the next cron run. The dedupe flag is the only guarantee
// against double-sends — Resend failures still cost an email but never
// a customer-visible duplicate.
export const dispatchReminders = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const ids: Array<Id<"bookings">> = await ctx.runQuery(
      internal.bookings.findBookingsNeedingReminder,
      {},
    );
    let sent = 0;
    for (const bookingId of ids) {
      await ctx.runAction(internal.emails.sendBookingReminder, { bookingId });
      await ctx.runMutation(internal.bookings.markReminderSent, { bookingId });
      sent++;
    }
    return { sent };
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
