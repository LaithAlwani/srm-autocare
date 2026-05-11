import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin } from "./users";

// PUBLIC: list active services for marketing pages.
export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const services = args.includeInactive
      ? await ctx.db.query("services").withIndex("by_order").take(64)
      : await ctx.db
          .query("services")
          .withIndex("by_active_and_order", (q) => q.eq("active", true))
          .take(64);
    // Resolve hero image URLs server-side so the client doesn't need an extra query per row.
    return await Promise.all(
      services.map(async (s) => ({
        ...s,
        imageUrl: s.imageStorageId ? await ctx.storage.getUrl(s.imageStorageId) : null,
      })),
    );
  },
});

// PUBLIC: fetch a single service by slug for /services/[slug] (if we add it later).
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const service = await ctx.db
      .query("services")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!service) return null;
    return {
      ...service,
      imageUrl: service.imageStorageId ? await ctx.storage.getUrl(service.imageStorageId) : null,
    };
  },
});

// PUBLIC: fetch a single service by id (used by booking flow).
export const get = query({
  args: { id: v.id("services") },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.id);
    if (!service) return null;
    return {
      ...service,
      imageUrl: service.imageStorageId ? await ctx.storage.getUrl(service.imageStorageId) : null,
    };
  },
});

// ADMIN
export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    description: v.string(),
    durationMinutes: v.number(),
    priceFromCents: v.number(),
    depositCents: v.number(),
    imageStorageId: v.optional(v.id("_storage")),
    icon: v.optional(v.string()),
    badge: v.optional(v.string()),
    calcomEventTypeId: v.optional(v.number()),
    order: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db.insert("services", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("services"),
    patch: v.object({
      name: v.optional(v.string()),
      slug: v.optional(v.string()),
      description: v.optional(v.string()),
      durationMinutes: v.optional(v.number()),
      priceFromCents: v.optional(v.number()),
      depositCents: v.optional(v.number()),
      imageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
      icon: v.optional(v.string()),
      badge: v.optional(v.string()),
      calcomEventTypeId: v.optional(v.union(v.number(), v.null())),
      order: v.optional(v.number()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { imageStorageId, calcomEventTypeId, ...rest } = args.patch;
    const patch: Record<string, unknown> = { ...rest };
    if (imageStorageId !== undefined) {
      patch.imageStorageId = imageStorageId === null ? undefined : imageStorageId;
    }
    if (calcomEventTypeId !== undefined) {
      patch.calcomEventTypeId = calcomEventTypeId === null ? undefined : calcomEventTypeId;
    }
    await ctx.db.patch(args.id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("services") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const service = await ctx.db.get(args.id);
    if (service?.imageStorageId) {
      await ctx.storage.delete(service.imageStorageId);
    }
    await ctx.db.delete(args.id);
  },
});
