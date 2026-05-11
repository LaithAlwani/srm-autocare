import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin } from "./users";

// PUBLIC: fetch a single content key.
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("siteContent")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return row?.value ?? null;
  },
});

// PUBLIC: batch fetch multiple keys for a single page.
export const getMany = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const out: Record<string, unknown> = {};
    for (const key of args.keys) {
      const row = await ctx.db
        .query("siteContent")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      out[key] = row?.value ?? null;
    }
    return out;
  },
});

// ADMIN
export const set = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("siteContent")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("siteContent", { key: args.key, value: args.value });
    }
  },
});
