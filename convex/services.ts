import { v } from "convex/values";
import { query, action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { slugify } from "../lib/booking";

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

// ─────────────────────────────────────────────────────────────────
// ADMIN
//
// `create`, `update`, and `remove` are actions so they have a place to
// run side effects in the future (image cleanup, etc.). They do auth +
// slug derivation, then delegate the actual DB write to internal
// mutations below.
// ─────────────────────────────────────────────────────────────────

const baseFields = {
  name: v.string(),
  description: v.string(),
  durationMinutes: v.number(),
  priceFromCents: v.number(),
  imageStorageId: v.optional(v.id("_storage")),
  icon: v.optional(v.string()),
  badge: v.optional(v.string()),
  order: v.number(),
  active: v.boolean(),
};

export const create = action({
  args: baseFields,
  handler: async (ctx, args): Promise<Id<"services">> => {
    const me = await ctx.runQuery(api.users.currentUser);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      throw new Error("Not authorized");
    }

    // Slug is derived from the name — admins don't enter it. We do this
    // server-side so the slug is always normalized regardless of which
    // client made the call.
    const slug = slugify(args.name);
    if (!slug) throw new Error("Service name must contain at least one letter or digit");

    return await ctx.runMutation(internal.services.insertInternal, {
      ...args,
      slug,
    });
  },
});

export const update = action({
  args: {
    id: v.id("services"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      durationMinutes: v.optional(v.number()),
      priceFromCents: v.optional(v.number()),
      imageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
      icon: v.optional(v.string()),
      badge: v.optional(v.string()),
      order: v.optional(v.number()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args): Promise<void> => {
    const me = await ctx.runQuery(api.users.currentUser);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      throw new Error("Not authorized");
    }
    const existing = await ctx.runQuery(api.services.get, { id: args.id });
    if (!existing) throw new Error("Service not found");

    // Re-derive the slug whenever the name changes so URLs stay in sync
    // automatically. If the name itself didn't change, slug is left alone.
    const slugPatch =
      args.patch.name !== undefined && args.patch.name !== existing.name
        ? { slug: slugify(args.patch.name) }
        : {};
    if ("slug" in slugPatch && !slugPatch.slug) {
      throw new Error("Service name must contain at least one letter or digit");
    }

    await ctx.runMutation(internal.services.patchInternal, {
      id: args.id,
      patch: { ...args.patch, ...slugPatch },
    });
  },
});

export const remove = action({
  args: { id: v.id("services") },
  handler: async (ctx, args): Promise<void> => {
    const me = await ctx.runQuery(api.users.currentUser);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      throw new Error("Not authorized");
    }
    const existing = await ctx.runQuery(api.services.get, { id: args.id });
    if (!existing) return;
    await ctx.runMutation(internal.services.removeInternal, { id: args.id });
  },
});

// ─────────────────────────────────────────────────────────────────
// Internal helpers — only callable from the actions above. Auth is checked
// in the actions; these just touch the DB.
// ─────────────────────────────────────────────────────────────────

export const insertInternal = internalMutation({
  args: {
    ...baseFields,
    // Slug is supplied by the action (derived from the name) rather than
    // accepted from the admin form.
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("services", args);
  },
});

export const patchInternal = internalMutation({
  args: {
    id: v.id("services"),
    patch: v.object({
      name: v.optional(v.string()),
      // `slug` is patched here when the action re-derives it after a name
      // change. Admins don't have a slug field to edit directly.
      slug: v.optional(v.string()),
      description: v.optional(v.string()),
      durationMinutes: v.optional(v.number()),
      priceFromCents: v.optional(v.number()),
      imageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
      icon: v.optional(v.string()),
      badge: v.optional(v.string()),
      order: v.optional(v.number()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const { imageStorageId, ...rest } = args.patch;
    const patch: Record<string, unknown> = { ...rest };
    if (imageStorageId !== undefined) {
      patch.imageStorageId = imageStorageId === null ? undefined : imageStorageId;
    }
    await ctx.db.patch(args.id, patch);
  },
});

export const removeInternal = internalMutation({
  args: { id: v.id("services") },
  handler: async (ctx, args) => {
    const service = await ctx.db.get(args.id);
    if (service?.imageStorageId) {
      await ctx.storage.delete(service.imageStorageId);
    }
    await ctx.db.delete(args.id);
  },
});

