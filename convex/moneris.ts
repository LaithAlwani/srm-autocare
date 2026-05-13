// Moneris Checkout — payment processor for Canadian businesses.
// We're on Moneris's modern Checkout product (embedded iframe) — closest
// equivalent to Stripe Elements. Three actions live in this file:
//
//   createCheckoutPreload  — backend creates a checkout ticket + draft booking
//   verifyAndConfirm       — frontend asks us to verify after the iframe says paid
//   createRefundInternal   — admin refund flow (called from bookings.adminRefund)
//
// Moneris doesn't carry arbitrary metadata through to the receipt the way
// Stripe does, so we persist a draft booking row keyed on our own order
// number BEFORE opening the iframe and look it up by order number when
// Moneris confirms. The draft idea also gives us a clean idempotency story.
//
// fetch() is in Convex's default runtime — no `"use node"` needed.

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const MONERIS_TEST_BASE = "https://gatewayt.moneris.com/chkt/request/request.php";
const MONERIS_PROD_BASE = "https://gateway.moneris.com/chkt/request/request.php";

// Moneris Checkout's request.php only handles preload/receipt. Refunds (and
// any post-settlement transaction) go through the older MPG endpoint, which
// speaks XML. Same store_id + api_token authenticate against both.
const MPG_TEST_URL = "https://esqa.moneris.com/gateway2/servlet/MpgRequest";
const MPG_PROD_URL = "https://www3.moneris.com/gateway2/servlet/MpgRequest";

function mpgUrl(): string {
  return monerisEnv() === "prod" ? MPG_PROD_URL : MPG_TEST_URL;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseXmlField(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return match?.[1] ?? "";
}

function monerisEnv(): "qa" | "prod" {
  return process.env.NEXT_PUBLIC_MONERIS_ENVIRONMENT === "prod" ? "prod" : "qa";
}

function monerisUrl(): string {
  return monerisEnv() === "prod" ? MONERIS_PROD_BASE : MONERIS_TEST_BASE;
}

function monerisCreds() {
  const store_id = process.env.MONERIS_STORE_ID;
  const api_token = process.env.MONERIS_API_TOKEN;
  const checkout_id = process.env.MONERIS_CHECKOUT_ID;
  if (!store_id || !api_token || !checkout_id) {
    throw new Error(
      "Moneris credentials are not set. Configure MONERIS_STORE_ID, MONERIS_API_TOKEN, MONERIS_CHECKOUT_ID on the Convex deployment.",
    );
  }
  return { store_id, api_token, checkout_id };
}

// Centralized request helper. Moneris Checkout's request.php endpoint takes
// JSON, returns JSON, and uses a uniform { response: {...} } wrapper on top.
// Errors come back inside the response with `success: "false"` rather than
// HTTP 4xx, so we have to inspect both layers.
//
// Every Checkout-API action (preload, receipt, refund, etc.) needs the same
// four credential fields — store_id, api_token, checkout_id, environment —
// so we stamp them on here. Callers only supply the action-specific fields.
async function monerisRequest<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { store_id, api_token, checkout_id } = monerisCreds();
  const payload = {
    store_id,
    api_token,
    checkout_id,
    environment: monerisEnv(),
    action,
    ...body,
  };
  const res = await fetch(monerisUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moneris ${action} failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    response?: T & { success?: string | boolean; error?: unknown };
  };
  if (!json.response) {
    throw new Error(`Moneris ${action}: malformed response (no 'response' field)`);
  }
  // Moneris returns success as either a string "false" or a real boolean
  // depending on the endpoint. The `error` field can be a string OR a
  // nested object — JSON.stringify it so we always see something useful.
  const success = json.response.success;
  if (success === "false" || success === false) {
    const errBlob =
      typeof json.response.error === "string"
        ? json.response.error
        : JSON.stringify(json.response.error ?? json.response);
    console.error(`Moneris ${action} rejected`, json.response);
    throw new Error(`Moneris ${action} rejected: ${errBlob}`);
  }
  return json.response;
}

