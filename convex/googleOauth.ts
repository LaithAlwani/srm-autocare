// Per-owner Google OAuth flow. Stays in Convex's default V8 runtime —
// no "use node", no SDK; plain fetch against Google's OAuth endpoints.
//
// Flow: admin clicks "Connect" in /admin/settings → we mint a state row
// and return the authorize URL → admin walks the Google consent screen
// → Google redirects back to /oauth/google/callback (in http.ts) which
// invokes exchangeCodeInternal to swap the code for a refresh token →
// refresh token is stored in the `googleCalendarConnection` siteContent
// row.

import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalQuery,
  internalAction,
  internalMutation,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireAdmin } from "./users";

const CONNECTION_KEY = "googleCalendarConnection";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const STATE_TTL_MS = 10 * 60 * 1000;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// PUBLIC: read-only connection summary for the admin Settings UI. Never
// surfaces the refresh token — only the connection metadata.
export const getConnectionStatus = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("siteContent")
      .withIndex("by_key", (q) => q.eq("key", CONNECTION_KEY))
      .unique();
    const conn = row?.value as
      | {
          refreshToken?: string;
          calendarId?: string;
          connectedAt?: number;
          connectedByEmail?: string;
        }
      | undefined;
    if (!conn?.refreshToken) return { connected: false as const };
    return {
      connected: true as const,
      calendarId: conn.calendarId ?? "primary",
      connectedAt: conn.connectedAt ?? null,
      connectedByEmail: conn.connectedByEmail ?? null,
    };
  },
});

// ADMIN: returns the URL the browser should redirect to so Google can
// present its consent screen. Mints a single-use `state` token tied to
// the admin's user id with a 10-minute TTL.
export const getAuthUrl = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const me = await ctx.runQuery(api.users.currentUser);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      throw new Error("Not authorized");
    }
    const clientId = envOrThrow("GOOGLE_OAUTH_CLIENT_ID");
    const redirectUri = envOrThrow("GOOGLE_OAUTH_REDIRECT_URI");
    const state = crypto.randomUUID();
    await ctx.runMutation(internal.googleOauth.createState, {
      state,
      userId: me._id,
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("access_type", "offline");
    // `consent` is required on re-connect to make Google reissue a
    // refresh token — without it, repeat connects from the same user
    // only return an access token and our refresh-token cache stays
    // pinned to whatever the first consent gave us.
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  },
});

// INTERNAL: persist a fresh state token so the callback can verify it.
export const createState = internalMutation({
  args: { state: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.insert("oauthStates", {
      state: args.state,
      userId: args.userId,
      kind: "google-calendar",
      createdAt: Date.now(),
    });
  },
});

// INTERNAL: verify + consume a state token. Returns the userId on
// success, throws if the token is unknown or expired.
export const consumeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) throw new Error("Unknown OAuth state");
    const age = Date.now() - row.createdAt;
    await ctx.db.delete(row._id);
    if (age > STATE_TTL_MS) throw new Error("OAuth state expired");
    return { userId: row.userId };
  },
});

// INTERNAL: persist the refresh token + calendar id after a successful
// code exchange. Replaces any prior connection (re-connect overwrites).
export const writeConnection = internalMutation({
  args: {
    refreshToken: v.string(),
    calendarId: v.string(),
    connectedByEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("siteContent")
      .withIndex("by_key", (q) => q.eq("key", CONNECTION_KEY))
      .unique();
    const value = {
      refreshToken: args.refreshToken,
      calendarId: args.calendarId,
      connectedAt: Date.now(),
      connectedByEmail: args.connectedByEmail,
      scope: SCOPE,
    };
    if (existing) {
      await ctx.db.patch(existing._id, { value });
    } else {
      await ctx.db.insert("siteContent", { key: CONNECTION_KEY, value });
    }
  },
});

// INTERNAL: read the user email for stamping `connectedByEmail` on the
// connection row.
export const getUserEmail = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.userId);
    return u?.email ?? "unknown@unknown";
  },
});

// INTERNAL: invoked by the /oauth/google/callback HTTP route. Verifies
// the state, exchanges the code for tokens, persists the refresh token.
// Returns nothing — the HTTP route handles the redirect back to the UI.
export const exchangeCodeInternal = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const { userId } = await ctx.runMutation(internal.googleOauth.consumeState, {
      state: args.state,
    });
    const clientId = envOrThrow("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = envOrThrow("GOOGLE_OAUTH_CLIENT_SECRET");
    const redirectUri = envOrThrow("GOOGLE_OAUTH_REDIRECT_URI");

    const body = new URLSearchParams({
      code: args.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Google token exchange failed: ${res.status} ${text}`);
    }
    const json = JSON.parse(text) as {
      refresh_token?: string;
      access_token?: string;
      scope?: string;
    };
    if (!json.refresh_token) {
      // Google only returns a refresh token on the FIRST consent unless
      // we pass prompt=consent. If this happens we likely failed to ask
      // for it — surface a clear error so the admin retries.
      throw new Error(
        "Google did not return a refresh token. Re-try the connect flow; revoke any prior consent at https://myaccount.google.com/permissions if needed.",
      );
    }

    const email = await ctx.runQuery(internal.googleOauth.getUserEmail, { userId });
    await ctx.runMutation(internal.googleOauth.writeConnection, {
      refreshToken: json.refresh_token,
      calendarId: "primary",
      connectedByEmail: email,
    });
  },
});

// ADMIN: disconnects the integration. Best-effort revokes the refresh
// token on Google's side too so future stale calls don't accidentally
// authenticate.
export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const me = await ctx.runQuery(api.users.currentUser);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      throw new Error("Not authorized");
    }
    const conn = await ctx.runQuery(internal.googleOauth.getConnection);
    if (conn?.refreshToken) {
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(conn.refreshToken)}`,
          { method: "POST" },
        );
      } catch (err) {
        console.warn("Google revoke failed (continuing anyway)", err);
      }
    }
    await ctx.runMutation(internal.googleOauth.clearConnection);
  },
});

// INTERNAL: read the full connection (refresh token included) for the
// access-token cache in googleCalendar.ts.
export const getConnection = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("siteContent")
      .withIndex("by_key", (q) => q.eq("key", CONNECTION_KEY))
      .unique();
    return (row?.value as
      | {
          refreshToken: string;
          calendarId: string;
          connectedAt: number;
          connectedByEmail: string;
          scope: string;
        }
      | undefined) ?? null;
  },
});

// INTERNAL: wipe the connection row.
export const clearConnection = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("siteContent")
      .withIndex("by_key", (q) => q.eq("key", CONNECTION_KEY))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// INTERNAL: housekeeping cron — drop state rows older than the TTL.
// Called from convex/crons.ts.
export const cleanupExpiredStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STATE_TTL_MS;
    const stale = await ctx.db.query("oauthStates").take(200);
    let removed = 0;
    for (const row of stale) {
      if (row.createdAt < cutoff) {
        await ctx.db.delete(row._id);
        removed++;
      }
    }
    return { removed };
  },
});
