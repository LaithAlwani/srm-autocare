import { Email } from "@convex-dev/auth/providers/Email";
import { convexAuth } from "@convex-dev/auth/server";
import { Resend } from "resend";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      id: "email-otp",
      maxAge: 60 * 15, // 15 min
      // Generate a 6-digit numeric OTP instead of the default magic-link token.
      async generateVerificationToken() {
        return Math.floor(100000 + Math.random() * 900000).toString();
      },
      async sendVerificationRequest({ identifier: email, token }) {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) throw new Error("RESEND_API_KEY is not set");
        const resend = new Resend(apiKey);
        await resend.emails.send({
          from: process.env.AUTH_FROM_EMAIL ?? "noreply@srm-autocare.com",
          to: email,
          subject: "Your SRM Auto Care login code",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #131313;">Sign in to SRM Auto Care</h2>
              <p style="font-size: 14px; color: #555;">Use the code below to complete your sign-in. It expires in 15 minutes.</p>
              <p style="font-size: 28px; letter-spacing: 8px; font-weight: 700; color: #007aff; padding: 16px; border: 1px solid #e5e5e5; text-align: center;">${token}</p>
              <p style="font-size: 12px; color: #888;">If you didn't request this code, you can safely ignore this email.</p>
            </div>
          `,
        });
      },
    }),
  ],
});
