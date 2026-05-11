"use client";

import { useState } from "react";
import { useElements, useStripe, PaymentElement } from "@stripe/react-stripe-js";
import { Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// Inner form — must be a child of <Elements> so the hooks see context.
// On submit, asks Stripe to confirm the PaymentIntent. If 3DS is required,
// Stripe.js handles it inline (modal). On success, Stripe redirects the
// browser to `returnUrl?payment_intent=pi_...&payment_intent_client_secret=...`.
export function StripePaymentForm({
  returnUrl,
  customerEmail,
  amountLabel,
}: {
  returnUrl: string;
  customerEmail: string;
  amountLabel: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const { error: stripeErr } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: returnUrl,
        receipt_email: customerEmail,
        // We told PaymentElement not to render the email field (we already
        // collected it on /book step 2) — Stripe requires us to pass it back
        // here so PaymentMethod creation has it.
        payment_method_data: {
          billing_details: { email: customerEmail },
        },
      },
    });

    // If we get here, payment failed (otherwise Stripe full-page redirected).
    if (stripeErr) {
      setError(stripeErr.message ?? "Payment failed.");
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement
        options={{
          layout: "tabs",
          // Address fields auto-collected only when needed for compliance.
          fields: { billingDetails: { email: "never" } },
        }}
      />
      {error && <p className="text-error text-body-md">{error}</p>}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        disabled={!stripe || !elements || submitting}
      >
        {submitting ? (
          <>
            <Loader2 className="animate-spin" size={14} /> Processing...
          </>
        ) : (
          <>
            Pay {amountLabel}
            <ArrowRight size={14} />
          </>
        )}
      </Button>
      <p className="text-label-tech text-foreground-muted text-center">
        Card payments are processed securely by Stripe.
      </p>
    </form>
  );
}
