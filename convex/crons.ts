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

export default crons;
