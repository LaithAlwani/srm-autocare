import { v } from "convex/values";
import { query, action, internalAction, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

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
// `create`, `update`, and `remove` are public actions instead of mutations
// because they sync the matching Cal.com event type (HTTP call). They do
// auth + Cal.com side effects, then delegate the actual DB write to
// internal mutations below. The admin no longer enters a calcomEventTypeId
// by hand — it's captured from Cal.com's API response on creation and
// stored on the row automatically.
// ─────────────────────────────────────────────────────────────────

const baseFields = {
  name: v.string(),
  slug: v.string(),
  description: v.string(),
  durationMinutes: v.number(),
  priceFromCents: v.number(),
  depositCents: v.number(),
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

    // 1. Create the matching Cal.com event type — fail fast if Cal.com errors,
    //    so we never end up with a service that has no bookable calendar.
    const { eventTypeId } = await ctx.runAction(
      internal.calcom.createEventTypeInternal,
      {
        title: args.name,
        slug: args.slug,
        lengthInMinutes: args.durationMinutes,
        description: args.description,
      },
    );

    // 2. Insert the service row with the captured event type id.
    return await ctx.runMutation(internal.services.insertInternal, {
      ...args,
      calcomEventTypeId: eventTypeId,
    });
  },
});

export const update = action({
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

    // 1. Sync the change to Cal.com if the row is linked. We only care about
    //    fields Cal.com knows: title (name), duration, description.
    if (existing.calcomEventTypeId) {
      const calPatch: {
        title?: string;
        lengthInMinutes?: number;
        description?: string;
      } = {};
      if (args.patch.name !== undefined && args.patch.name !== existing.name) {
        calPatch.title = args.patch.name;
      }
      if (
        args.patch.durationMinutes !== undefined &&
        args.patch.durationMinutes !== existing.durationMinutes
      ) {
        calPatch.lengthInMinutes = args.patch.durationMinutes;
      }
      if (
        args.patch.description !== undefined &&
        args.patch.description !== existing.description
      ) {
        calPatch.description = args.patch.description;
      }
      if (Object.keys(calPatch).length > 0) {
        await ctx.runAction(internal.calcom.updateEventTypeInternal, {
          eventTypeId: existing.calcomEventTypeId,
          ...calPatch,
        });
      }
    }

    // 2. Patch the local row.
    await ctx.runMutation(internal.services.patchInternal, {
      id: args.id,
      patch: args.patch,
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

    // 1. Delete from Cal.com first so a half-successful op leaves the calendar
    //    clean (better an orphan service row than an orphan calendar event).
    if (existing.calcomEventTypeId) {
      await ctx.runAction(internal.calcom.deleteEventTypeInternal, {
        eventTypeId: existing.calcomEventTypeId,
      });
    }

    // 2. Delete the row + any uploaded image.
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
    calcomEventTypeId: v.optional(v.number()),
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
      slug: v.optional(v.string()),
      description: v.optional(v.string()),
      durationMinutes: v.optional(v.number()),
      priceFromCents: v.optional(v.number()),
      depositCents: v.optional(v.number()),
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

// One-shot maintenance: re-asserts our Cal.com event type defaults
// (slotInterval, lengthInMinutesOptions) on every linked service. Run this
// once after deploying changes that alter our event-type baseline so
// previously-created event types catch up. Returns a per-service report so
// the operator can spot any that failed (e.g. event type was deleted in
// Cal.com). Exposed as `internalAction` so it's callable from `npx convex
// run` without an authenticated user — admin CLI is the access boundary.
export const repairCalcomEventTypes = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<Array<{ id: Id<"services">; name: string; status: "ok" | "skipped" | "error"; message?: string }>> => {
    const services = await ctx.runQuery(api.services.list, { includeInactive: true });
    const results: Array<{
      id: Id<"services">;
      name: string;
      status: "ok" | "skipped" | "error";
      message?: string;
    }> = [];
    for (const s of services) {
      if (typeof s.calcomEventTypeId !== "number") {
        results.push({ id: s._id, name: s.name, status: "skipped", message: "no Cal.com link" });
        continue;
      }
      try {
        await ctx.runAction(internal.calcom.updateEventTypeInternal, {
          eventTypeId: s.calcomEventTypeId,
          // Pass lengthInMinutes so lengthInMinutesOptions is regenerated too.
          // slotInterval is reasserted unconditionally inside the action.
          lengthInMinutes: s.durationMinutes,
        });
        results.push({ id: s._id, name: s.name, status: "ok" });
      } catch (err) {
        results.push({
          id: s._id,
          name: s.name,
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  },
});

// Used by the slot lookup self-heal path: when Cal.com tells us an event
// type no longer exists, we create a fresh one and stamp the new id onto
// the service so subsequent bookings work.
export const setCalcomEventTypeIdInternal = internalMutation({
  args: {
    id: v.id("services"),
    calcomEventTypeId: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { calcomEventTypeId: args.calcomEventTypeId });
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

