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
    depositCents: v.number(),
    imageStorageId: v.optional(v.id("_storage")),
    icon: v.optional(v.string()),
    badge: v.optional(v.string()),
    // Cal.com event type ID for this service. If unset, falls back to the
    // CALCOM_EVENT_TYPE_ID env var. Each service should ideally have its own
    // event type so durations and availability can differ.
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
    calComBookingId: v.optional(v.string()),
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
    // Moneris identifiers. `monerisOrderId` is OUR generated unique order
    // number — used as the idempotency key (also flows to Moneris as `order_no`).
    // `monerisTxnId` is Moneris's id from the receipt response, required for
    // refunds against the original transaction.
    monerisOrderId: v.optional(v.string()),
    monerisTxnId: v.optional(v.string()),
    // Deprecated — kept on the schema only so existing rows from the Stripe
    // era still validate. New bookings never write these. Safe to remove
    // alongside a one-shot delete-fields migration.
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
    .index("by_moneris_order", ["monerisOrderId"])
    .index("by_calcom_uid", ["calComBookingId"]),
});