// PUBLIC: customer kicks off the Moneris Checkout flow from /book.
// Persists a draft booking row (status: pending) so the webhook + verify
// step can find it by order number, then asks Moneris for a checkout ticket
// to feed into the iframe.
export const createCheckoutPreload = action({
  args: {
    serviceId: v.id("services"),
    slotStart: v.number(),
    slotEnd: v.number(),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    vehicleInfo: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ticket: string; orderNo: string; env: "qa" | "prod" }> => {
    const service = await ctx.runQuery(api.services.get, { id: args.serviceId });
    if (!service) throw new Error("Service not found");
    if (!service.active) throw new Error("Service is not bookable");

    // Order numbers must be unique per Moneris store. Short SRM prefix +
    // crypto.randomUUID for collision resistance. Truncated so we stay under
    // Moneris's order_no length limit (50 chars).
    const orderNo = `srm-${crypto.randomUUID()}`.slice(0, 50);
    const dollars = (service.depositCents / 100).toFixed(2);

    // Persist the draft FIRST so the webhook can find this booking even if
    // the iframe completes payment before our verify call comes back.
    await ctx.runMutation(internal.bookings.createDraft, {
      monerisOrderId: orderNo,
      serviceId: args.serviceId,
      slotStart: args.slotStart,
      slotEnd: args.slotEnd,
      customerName: args.customerName,
      customerEmail: args.customerEmail,
      customerPhone: args.customerPhone,
      vehicleInfo: args.vehicleInfo,
      notes: args.notes,
      depositAmountCents: service.depositCents,
    });

    const response = await monerisRequest<{ ticket?: string }>("preload", {
      txn_total: dollars,
      order_no: orderNo,
      cust_id: args.customerEmail.slice(0, 50),
      contact_details: {
        first_name: args.customerName.split(" ")[0]?.slice(0, 30) ?? "",
        last_name: args.customerName.split(" ").slice(1).join(" ").slice(0, 30) || "—",
        email: args.customerEmail.slice(0, 100),
        phone: args.customerPhone.slice(0, 30),
      },
      // dynamic_descriptor shows on the cardholder's statement.
      dynamic_descriptor: "SRM AUTO CARE",
    });

    if (!response.ticket) {
      throw new Error("Moneris preload returned no ticket");
    }

    return { ticket: response.ticket, orderNo, env: monerisEnv() };
  },
});

// PUBLIC: frontend calls this after Moneris's payment_receipt callback fires.
// We hit Moneris ourselves with action=receipt to get the authoritative
// transaction state — never trust the browser-side callback alone — then
// confirm the booking + kick off Cal.com. Idempotent at the DB layer so the
// webhook firing later (or this getting called twice) is a no-op.
export const verifyAndConfirm = action({
  args: { ticket: v.string(), orderNo: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const response = await monerisRequest<{
      receipt?: {
        cc?: {
          response_code?: string;
          transaction_no?: string;
          amount?: string;
          order_no?: string;
        };
      };
    }>("receipt", { ticket: args.ticket });

    const cc = response.receipt?.cc;
    const code = cc?.response_code ?? "";
    const txnId = cc?.transaction_no ?? "";
    const amount = cc?.amount ?? "0";
    const monerisOrder = cc?.order_no ?? "";

    if (!code || !txnId) {
      throw new Error("Moneris receipt missing response_code/transaction_no");
    }
    // Per Moneris convention, response codes 00–49 are approvals; 50+ and
    // "null" responses are declines/errors.
    const numericCode = Number(code);
    if (!Number.isFinite(numericCode) || numericCode > 49) {
      throw new Error(`Moneris declined the transaction (code ${code})`);
    }
    if (monerisOrder !== args.orderNo) {
      throw new Error(
        `Moneris receipt order_no (${monerisOrder}) did not match expected (${args.orderNo})`,
      );
    }

    const amountCents = Math.round(Number(amount) * 100);

    const { id, isNew } = await ctx.runMutation(internal.bookings.confirmFromMoneris, {
      orderNo: args.orderNo,
      monerisTxnId: txnId,
      amountCents,
    });

    // Only the first call kicks off Cal.com (mutation is atomic).
    if (isNew) {
      await placeCalcomBooking(ctx, id);
    }

    return { ok: true };
  },
});

// Helper: fires the Cal.com booking once we know payment is confirmed. Same
// pattern that used to live inside the Stripe webhook handler.
async function placeCalcomBooking(
  ctx: { runQuery: any; runAction: any; runMutation: any },
  bookingId: Id<"bookings">,
): Promise<void> {
  try {
    const data = await ctx.runQuery(internal.bookings.getForCalcomDispatch, {
      bookingId,
    });
    if (!data) return;
    const eventTypeId =
      data.service?.calcomEventTypeId ?? Number(process.env.CALCOM_EVENT_TYPE_ID);
    if (!eventTypeId || !Number.isFinite(eventTypeId)) {
      console.error(
        `No Cal.com event type configured for service ${data.booking.serviceId} — booking saved without calendar entry`,
      );
      return;
    }
    const calComBookingId: string = await ctx.runAction(
      internal.calcom.createBookingInternal,
      {
        eventTypeId,
        slotStartISO: new Date(data.booking.slotStart).toISOString(),
        customerName: data.booking.customerName,
        customerEmail: data.booking.customerEmail,
        customerPhone: data.booking.customerPhone,
        vehicleInfo: data.booking.vehicleInfo,
        notes: data.booking.notes,
      },
    );
    await ctx.runMutation(internal.bookings.setCalcomBookingId, {
      bookingId,
      calComBookingId,
    });
  } catch (err) {
    console.error("Cal.com booking failed (booking is paid; admin can reconcile)", err);
  }
}

// Result shape from any MPG XML transaction.
type MpgResult =
  | { ok: true; refundedCents: number; transactionId: string; txnType: "purchasecorrection" | "refund" }
  | { ok: false; message: string; responseCode: string };

