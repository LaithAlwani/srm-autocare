import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { siteConfig } from "../config/site";

// Branded transactional emails for the booking lifecycle. Uses the same
// Resend client + AUTH_FROM_EMAIL env var that already powers admin OTP
// — no new account setup. Each action is internalAction (callable from
// other Convex code, not the browser) and never re-throws on failure:
// the booking state change must never be blocked by a flaky email.

const TZ = "America/Toronto";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Loads the Resend client + sender address. Returns null when Resend
// isn't configured (e.g. local dev without keys) so the caller can skip
// sending without crashing the booking flow.
//
// The `from` field is built as `"SRM Auto Care <email>"` so recipient
// inboxes show the brand name as the sender instead of the local-part
// of the email (otherwise Gmail/etc. display "autocare" or "noreply").
function loadResend(): { client: Resend; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — skipping booking email");
    return null;
  }
  const address = process.env.AUTH_FROM_EMAIL ?? "noreply@srm-autocare.com";
  const from = `${siteConfig.shortName} ${siteConfig.name} <${address}>`;
  return { client: new Resend(apiKey), from };
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-CA", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Shared header/footer chrome so the three templates stay visually
// consistent. The dark palette mirrors the public site so the email
// doesn't feel like a different brand.
function wrap(body: string, preheader: string): string {
  const shopName = siteConfig.name;
  const shopPhone = siteConfig.contact.phone;
  const shopEmail = siteConfig.contact.email;
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(shopName)}</title></head>
<body style="margin:0;padding:0;background:#0a0a0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f5f5f7;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0a0d;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#131319;border:1px solid #26262e;">
        <tr><td style="padding:32px 32px 24px;border-bottom:1px solid #26262e;">
          <div style="font-size:11px;letter-spacing:0.2em;color:#6b6b73;text-transform:uppercase;">${escapeHtml(shopName)}</div>
        </td></tr>
        <tr><td style="padding:32px;">${body}</td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #26262e;font-size:13px;color:#6b6b73;line-height:1.6;">
          Questions? Reply to this email or call <a href="tel:${escapeHtml(shopPhone)}" style="color:#1e88ff;text-decoration:none;">${escapeHtml(shopPhone)}</a>.<br>
          <a href="mailto:${escapeHtml(shopEmail)}" style="color:#1e88ff;text-decoration:none;">${escapeHtml(shopEmail)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Compact booking summary block used in all three templates.
function summaryBlock(args: {
  serviceName: string;
  slotStartLabel: string;
  vehicleInfo: string;
  addOns?: Array<{ name: string; priceCents: number }>;
  depositCents?: number;
  depositLabel?: string;
}): string {
  const rows: string[] = [
    row("Service", args.serviceName),
    row("When", args.slotStartLabel),
    row("Vehicle", args.vehicleInfo),
  ];
  if (args.addOns && args.addOns.length > 0) {
    rows.push(
      row(
        "Add-ons",
        args.addOns
          .map(
            (a) =>
              `${escapeHtml(a.name)} <span style="color:#6b6b73;">(+${escapeHtml(formatMoney(a.priceCents))})</span>`,
          )
          .join("<br>"),
        true,
      ),
    );
  }
  if (args.depositCents !== undefined) {
    rows.push(
      row(
        args.depositLabel ?? "Deposit paid",
        formatMoney(args.depositCents),
      ),
    );
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:24px;">${rows.join("")}</table>`;
}

function row(label: string, value: string, valueIsHtml = false): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #26262e;width:120px;color:#6b6b73;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:10px 0;border-bottom:1px solid #26262e;color:#f5f5f7;font-size:14px;">${valueIsHtml ? value : escapeHtml(value)}</td>
  </tr>`;
}

// Loads booking + service + (always non-null guard) so each action below
// stays small. Returns null if the booking has been deleted between
// scheduling the email and running it.
async function loadBookingContext(
  ctx: { runQuery: any },
  bookingId: string,
): Promise<{
  booking: any;
  service: any;
} | null> {
  const data = await ctx.runQuery(internal.bookings.getForDispatch, {
    bookingId: bookingId as never,
  });
  if (!data) return null;
  return data as { booking: any; service: any };
}

// INTERNAL: confirmation email fired right after Square approves payment.
// Includes the cancellation policy so the customer is reminded of it
// before the 48h window starts ticking.
export const sendBookingConfirmation = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    try {
      const resend = loadResend();
      if (!resend) return;
      const ctxData = await loadBookingContext(ctx, args.bookingId);
      if (!ctxData) return;
      const { booking, service } = ctxData;

      const body = `
        <h1 style="margin:0 0 8px;color:#f5f5f7;font-size:24px;font-weight:600;">You're booked</h1>
        <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;line-height:1.6;">
          Thanks ${escapeHtml(booking.customerName.split(" ")[0] ?? booking.customerName)} — we'll see you on
          <strong style="color:#f5f5f7;">${escapeHtml(formatDateTime(booking.slotStart))}</strong>.
        </p>
        ${summaryBlock({
          serviceName: service?.name ?? "Service",
          slotStartLabel: formatDateTime(booking.slotStart),
          vehicleInfo: booking.vehicleInfo,
          addOns: booking.selectedAddOns,
          depositCents: booking.depositAmountCents,
        })}
        <div style="margin-top:24px;padding:16px;border:1px solid #26262e;background:#0f0f14;">
          <div style="font-size:11px;letter-spacing:0.1em;color:#6b6b73;text-transform:uppercase;margin-bottom:6px;">Cancellation policy</div>
          <p style="margin:0;color:#a1a1aa;font-size:13px;line-height:1.6;">
            Your deposit secures the slot. Cancel at least <strong style="color:#f5f5f7;">48 hours</strong> before your appointment for a full refund — cancellations inside that window, or no-shows, forfeit the deposit.
          </p>
        </div>
        <p style="margin:24px 0 0;color:#a1a1aa;font-size:13px;line-height:1.6;">
          Need to change something? Just reply to this email and we'll sort it out.
        </p>
      `;

      await resend.client.emails.send({
        from: resend.from,
        to: booking.customerEmail,
        subject: `Booking confirmed — ${formatDateTime(booking.slotStart)}`,
        html: wrap(body, `Your ${service?.name ?? "appointment"} is confirmed.`),
      });
    } catch (err) {
      console.error("sendBookingConfirmation failed", err);
    }
  },
});

// INTERNAL: reschedule email fired when admin moves an appointment.
// Surfaces both the old and new time so the customer can spot the change
// at a glance.
export const sendBookingRescheduled = internalAction({
  args: {
    bookingId: v.id("bookings"),
    previousSlotStart: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const resend = loadResend();
      if (!resend) return;
      const ctxData = await loadBookingContext(ctx, args.bookingId);
      if (!ctxData) return;
      const { booking, service } = ctxData;

      const body = `
        <h1 style="margin:0 0 8px;color:#f5f5f7;font-size:24px;font-weight:600;">Your appointment has been rescheduled</h1>
        <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;line-height:1.6;">
          We had to move your <strong style="color:#f5f5f7;">${escapeHtml(service?.name ?? "appointment")}</strong>.
          You're now booked for <strong style="color:#f5f5f7;">${escapeHtml(formatDateTime(booking.slotStart))}</strong>
          (previously <span style="color:#6b6b73;text-decoration:line-through;">${escapeHtml(formatDateTime(args.previousSlotStart))}</span>).
        </p>
        ${summaryBlock({
          serviceName: service?.name ?? "Service",
          slotStartLabel: formatDateTime(booking.slotStart),
          vehicleInfo: booking.vehicleInfo,
          addOns: booking.selectedAddOns,
        })}
        <p style="margin:24px 0 0;color:#a1a1aa;font-size:13px;line-height:1.6;">
          If this new time doesn't work for you, reply to this email and we'll find another one.
        </p>
      `;

      await resend.client.emails.send({
        from: resend.from,
        to: booking.customerEmail,
        subject: `Rescheduled — now ${formatDateTime(booking.slotStart)}`,
        html: wrap(body, `Your appointment moved to ${formatDateTime(booking.slotStart)}.`),
      });
    } catch (err) {
      console.error("sendBookingRescheduled failed", err);
    }
  },
});

// INTERNAL: new-booking notification fired to OWNER_EMAIL so the shop sees
// fresh bookings without refreshing /admin/bookings. Different body shape
// from the customer email — denser, geared toward "here's the customer
// phone, here's the vehicle, here's the time". Includes a deep link back
// into /admin/bookings.
//
// Skips silently when OWNER_EMAIL isn't set so dev environments without
// the variable don't fail noisily.
export const sendOwnerBookingNotification = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    try {
      const ownerEmail = process.env.OWNER_EMAIL;
      if (!ownerEmail) {
        console.warn("OWNER_EMAIL not set — skipping owner notification");
        return;
      }
      const resend = loadResend();
      if (!resend) return;
      const ctxData = await loadBookingContext(ctx, args.bookingId);
      if (!ctxData) return;
      const { booking, service } = ctxData;
      const adminUrl = `${process.env.SITE_URL ?? ""}/admin/bookings`;

      const body = `
        <h1 style="margin:0 0 8px;color:#f5f5f7;font-size:22px;font-weight:600;">New booking</h1>
        <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;line-height:1.6;">
          <strong style="color:#f5f5f7;">${escapeHtml(formatDateTime(booking.slotStart))}</strong>
          · <strong style="color:#f5f5f7;">${escapeHtml(service?.name ?? "Service")}</strong>
        </p>
        ${summaryBlock({
          serviceName: service?.name ?? "Service",
          slotStartLabel: formatDateTime(booking.slotStart),
          vehicleInfo: booking.vehicleInfo,
          addOns: booking.selectedAddOns,
          depositCents: booking.depositAmountCents,
          depositLabel: "Deposit paid",
        })}
        <div style="margin-top:24px;padding:16px;border:1px solid #26262e;background:#0f0f14;">
          <div style="font-size:11px;letter-spacing:0.1em;color:#6b6b73;text-transform:uppercase;margin-bottom:8px;">Customer</div>
          <div style="color:#f5f5f7;font-size:14px;margin-bottom:4px;">${escapeHtml(booking.customerName)}</div>
          <div style="color:#a1a1aa;font-size:14px;">
            <a href="tel:${escapeHtml(booking.customerPhone)}" style="color:#1e88ff;text-decoration:none;">${escapeHtml(booking.customerPhone)}</a>
            ·
            <a href="mailto:${escapeHtml(booking.customerEmail)}" style="color:#1e88ff;text-decoration:none;">${escapeHtml(booking.customerEmail)}</a>
          </div>
          ${
            booking.notes
              ? `<div style="margin-top:12px;color:#a1a1aa;font-size:13px;font-style:italic;line-height:1.6;">“${escapeHtml(booking.notes)}”</div>`
              : ""
          }
        </div>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;">
          <a href="${escapeHtml(adminUrl)}" style="color:#1e88ff;text-decoration:none;">Open in admin →</a>
        </p>
      `;

      await resend.client.emails.send({
        from: resend.from,
        to: ownerEmail,
        replyTo: booking.customerEmail,
        subject: `New booking: ${booking.customerName} — ${formatDateTime(booking.slotStart)}`,
        html: wrap(body, `${booking.customerName} just booked.`),
      });
    } catch (err) {
      console.error("sendOwnerBookingNotification failed", err);
    }
  },
});

// INTERNAL: cancellation email fired when admin cancels. If a refund was
// issued, surface the amount so the customer knows what to expect on
// their statement.
export const sendBookingCancelled = internalAction({
  args: {
    bookingId: v.id("bookings"),
    refundedCents: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const resend = loadResend();
      if (!resend) return;
      const ctxData = await loadBookingContext(ctx, args.bookingId);
      if (!ctxData) return;
      const { booking, service } = ctxData;

      const refundLine =
        args.refundedCents !== undefined && args.refundedCents > 0
          ? `<p style="margin:16px 0 0;color:#a1a1aa;font-size:14px;line-height:1.6;">
              A refund of <strong style="color:#f5f5f7;">${escapeHtml(formatMoney(args.refundedCents))}</strong> has been issued — it'll show on your statement within 5–10 business days.
            </p>`
          : "";

      const reasonLine = args.reason
        ? `<p style="margin:16px 0 0;color:#a1a1aa;font-size:14px;line-height:1.6;">Reason: ${escapeHtml(args.reason)}</p>`
        : "";

      const body = `
        <h1 style="margin:0 0 8px;color:#f5f5f7;font-size:24px;font-weight:600;">Your appointment has been cancelled</h1>
        <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;line-height:1.6;">
          Your <strong style="color:#f5f5f7;">${escapeHtml(service?.name ?? "appointment")}</strong> scheduled for
          <strong style="color:#f5f5f7;">${escapeHtml(formatDateTime(booking.slotStart))}</strong> has been cancelled.
        </p>
        ${refundLine}
        ${reasonLine}
        <p style="margin:24px 0 0;color:#a1a1aa;font-size:13px;line-height:1.6;">
          Want to rebook? Reply to this email and we'll find a new time, or visit the site to pick your own slot.
        </p>
      `;

      await resend.client.emails.send({
        from: resend.from,
        to: booking.customerEmail,
        subject: `Cancelled — ${formatDateTime(booking.slotStart)}`,
        html: wrap(body, "Your appointment has been cancelled."),
      });
    } catch (err) {
      console.error("sendBookingCancelled failed", err);
    }
  },
});
