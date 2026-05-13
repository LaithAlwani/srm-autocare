import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// One-shot cleanup utilities for Convex Auth records that get orphaned when
// a `users` document is deleted manually (e.g. from the Convex dashboard)
// while its linked `authAccounts` / `authSessions` / `authVerificationCodes`
// rows are left behind. The auth library then crashes on the next sign-in
// with "Update on nonexistent document ID …".

// Run with:
//   npx convex run cleanup:orphanedAuthRecordsForEmail '{"email":"someone@example.com"}'
//
// Drops every authAccounts / authSessions / authVerificationCodes /
// authRefreshTokens row tied to the given email so the next sign-in starts
// fresh and creates a brand-new user.
export const orphanedAuthRecordsForEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    let accountsRemoved = 0;
    let sessionsRemoved = 0;
    let codesRemoved = 0;
    let refreshTokensRemoved = 0;
    let usersRemoved = 0;

    // 1) Any leftover user document with that email.
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .collect();
    const userIds = new Set(users.map((u) => u._id));

    // 2) authAccounts rows for the Email provider use the email as
    //    providerAccountId. Plus catch any account that points at a user
    //    in our doomed set (just in case the provider key differs).
    const accounts = await ctx.db.query("authAccounts").collect();
    for (const acc of accounts) {
      const matchesEmail =
        (acc as { providerAccountId?: string }).providerAccountId === args.email;
      const matchesUser =
        userIds.has((acc as { userId?: unknown }).userId as never);
      if (matchesEmail || matchesUser) {
        await ctx.db.delete(acc._id);
        accountsRemoved++;
      }
    }

    // 3) Sessions linked to any of those users.
    const sessions = await ctx.db.query("authSessions").collect();
    for (const s of sessions) {
      if (userIds.has((s as { userId: unknown }).userId as never)) {
        await ctx.db.delete(s._id);
        sessionsRemoved++;
      }
    }

    // 4) Refresh tokens — convex-auth keys these by session, which we just
    //    nuked; the simplest safe sweep is to drop everything that points at
    //    one of the removed sessions. Older library versions key by user.
    const refreshes = await ctx.db.query("authRefreshTokens").collect();
    for (const r of refreshes) {
      const rec = r as { userId?: unknown; sessionId?: unknown };
      if (rec.userId && userIds.has(rec.userId as never)) {
        await ctx.db.delete(r._id);
        refreshTokensRemoved++;
      }
    }

    // 5) Pending verification codes for this email — the OTP flow keys these
    //    by the destination email so we can match exactly.
    const codes = await ctx.db.query("authVerificationCodes").collect();
    for (const c of codes) {
      const rec = c as { emailVerified?: string; identifier?: string };
      if (rec.emailVerified === args.email || rec.identifier === args.email) {
        await ctx.db.delete(c._id);
        codesRemoved++;
      }
    }

    // 6) Finally drop the user rows themselves if any remained.
    for (const u of users) {
      await ctx.db.delete(u._id);
      usersRemoved++;
    }

    return {
      accountsRemoved,
      sessionsRemoved,
      codesRemoved,
      refreshTokensRemoved,
      usersRemoved,
    };
  },
});
