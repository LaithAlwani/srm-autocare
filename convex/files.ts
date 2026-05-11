import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./users";

// ADMIN: returns a one-time upload URL for the client to POST a file directly to.
// The flow: 1) call this mutation to get a URL, 2) POST the file to that URL,
// 3) the response body has { storageId }, 4) save that storageId on a row
// (e.g. via gallery.add or services.update).
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// PUBLIC: resolve a storage id to a signed URL the browser can render.
export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
