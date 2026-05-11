"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2, Mail } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

type Stage = "email" | "code";

export default function AdminLoginPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn("email-otp", { email });
      setStage("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn("email-otp", { email, code });
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center">
      <Container className="max-w-md w-full">
        <div className="gloss-card p-10">
          <Eyebrow className="mb-3">Admin Portal</Eyebrow>
          <h1 className="text-headline-lg uppercase mb-2">{siteConfig.name}</h1>
          <p className="text-body-md text-foreground-muted mb-8">
            Sign in with your admin email. We'll send you a one-time code.
          </p>

          {stage === "email" ? (
            <form onSubmit={handleSendCode} className="space-y-6">
              <div>
                <label className="text-label-tech text-foreground-muted mb-2 block">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
                    size={16}
                  />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 bg-surface-container text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>
              {error && <p className="text-error text-body-md">{error}</p>}
              <Button type="submit" variant="primary" size="lg" block disabled={submitting || !email}>
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" size={14} /> Sending...
                  </>
                ) : (
                  "Send sign-in code"
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-6">
              <p className="text-body-md text-foreground-muted">
                We sent a 6-digit code to <span className="text-foreground">{email}</span>.
              </p>
              <div>
                <label className="text-label-tech text-foreground-muted mb-2 block">
                  Verification code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  disabled={submitting}
                  className="w-full px-4 py-4 bg-surface-container text-2xl tracking-[0.5em] text-center text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary transition-colors font-mono-tech"
                />
              </div>
              {error && <p className="text-error text-body-md">{error}</p>}
              <Button type="submit" variant="primary" size="lg" block disabled={submitting || code.length !== 6}>
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" size={14} /> Verifying...
                  </>
                ) : (
                  "Verify & sign in"
                )}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStage("email");
                  setCode("");
                  setError(null);
                }}
                className="text-label-tech text-foreground-muted hover:text-foreground transition-colors"
              >
                ← Use a different email
              </button>
            </form>
          )}
        </div>
      </Container>
    </div>
  );
}
