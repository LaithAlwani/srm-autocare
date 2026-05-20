import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { requireAdmin } from "./users";

// PUBLIC: list active add-ons for the booking flow, in display order.
export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    return args.includeInactive
      ? await ctx.db.query("addOns").withIndex("by_order").take(64)
      : await ctx.db
          .query("addOns")
          .withIndex("by_active_and_order", (q) => q.eq("active", true))
          .take(64);
  },
});

// INTERNAL: resolve a list of add-on IDs back to full rows. Used by the
// booking flow to snapshot the price + duration onto the booking row, and
// by the Square preload + Cal.com booking creation to know the right total.
export const getMany = internalQuery({
  args: { ids: v.array(v.id("addOns")) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return rows.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

// ADMIN
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    durationMinutes: v.number(),
    order: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db.insert("addOns", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("addOns"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      priceCents: v.optional(v.number()),
      durationMinutes: v.optional(v.number()),
      order: v.optional(v.number()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.id, args.patch);
  },
});

export const remove = mutation({
  args: { id: v.id("addOns") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.delete(args.id);
  },
});
