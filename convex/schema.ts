import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  // Auth library tables (users, authSessions, authAccounts, authVerificationCodes,
  // authRateLimits, authVerifiers, authRefreshTokens). We override `users` below
  // to add our `role` field.
  ...authTables,

  users: defineTable({
    // Fields from authTables.users (kept identical so the auth lib still works).
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Our addition — gates /admin access.
    role: v.optional(v.union(v.literal("owner"), v.literal("admin"))),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  services: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.string(),
    durationMinutes: v.number(),
    priceFromCents: v.number(),
    // Deprecated — kept optional so legacy rows still validate. New code
    // always derives the deposit on the fly as DEPOSIT_FRACTION * total via
    // `computeDepositCents` in lib/booking.ts. Safe to delete the field
    // (and the leftover values) once you don't mind dropping the column.
    depositCents: v.optional(v.number()),
    imageStorageId: v.optional(v.id("_storage")),
    icon: v.optional(v.string()),
    badge: v.optional(v.string()),
    // Deprecated — Cal.com is no longer used. Kept optional so existing
    // rows still validate; new writes never set it.
    calcomEventTypeId: v.optional(v.number()),
    order: v.number(),
    active: v.boolean(),
  })
    .index("by_slug", ["slug"])
    .index("by_order", ["order"])
    .index("by_active_and_order", ["active", "order"]),

  gallery: defineTable({
    imageStorageId: v.id("_storage"),
    caption: v.optional(v.string()),
    beforeAfter: v.boolean(),
    beforeImageStorageId: v.optional(v.id("_storage")),
    order: v.number(),
  }).index("by_order", ["order"]),

  // Add-ons are optional extras the customer can stack onto a service —
  // each one adds price + duration to the appointment. Available to every
  // active service (no per-service filtering yet). The Cal.com event type
  // for each service exposes a range of durations so the total appointment
  // length is communicated to the calendar and blocks subsequent slots from
  // overlapping.
  addOns: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    durationMinutes: v.number(),
    order: v.number(),
    active: v.boolean(),
  })
    .index("by_order", ["order"])
    .index("by_active_and_order", ["active", "order"]),

  reviews: defineTable({
    author: v.string(),
    rating: v.number(),
    body: v.string(),
    source: v.union(v.literal("manual"), v.literal("google")),
    date: v.number(),
    featured: v.boolean(),
    vehicleInfo: v.optional(v.string()),
  }).index("by_featured", ["featured"]),

  siteContent: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  bookings: defineTable({
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
    serviceId: v.id("services"),
    // Add-ons selected at booking time, snapshotted so historical bookings
    // stay legible even if the admin edits or deletes an add-on later.
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
    // Deprecated — Cal.com is no longer used. Kept optional for legacy rows;
    // new code never reads or writes this field.
    calComBookingId: v.optional(v.string()),
    // Google Calendar event id stamped after a successful push to the
    // connected calendar. Used to PATCH on reschedule and DELETE on cancel.
    googleCalendarEventId: v.optional(v.string()),
    slotStart: v.number(),
    slotEnd: v.number(),
    // The original booked time, only set once the first time the booking is
    // rescheduled. Lets the admin see "originally booked for X, now Y".
    originalSlotStart: v.optional(v.number()),
    originalSlotEnd: v.optional(v.number()),
    rescheduledAt: v.optional(v.number()),
    depositAmountCents: v.number(),
    // Total refunded so far across all refund events on this booking. Lets us
    // tell partial vs full refunds and allow further partial refunds up to
    // the remaining balance.
    refundedAmountCents: v.optional(v.number()),
    // Square identifiers. `squareIdempotencyKey` is OUR generated UUID
    // (e.g. `srm-<uuid>`) — sent to Square as the `idempotency_key` on the
    // payment request, used as our lookup key for the draft→confirmed
    // transition, and exposed as the `order_no` URL token on /book/success.
    // `squarePaymentId` is Square's payment id from the /v2/payments response,
    // required for refunds against the original payment.
    squareIdempotencyKey: v.optional(v.string()),
    squarePaymentId: v.optional(v.string()),
    // Deprecated — kept optional so existing rows from prior processors still
    // validate. New bookings never write these. Safe to remove alongside a
    // one-shot delete-fields migration if/when the rows are pruned.
    monerisOrderId: v.optional(v.string()),
    monerisTxnId: v.optional(v.string()),
    stripeSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    paymentStatus: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("partially_refunded"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("completed"),
    ),
    createdAt: v.number(),
  })
    .index("by_email", ["customerEmail"])
    .index("by_status", ["status"])
    .index("by_slot_start", ["slotStart"])
    .index("by_square_idempotency_key", ["squareIdempotencyKey"]),

  // Short-lived OAuth `state` tokens minted when the admin starts a
  // Google Calendar connect flow. Verified + deleted on the callback.
  // Stale rows are swept by a cron in convex/crons.ts every 15 minutes.
  oauthStates: defineTable({
    state: v.string(),
    userId: v.id("users"),
    kind: v.string(), // e.g. "google-calendar"
    createdAt: v.number(),
  }).index("by_state", ["state"]),
});
