import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin } from "./users";

// PUBLIC: list all gallery items, ordered.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("gallery").withIndex("by_order").take(128);
    return await Promise.all(
      items.map(async (item) => ({
        ...item,
        imageUrl: await ctx.storage.getUrl(item.imageStorageId),
        beforeImageUrl: item.beforeImageStorageId
          ? await ctx.storage.getUrl(item.beforeImageStorageId)
          : null,
      })),
    );
  },
});

// ADMIN
export const add = mutation({
  args: {
    imageStorageId: v.id("_storage"),
    caption: v.optional(v.string()),
    beforeAfter: v.boolean(),
    beforeImageStorageId: v.optional(v.id("_storage")),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db.insert("gallery", args);
  },
});

export const remove = mutation({
  args: { id: v.id("gallery") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const item = await ctx.db.get(args.id);
    if (!item) return;
    await ctx.storage.delete(item.imageStorageId);
    if (item.beforeImageStorageId) {
      await ctx.storage.delete(item.beforeImageStorageId);
    }
    await ctx.db.delete(args.id);
  },
});

export const setOrder = mutation({
  args: {
    items: v.array(v.object({ id: v.id("gallery"), order: v.number() })),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    for (const { id, order } of args.items) {
      await ctx.db.patch(id, { order });
    }
  },
});

export const updateCaption = mutation({
  args: { id: v.id("gallery"), caption: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.id, { caption: args.caption });
  },
});
