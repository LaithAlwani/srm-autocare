import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, type QueryCtx, type MutationCtx } from "./_generated/server";

// Returns the signed-in user document, or null. Cheap to call from any client
// component — Convex will subscribe and re-render on auth state changes.
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db.get(userId);
  },
});

// Returns just the role for client-side route gating.
export const currentUserRole = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    return user?.role ?? null;
  },
});

// Server-side guard. Throws if the caller is not signed in or not an admin/owner.
// Use this at the top of every admin-only mutation/action.
export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<{ userId: string; role: "owner" | "admin" }> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not signed in");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found");
  if (user.role !== "owner" && user.role !== "admin") {
    throw new Error("Not authorized");
  }
  return { userId: user._id, role: user.role };
}
