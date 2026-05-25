import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// Mounts /.well-known/openid-configuration, /api/auth/signin/*, etc.
auth.addHttpRoutes(http);

// Square webhook — optional defense-in-depth handler. The happy path is
// that the customer pays, our confirmAndCharge action in square.ts confirms
// the booking synchronously, and this webhook is a no-op. It catches:
//
//   - Customers who close the tab between Square approving and our
//     confirmAndCharge returning. The `payment.updated` event arrives later
//     and promotes the draft via the same idempotent mutation.
//   - Refunds initiated directly inside the Square Dashboard (admin Refund
//     button updates the row synchronously; this catches the out-of-band case).
//
// Configure in Square Developer Dashboard → Webhook Subscriptions:
//   Notification URL  https://<convex-site-url>/square/webhook
//   Events            payment.updated, refund.updated
//   Signature key     stored as SQUARE_WEBHOOK_SIGNATURE_KEY on the deployment
//
// Square signs the request with HMAC-SHA256 over the notification URL
// concatenated with the raw body and ships the digest as base64 in the
// `x-square-hmacsha256-signature` header.
http.route({
  path: "/square/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (!secret) return new Response("Missing SQUARE_WEBHOOK_SIGNATURE_KEY", { status: 500 });

    const sig = req.headers.get("x-square-hmacsha256-signature");
    if (!sig) return new Response("Missing signature", { status: 400 });

    const body = await req.text();
    // Square's HMAC is computed over (notification URL + body), not body
    // alone. We must hash exactly what Square hashed, which means using the
    // public-facing URL we registered in the dashboard — req.url here is
    // the internal Convex URL, so we rebuild it from a configured value.
    const notificationUrl =
      process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ??
      `${process.env.CONVEX_SITE_URL ?? ""}/square/webhook`;
    const expected = await hmacSha256Base64(secret, notificationUrl + body);
    if (!timingSafeEqual(expected, sig)) {
      return new Response("Bad signature", { status: 400 });
    }

    type SquareWebhook = {
      type?: string;
      data?: {
        object?: {
          payment?: {
            id?: string;
            status?: string;
            amount_money?: { amount?: number };
            reference_id?: string;
          };
          refund?: {
            id?: string;
            status?: string;
            payment_id?: string;
            amount_money?: { amount?: number };
          };
        };
      };
    };
    let event: SquareWebhook;
    try {
      event = JSON.parse(body) as SquareWebhook;
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    if (event.type === "payment.updated") {
      const payment = event.data?.object?.payment;
      if (!payment?.id || !payment.reference_id) {
        return new Response("bad payment payload", { status: 400 });
      }
      // Only act on completed payments — Square also fires CREATED /
      // PENDING transitions for the same payment, which are noise.
      if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
        return new Response("ignored (not completed)", { status: 200 });
      }
      // In the new "save-on-success" flow, the booking is created by
      // confirmAndCharge AFTER Square approves — so a corresponding row
      // should already exist by the time this webhook lands. If it does
      // we're a no-op (just a sanity verification). If it DOESN'T, the
      // customer's confirmAndCharge call failed at the insert step
      // (extremely rare: Convex outage mid-action). We can't recreate
      // the booking from the webhook payload alone because Square never
      // sees customer/vehicle/notes — the only safe move is to log
      // loudly and let admin reconcile from the Square dashboard.
      const booking = await ctx.runQuery(
        internal.bookings.getInternalBySquareIdempotency,
        { idempotencyKey: payment.reference_id },
      );
      if (!booking) {
        console.error(
          `[square webhook] Orphan payment ${payment.id} (ref ${payment.reference_id}) — booking insert may have failed; manual reconciliation needed.`,
        );
        return new Response("ok (orphan logged)", { status: 200 });
      }
      return new Response("ok", { status: 200 });
    }

    if (event.type === "refund.updated") {
      const refund = event.data?.object?.refund;
      if (!refund?.payment_id) {
        return new Response("bad refund payload", { status: 400 });
      }
      // Only act on completed/pending refunds. Square also fires this when a
      // refund is REJECTED — leave the booking alone in that case.
      if (refund.status !== "COMPLETED" && refund.status !== "PENDING") {
        return new Response("ignored (refund not settled)", { status: 200 });
      }
      const booking = await ctx.runQuery(internal.bookings.getInternalBySquarePaymentId, {
        squarePaymentId: refund.payment_id,
      });
      if (!booking) {
        console.warn(`Refund webhook: no booking with Square payment ${refund.payment_id}`);
        return new Response("ignored", { status: 200 });
      }
      // Square's webhook payload is the cumulative refund amount for this
      // specific refund row. A payment can have multiple partial refunds, so
      // we sum what's on the booking already with the incoming amount. The
      // applyRefund mutation picks max(existing, incoming) to stay
      // monotonic in case events arrive out of order.
      const amountCents = refund.amount_money?.amount ?? 0;
      const newTotal = (booking.refundedAmountCents ?? 0) + amountCents;
      await ctx.runMutation(internal.bookings.applyRefund, {
        bookingId: booking._id,
        totalRefundedCents: newTotal,
      });
      return new Response("ok", { status: 200 });
    }

    return new Response("ignored", { status: 200 });
  }),
});

// Google OAuth callback: lands here after the owner consents on Google's
// screen. Exchanges the auth code for tokens (stored in Convex), then
// redirects back to /admin/settings with a status flag for the toast UI.
//
// Whitelist this URL in the GCP Console under OAuth client credentials.
http.route({
  path: "/oauth/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const siteUrl = process.env.SITE_URL ?? "";
    const redirectBase = siteUrl ? `${siteUrl}/admin/settings` : "/admin/settings";

    if (error) {
      return Response.redirect(
        `${redirectBase}?googleError=${encodeURIComponent(error)}`,
        302,
      );
    }
    if (!code || !state) {
      return Response.redirect(`${redirectBase}?googleError=missing_code`, 302);
    }

    try {
      await ctx.runAction(internal.googleOauth.exchangeCodeInternal, { code, state });
      return Response.redirect(`${redirectBase}?googleConnected=1`, 302);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      return Response.redirect(
        `${redirectBase}?googleError=${encodeURIComponent(message)}`,
        302,
      );
    }
  }),
});

// HMAC-SHA256, base64-encoded. Square ships its webhook signature in base64.
async function hmacSha256Base64(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default http;
