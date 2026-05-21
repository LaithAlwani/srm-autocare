// Push-only Google Calendar integration. No "use node" — uses Web Crypto
// + fetch in Convex's default V8 runtime. Authentication is per-owner
// OAuth refresh tokens (see convex/googleOauth.ts); event CRUD is via
// Calendar v3 REST.
//
// All three actions are tolerant of failure: errors are logged but
// never re-thrown. The booking lifecycle (confirmation, reschedule,
// cancellation) must NEVER be blocked by a flaky calendar push.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const TZ = "America/Toronto";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Module-scope access token cache. Convex action instances can be
// short-lived, so this is more of an in-flight optimization than a true
// cross-request cache — Google's token endpoint can handle the load
// either way (rate limit is ~600/min per project).
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Get a fresh access token for the connected account. Returns null when
// the integration isn't connected so callers can skip without error.
async function getAccessToken(ctx: {
  runQuery: any;
}): Promise<{ token: string; calendarId: string } | null> {
  const conn = await ctx.runQuery(internal.googleOauth.getConnection);
  if (!conn) return null;

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return { token: cachedAccessToken.token, calendarId: conn.calendarId };
  }

  const clientId = envOrThrow("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = envOrThrow("GOOGLE_OAUTH_CLIENT_SECRET");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: conn.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google refresh failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Google refresh returned no access_token");
  // Cache for ~ (expires_in - 60s) so we always have a small safety margin.
  cachedAccessToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return { token: json.access_token, calendarId: conn.calendarId };
}

type EventBody = {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
};

// Build the Google event payload from a booking row + service. Centralized
// so create + update share exactly one source of truth for the formatting.
function eventBodyFrom(args: {
  customerName: string;
  serviceName: string;
  slotStart: number;
  slotEnd: number;
  vehicleInfo: string;
  notes?: string;
  customerPhone: string;
  customerEmail: string;
}): EventBody {
  const lines = [
    args.vehicleInfo,
    args.notes ? `\nNotes: ${args.notes}` : "",
    `\nPhone: ${args.customerPhone}`,
    `Email: ${args.customerEmail}`,
  ].filter(Boolean);
  return {
    summary: `${args.customerName} — ${args.serviceName}`,
    description: lines.join("\n").trim(),
    start: { dateTime: new Date(args.slotStart).toISOString(), timeZone: TZ },
    end: { dateTime: new Date(args.slotEnd).toISOString(), timeZone: TZ },
  };
}

// INTERNAL: create a Google Calendar event for a freshly-confirmed
// booking. Caller (square.ts) stamps the returned event id via
// internal.bookings.setGoogleCalendarEventId.
export const createEventInternal = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args): Promise<string | null> => {
    try {
      const auth = await getAccessToken(ctx);
      if (!auth) return null;
      const data = await ctx.runQuery(internal.bookings.getForDispatch, {
        bookingId: args.bookingId,
      });
      if (!data || !data.service) return null;
      const body = eventBodyFrom({
        customerName: data.booking.customerName,
        serviceName: data.service.name,
        slotStart: data.booking.slotStart,
        slotEnd: data.booking.slotEnd,
        vehicleInfo: data.booking.vehicleInfo,
        notes: data.booking.notes,
        customerPhone: data.booking.customerPhone,
        customerEmail: data.booking.customerEmail,
      });
      const res = await fetch(
        `${CAL_BASE}/calendars/${encodeURIComponent(auth.calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Google create event failed: ${res.status} ${text}`);
      }
      const json = JSON.parse(text) as { id?: string };
      return json.id ?? null;
    } catch (err) {
      console.error("createEventInternal failed (booking will proceed)", err);
      return null;
    }
  },
});

// INTERNAL: PATCH the existing event after a reschedule. Re-derives the
// full event body from the booking row so a single source of truth keeps
// the calendar in sync if the customer ever changes name/notes/etc.
export const updateEventInternal = internalAction({
  args: {
    googleEventId: v.string(),
    bookingId: v.id("bookings"),
  },
  handler: async (ctx, args): Promise<void> => {
    try {
      const auth = await getAccessToken(ctx);
      if (!auth) return;
      const data = await ctx.runQuery(internal.bookings.getForDispatch, {
        bookingId: args.bookingId,
      });
      if (!data || !data.service) return;
      const body = eventBodyFrom({
        customerName: data.booking.customerName,
        serviceName: data.service.name,
        slotStart: data.booking.slotStart,
        slotEnd: data.booking.slotEnd,
        vehicleInfo: data.booking.vehicleInfo,
        notes: data.booking.notes,
        customerPhone: data.booking.customerPhone,
        customerEmail: data.booking.customerEmail,
      });
      const res = await fetch(
        `${CAL_BASE}/calendars/${encodeURIComponent(auth.calendarId)}/events/${encodeURIComponent(args.googleEventId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok && res.status !== 404) {
        const text = await res.text();
        throw new Error(`Google update event failed: ${res.status} ${text}`);
      }
    } catch (err) {
      console.error("updateEventInternal failed (booking will proceed)", err);
    }
  },
});

// INTERNAL: delete the event when a booking is cancelled. 404 is treated
// as success — somebody may have removed the event in Google's UI first.
export const deleteEventInternal = internalAction({
  args: { googleEventId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    try {
      const auth = await getAccessToken(ctx);
      if (!auth) return;
      const res = await fetch(
        `${CAL_BASE}/calendars/${encodeURIComponent(auth.calendarId)}/events/${encodeURIComponent(args.googleEventId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${auth.token}` },
        },
      );
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        const text = await res.text();
        throw new Error(`Google delete event failed: ${res.status} ${text}`);
      }
    } catch (err) {
      console.error("deleteEventInternal failed (booking will proceed)", err);
    }
  },
});
