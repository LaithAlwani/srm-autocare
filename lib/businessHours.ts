// Shared business-hours types + DST-safe time helpers. Lives outside
// convex/ so the admin Settings UI and the booking page can import the
// same shape the server uses. Pure functions only — no I/O, no React,
// no `process.env`.

// Sunday=0, Monday=1, ... Saturday=6 (matches `Date.prototype.getDay`).
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// A single day's hours. `open`/`close` are local wall-clock strings in
// `HH:MM` (24h). Both null = closed for that weekday.
export type DaySchedule = {
  day: Weekday;
  open: string | null;
  close: string | null;
};

// Partial-day blackout — a single time range on a specific date that
// behaves like an existing booking for the slot generator (any candidate
// whose appointment overlaps it gets dropped). Use for lunch breaks,
// equipment maintenance, supplier visits, etc. Full-day closures still
// live on `blackoutDates`.
export type BlackoutRange = {
  dateISO: string;   // YYYY-MM-DD in the business TZ
  startHHMM: string; // local wall-clock start, e.g. "12:00"
  endHHMM: string;   // local wall-clock end (exclusive), e.g. "13:00"
};

export type BusinessHours = {
  timeZone: string; // IANA, e.g. "America/Toronto"
  slotIntervalMinutes: number; // how often a slot starts (e.g. 30)
  minBookingNoticeMinutes: number; // earliest start = now + this
  bookingWindowDays: number; // how far ahead customers can book
  weekly: DaySchedule[]; // length 7, indexed by `day`
  blackoutDates: string[]; // YYYY-MM-DD in the business TZ (full-day off)
  blackoutRanges: BlackoutRange[]; // partial-day off
};

// Defaults used when the siteContent row is missing or partially
// configured. Chosen to match what we previously set on Cal.com.
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  timeZone: "America/Toronto",
  slotIntervalMinutes: 30,
  minBookingNoticeMinutes: 60,
  bookingWindowDays: 60,
  weekly: [
    { day: 0, open: null, close: null }, // Sun closed
    { day: 1, open: "09:00", close: "18:00" },
    { day: 2, open: "09:00", close: "18:00" },
    { day: 3, open: "09:00", close: "18:00" },
    { day: 4, open: "09:00", close: "18:00" },
    { day: 5, open: "09:00", close: "18:00" },
    { day: 6, open: "09:00", close: "15:00" }, // Sat short day
  ],
  blackoutDates: [],
  blackoutRanges: [],
};

// Merge a partial / unknown value (from siteContent) onto the defaults so
// downstream code can rely on every field being populated. Validates the
// shape just enough to be defensive — anything that looks wrong falls back
// to the default.
export function resolveBusinessHours(input: unknown): BusinessHours {
  if (!input || typeof input !== "object") return DEFAULT_BUSINESS_HOURS;
  const i = input as Partial<BusinessHours>;
  return {
    timeZone:
      typeof i.timeZone === "string" ? i.timeZone : DEFAULT_BUSINESS_HOURS.timeZone,
    slotIntervalMinutes:
      typeof i.slotIntervalMinutes === "number" && i.slotIntervalMinutes > 0
        ? i.slotIntervalMinutes
        : DEFAULT_BUSINESS_HOURS.slotIntervalMinutes,
    minBookingNoticeMinutes:
      typeof i.minBookingNoticeMinutes === "number" && i.minBookingNoticeMinutes >= 0
        ? i.minBookingNoticeMinutes
        : DEFAULT_BUSINESS_HOURS.minBookingNoticeMinutes,
    bookingWindowDays:
      typeof i.bookingWindowDays === "number" && i.bookingWindowDays > 0
        ? i.bookingWindowDays
        : DEFAULT_BUSINESS_HOURS.bookingWindowDays,
    weekly: Array.isArray(i.weekly) && i.weekly.length === 7
      ? (i.weekly as DaySchedule[])
      : DEFAULT_BUSINESS_HOURS.weekly,
    blackoutDates: Array.isArray(i.blackoutDates) ? i.blackoutDates : [],
    blackoutRanges: Array.isArray(i.blackoutRanges)
      ? (i.blackoutRanges as BlackoutRange[])
      : [],
  };
}

// Parse an `HH:MM` string into total minutes since midnight. Returns
// null for malformed input so callers can short-circuit gracefully.
export function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// "YYYY-MM-DD" in the given IANA time zone for the supplied epoch
// (defaults to now). Used to compare against the blackout list and to
// step from one calendar day to the next in find-next-available scans.
export function dayKey(timeZone: string, epochMs: number = Date.now()): string {
  // en-CA's "short" date format conveniently emits YYYY-MM-DD already.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
}

// JS `Date#getDay` returns 0-6 in the LOCAL zone, not the business TZ —
// that breaks when the server runs in UTC. This re-derives the weekday
// from `dayKey` so it's always relative to the business TZ.
export function weekdayInZone(timeZone: string, epochMs: number = Date.now()): Weekday {
  const [y, m, d] = dayKey(timeZone, epochMs).split("-").map(Number);
  // Construct a UTC midnight for that calendar date and ask getUTCDay —
  // weekday math is the same in UTC because we're just naming a day, not
  // shifting times.
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

// Step a YYYY-MM-DD string forward (or backward) by N calendar days.
// String-in, string-out — no timezone math needed because we're staying
// in date-only land.
export function shiftDay(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// Resolve `(dateISO, "HH:MM", timeZone)` to an epoch ms, taking DST
// transitions into account. The trick: ask Intl to format a UTC reference
// epoch at the target wall clock, compare the parts back, then use the
// difference as the zone's offset for that instant. Two iterations
// converge through the DST boundary.
//
// Returns NaN for malformed input so callers can guard with isNaN.
export function epochAt(dateISO: string, hhmm: string, timeZone: string): number {
  const minutes = parseHHMM(hhmm);
  if (minutes === null) return NaN;
  const [y, mo, d] = dateISO.split("-").map(Number);
  if (!y || !mo || !d) return NaN;

  // First guess: pretend the wall clock IS UTC. We'll correct for the
  // zone offset on the next iteration.
  let guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  // Refine twice — second pass handles the rare case where the first
  // correction crosses a DST transition.
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(guess));
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const asUTCOfDisplayed = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour) === 24 ? 0 : Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    const offset = asUTCOfDisplayed - guess;
    const target = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
    guess = target - offset;
  }
  return guess;
}
