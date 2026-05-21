import { v } from "convex/values";
import { Resend } from "resend";
import { action } from "./_generated/server";
import { siteConfig } from "../config/site";

// PUBLIC: emails the owner with a contact-form submission. No DB row.
// Throws if Resend isn't configured so the form shows an error instead of
// silently swallowing the inquiry.
export const sendInquiry = action({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const ownerEmail = process.env.OWNER_EMAIL;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set");
    if (!ownerEmail) throw new Error("OWNER_EMAIL is not set");

    const resend = new Resend(apiKey);
    const address = process.env.AUTH_FROM_EMAIL ?? "noreply@srm-autocare.com";
    await resend.emails.send({
      from: `${siteConfig.shortName} ${siteConfig.name} <${address}>`,
      to: ownerEmail,
      replyTo: args.email,
      subject: `New inquiry from ${args.name}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #131313;">New website inquiry</h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Name</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(args.name)}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(args.email)}</td></tr>
            ${args.phone ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Phone</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(args.phone)}</td></tr>` : ""}
          </table>
          <h3 style="margin-top: 24px;">Message</h3>
          <p style="white-space: pre-wrap; line-height: 1.6;">${escapeHtml(args.message)}</p>
        </div>
      `,
    });
    return { ok: true };
  },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
