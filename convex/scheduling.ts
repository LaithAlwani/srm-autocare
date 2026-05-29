// No "use node" — pure compute against our own DB, no third-party API
// calls. Replaces convex/calcom.ts for everything customer-facing in the
// booking flow.

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin } from "./users";
import {
  BusinessHours,
  resolveBusinessHours,
  parseHHMM,
  dayKey,
  weekdayInZone,
  shiftDay,
  epochAt,
} from "../lib/businessHours";

const BUSINESS_HOURS_KEY = "businessHours";

// PUBLIC: business hours snapshot used by the admin settings editor + any
// place on the public site that wants to show "today's hours".
export const getBusinessHours = query({
  args: {},
  handler: async (ctx): Promise<BusinessHours> => {
    const row = await ctx.db
      .query("siteContent")
      .withIndex("by_key", (q) => q.eq("key", BUSINESS_HOURS_KEY))
      .unique();
    return resolveBusinessHours(row?.value);
  },
});

// ADMIN: full overwrite of the business hours row. Coming from the
// Settings UI which sends the entire shape every save — simpler than
// merging patches.
export const setBusinessHours = mutation({
  args: {
    timeZone: v.string(),
    slotIntervalMinutes: v.number(),
    minBookingNoticeMinutes: v.number(),
    bookingWindowDays: v.number(),
    weekly: v.array(
      v.object({
        day: v.number(),
        open: v.union(v.string(), v.null()),
        close: v.union(v.string(), v.null()),
      }),
    ),
    blackoutDates: v.array(v.string()),
    blackoutRanges: v.array(
      v.object({
        dateISO: v.string(),
        startHHMM: v.string(),
        endHHMM: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("siteContent")
      .withIndex("by_key", (q) => q.eq("key", BUSINESS_HOURS_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args });
    } else {
      await ctx.db.insert("siteContent", { key: BUSINESS_HOURS_KEY, value: args });
    }
  },
});

// PUBLIC: list available slot start times for a given service + day,
// optionally extended by the total duration of any selected add-ons.
// Returns ISO8601 strings — same shape the old Cal.com action returned,
// so frontend code didn't have to change.
//
// `excludeBookingId` lets the reschedule modal ignore the booking it's
// moving so the row doesn't block itself out of nearby slots.
//
// This is a query (not an action) so frontends using `useQuery` get
// live updates whenever the bookings table changes — cancelling a
// booking frees its slot for everyone viewing /book without a reload.
export const listSlots = query({
  args: {
    serviceId: v.id("services"),
    dateISO: v.string(),
    totalDurationMinutes: v.optional(v.number()),
    excludeBookingId: v.optional(v.id("bookings")),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) return [];
    const hours = await loadBusinessHours(ctx);
    const totalMinutes = Math.max(
      1,
      args.totalDurationMinutes ?? service.durationMinutes,
    );
    return await computeSlots(ctx, hours, args.dateISO, totalMinutes, args.excludeBookingId);
  },
});

// PUBLIC: scan up to `bookingWindowDays` ahead for the first date with at
// least one bookable slot for this service. Returns YYYY-MM-DD or null.
// Same reactive story as listSlots — useQuery will re-fire when bookings
// or business hours change.
export const findNextAvailableDate = query({
  args: {
    serviceId: v.id("services"),
    totalDurationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const service = await ctx.db.get(args.serviceId);
    if (!service) return null;
    const hours = await loadBusinessHours(ctx);
    const totalMinutes = Math.max(
      1,
      args.totalDurationMinutes ?? service.durationMinutes,
    );

    let cursor = dayKey(hours.timeZone);
    for (let i = 0; i < hours.bookingWindowDays; i++) {
      const slots = await computeSlots(ctx, hours, cursor, totalMinutes);
      if (slots.length > 0) return cursor;
      cursor = shiftDay(cursor, 1);
    }
    return null;
  },
});

// Internal helper — read the businessHours siteContent row directly so
// listSlots / findNextAvailableDate don't have to runQuery another query
// (which queries can't do anyway). Falls back to defaults via the same
// resolver used elsewhere.
async function loadBusinessHours(ctx: { db: any }): Promise<BusinessHours> {
  const row = await ctx.db
    .query("siteContent")
    .withIndex("by_key", (q: any) => q.eq("key", BUSINESS_HOURS_KEY))
    .unique();
  return resolveBusinessHours(row?.value);
}

// Heart of the scheduler. Pure-ish — takes business hours, the calendar
// day to scan, and the appointment length, returns the bookable starts.
// `ctx.db` is only used to fetch existing bookings for collision detection.
// `excludeBookingId` is dropped from the collision set (reschedule flow).
async function computeSlots(
  ctx: { db: any },
  hours: BusinessHours,
  dateISO: string,
  totalMinutes: number,
  excludeBookingId?: string,
): Promise<string[]> {
  // 1. Day-level disqualifiers — blackout, closed weekday, past day, or
  //    today (same-day bookings are deliberately not allowed; the shop
  //    needs at least 24h notice to prep).
  if (hours.blackoutDates.includes(dateISO)) return [];

  const todayKey = dayKey(hours.timeZone);
  if (dateISO <= todayKey) return [];

  const weekday = weekdayInZone(
    hours.timeZone,
    epochAt(dateISO, "12:00", hours.timeZone),
  );
  const schedule = hours.weekly.find((d) => d.day === weekday);
  if (!schedule) return [];

  const openMin = parseHHMM(schedule.open);
  const closeMin = parseHHMM(schedule.close);
  if (openMin === null || closeMin === null || closeMin <= openMin) return [];

  // 2. Build candidate start times in the business TZ wall clock.
  const dayStartMs = epochAt(dateISO, schedule.open!, hours.timeZone);
  const dayEndMs = epochAt(dateISO, schedule.close!, hours.timeZone);
  const earliest = Date.now() + hours.minBookingNoticeMinutes * 60 * 1000;
  const slotMs = hours.slotIntervalMinutes * 60 * 1000;
  const appointmentMs = totalMinutes * 60 * 1000;

  const candidates: number[] = [];
  for (let start = dayStartMs; start + appointmentMs <= dayEndMs; start += slotMs) {
    if (start < earliest) continue;
    candidates.push(start);
  }
  if (candidates.length === 0) return [];

  // 3. Pull *confirmed* bookings that touch our window and drop any
  //    candidate whose appointment overlaps with one. We deliberately
  //    DON'T treat pending rows as collisions — pending = customer is
  //    mid-checkout (or abandoned), nothing's actually paid yet, so we
  //    don't want them locking up the calendar. The reschedule flow
  //    passes `excludeBookingId` so the row being moved doesn't block
  //    its own neighborhood.
  const rows = await ctx.db
    .query("bookings")
    .withIndex("by_slot_start", (q: any) =>
      q.gte("slotStart", dayStartMs - 24 * 60 * 60 * 1000),
    )
    .take(200);
  const existing = rows.filter(
    (b: { _id: string; status: string; slotStart: number; slotEnd: number }) =>
      b._id !== excludeBookingId &&
      b.status === "confirmed" &&
      b.slotStart < dayEndMs &&
      b.slotEnd > dayStartMs,
  );

  // 4. Resolve any partial-day blackouts for this date into epoch ranges.
  //    Treated exactly like an existing booking for collision purposes.
  const blockedRanges = hours.blackoutRanges
    .filter((r) => r.dateISO === dateISO)
    .map((r) => ({
      start: epochAt(dateISO, r.startHHMM, hours.timeZone),
      end: epochAt(dateISO, r.endHHMM, hours.timeZone),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);

  const free = candidates.filter((start) => {
    const end = start + appointmentMs;
    const overlapsBooking = existing.some(
      (b: { slotStart: number; slotEnd: number }) =>
        b.slotStart < end && b.slotEnd > start,
    );
    if (overlapsBooking) return false;
    const overlapsBlackout = blockedRanges.some(
      (r) => r.start < end && r.end > start,
    );
    return !overlapsBlackout;
  });

  return free.map((ms) => new Date(ms).toISOString());
}
