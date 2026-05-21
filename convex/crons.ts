import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sweep up abandoned draft bookings every 15 minutes. A "draft" is a row
// in `bookings` with status: "pending" — created when a customer reaches the
// payment step but never completed checkout. The mutation deletes any draft
// older than 30 minutes so /admin/bookings PENDING filter doesn't fill up
// with noise.
crons.interval(
  "cleanup abandoned booking drafts",
  { minutes: 15 },
  internal.bookings.cleanupAbandonedDrafts,
  {},
);

// Drop stale OAuth `state` rows minted by the Google connect flow. The
// state has a 10-minute TTL — anything older was either consumed
// successfully (and self-deleted) or abandoned mid-flow.
crons.interval(
  "cleanup expired oauth states",
  { minutes: 15 },
  internal.googleOauth.cleanupExpiredStates,
  {},
);

// Send 24h-before reminder emails. The dispatcher looks for confirmed
// bookings whose appointment is 23-25h away and that haven't been
// reminded yet (reminderSentAt flag). Hourly cadence is plenty — the
// 2-hour-wide window means every booking falls into exactly one cron
// run, and the flag dedupes anything that overlaps.
crons.interval(
  "send 24h booking reminders",
  { hours: 1 },
  internal.bookings.dispatchReminders,
  {},
);

export default crons;
