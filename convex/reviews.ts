import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin } from "./users";

export const listFeatured = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviews")
      .withIndex("by_featured", (q) => q.eq("featured", true))
      .order("desc")
      .take(args.limit ?? 6);
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("reviews").order("desc").take(128);
  },
});

export const create = mutation({
  args: {
    author: v.string(),
    rating: v.number(),
    body: v.string(),
    source: v.union(v.literal("manual"), v.literal("google")),
    date: v.number(),
    featured: v.boolean(),
    vehicleInfo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db.insert("reviews", args);
  },
});

export const setFeatured = mutation({
  args: { id: v.id("reviews"), featured: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.id, { featured: args.featured });
  },
});

export const remove = mutation({
  args: { id: v.id("reviews") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.delete(args.id);
  },
});