// Build + send an MPG XML transaction. Returns a tagged result rather than
// throwing on declines so callers can decide whether to fall back to a
// different txn type (e.g. correction → refund).
//
// crypt_type "7" = SSL-enabled merchant — Moneris validates it against the
// original purchase, so it has to match. "7" is the value Moneris Checkout
// uses by default.
async function mpgTransaction(
  txnType: "purchasecorrection" | "refund",
  fields: { orderNo: string; monerisTxnId: string; amountDollars?: string },
): Promise<MpgResult> {
  const { store_id, api_token } = monerisCreds();
  const amountTag =
    fields.amountDollars !== undefined
      ? `<amount>${xmlEscape(fields.amountDollars)}</amount>`
      : "";
  const xml = `<?xml version="1.0"?>
<request>
  <store_id>${xmlEscape(store_id)}</store_id>
  <api_token>${xmlEscape(api_token)}</api_token>
  <${txnType}>
    <order_id>${xmlEscape(fields.orderNo)}</order_id>
    ${amountTag}
    <txn_number>${xmlEscape(fields.monerisTxnId)}</txn_number>
    <crypt_type>7</crypt_type>
  </${txnType}>
</request>`;

  const res = await fetch(mpgUrl(), {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: xml,
  });
  if (!res.ok) {
    const body = await res.text();
    return {
      ok: false,
      message: `HTTP ${res.status}: ${body}`,
      responseCode: String(res.status),
    };
  }

  const respXml = await res.text();
  const responseCode = parseXmlField(respXml, "ResponseCode");
  const numericCode = Number(responseCode);
  const approved =
    Number.isFinite(numericCode) && responseCode !== "null" && numericCode <= 49;

  if (!approved) {
    return {
      ok: false,
      message: parseXmlField(respXml, "Message") || responseCode || "unknown",
      responseCode,
    };
  }

  const transAmount = parseXmlField(respXml, "TransAmount");
  const refundedCents = Number.isFinite(Number(transAmount))
    ? Math.round(Number(transAmount) * 100)
    : 0;
  return {
    ok: true,
    refundedCents,
    transactionId:
      parseXmlField(respXml, "TransID") || parseXmlField(respXml, "ReferenceNum"),
    txnType,
  };
}

// INTERNAL: refund a previously-captured Moneris transaction.
//
// Refunds use Moneris's MPG (Payment Gateway) XML API — NOT the Checkout
// JSON endpoint. Moneris Checkout only handles preload/receipt; everything
// post-settlement (refunds, voids, captures) goes through gateway2 with XML.
//
// Two strategies, with automatic fallback:
//
//   1. **Purchase correction** (a.k.a. void) — same-day before settlement.
//      Zero merchant fee, returns money instantly. Required: the original
//      purchase must be in the OPEN (unsettled) batch and the refund must
//      be for the FULL amount. Moneris rejects anything else with a code in
//      the 470–490 range.
//
//   2. **Refund** — works any time, after settlement. Has a per-txn fee.
//      Required for partial refunds or anything past the batch close.
//
// The caller passes `preferCorrection` when the refund is eligible (full
// amount, no prior partial refunds). We try correction first; if Moneris
// rejects it (typically because the batch has already settled), we
// transparently fall back to a refund so the customer still gets their money.
export const createRefundInternal = internalAction({
  args: {
    monerisTxnId: v.string(),
    amountCents: v.number(),
    orderNo: v.string(),
    reason: v.optional(v.string()),
    // Hint from the caller (bookings.adminRefund) that this is eligible for
    // a zero-fee same-day void. Only honored when the refund is for the full
    // original amount and there are no prior partial refunds.
    preferCorrection: v.optional(v.boolean()),
  },
  handler: async (
    _ctx,
    args,
  ): Promise<{ refundedCents: number; transactionId: string; txnType: "purchasecorrection" | "refund" }> => {
    const dollars = (args.amountCents / 100).toFixed(2);

    // 1) Try purchase correction if eligible. No `amount` — corrections are
    //    always full-void. Cheaper for the merchant when it works.
    if (args.preferCorrection) {
      const correction = await mpgTransaction("purchasecorrection", {
        orderNo: args.orderNo,
        monerisTxnId: args.monerisTxnId,
      });
      if (correction.ok) {
        return {
          refundedCents: correction.refundedCents || args.amountCents,
          transactionId: correction.transactionId,
          txnType: "purchasecorrection",
        };
      }
      // Common reason: batch has closed (Moneris settles daily). Fall through
      // to a real refund silently — the customer doesn't care which mechanism
      // moved their money.
      console.info(
        `Purchase correction not eligible (code ${correction.responseCode}: ${correction.message}); falling back to refund`,
      );
    }

    // 2) Refund — works any time, partial or full.
    const refund = await mpgTransaction("refund", {
      orderNo: args.orderNo,
      monerisTxnId: args.monerisTxnId,
      amountDollars: dollars,
    });
    if (!refund.ok) {
      throw new Error(`Moneris refund declined: ${refund.message}`);
    }

    return {
      refundedCents: refund.refundedCents || args.amountCents,
      transactionId: refund.transactionId,
      txnType: "refund",
    };
  },
});
