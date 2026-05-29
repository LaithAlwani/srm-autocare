"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useAction, useQuery } from "convex/react";
import { AlertCircle, Loader2, Lock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatPriceFromCents } from "@/lib/format";

// Booking payload the form forwards to confirmAndCharge along with the
// freshly-tokenized card source. The server treats this as untrusted input
// — it re-fetches the service + add-ons by ID, recomputes the deposit, and
// re-checks the slot before charging — so the form just needs to faithfully
// echo what the customer chose.
export type SquareBookingPayload = {
  serviceId: Id<"services">;
  slotStart: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  vehicleInfo: string;
  notes?: string;
  addOnIds?: Id<"addOns">[];
};

// Embedded Square Web Payments SDK card form. Loads Square's JS, mounts a
// card element into a div, and on submit tokenizes the card and hands the
// resulting sourceId to our confirmAndCharge action. The action does the
// actual server-side /v2/payments call; we never see the card details.
//
// The Square SDK is loaded from a versioned CDN URL. We deliberately do not
// pin the script element's onLoad to handler logic — we use a ref to track
// the SDK init state instead, so unmount/remount during StrictMode doesn't
// double-mount the card iframe.

const SCRIPT_URL_SANDBOX = "https://sandbox.web.squarecdn.com/v1/square.js";
const SCRIPT_URL_PRODUCTION = "https://web.squarecdn.com/v1/square.js";

const MOUNT_DIV_ID = "square-card-container";

// Style overrides for Square's iframe. The SDK injects an iframe into our
// page; this object styles its INTERNAL elements (text color, placeholder,
// background). Square accepts only a small allowlist of selectors —
// fontFamily only accepts a SINGLE name (no fallback stack), and the
// invalid-state selector is `input.is-error`, not `input.invalid`.
//
// Deliberately light-themed (white bg, dark text) even though the rest
// of the site is dark. Browser autofill paints its own light background
// inside the iframe via `-webkit-box-shadow`, which we can't override
// from outside (the SDK doesn't expose `:-webkit-autofill`). Matching
// the autofill palette means the transition from empty → autofilled is
// visually seamless instead of "field disappears".
const CARD_STYLE = {
  input: {
    color: "#1a1a1a",
    fontSize: "16px",
    backgroundColor: "#ffffff",
  },
  "input.is-error": { color: "#c92a2a" },
  "input::placeholder": { color: "#9aa0a6" },
};

export function SquarePaymentForm({
  booking,
  depositCents,
}: {
  booking: SquareBookingPayload;
  depositCents: number;
}) {
  const router = useRouter();
  const config = useQuery(api.square.getSquareConfig, {});
  const confirmAndCharge = useAction(api.square.confirmAndCharge);

  // Idempotency key generated once per form mount. Keeping it stable across
  // re-renders is what makes Square dedupe a Pay-button double-click into a
  // single charge. Going back to Details and forward again unmounts the
  // form → new key (intentional: it's a fresh attempt).
  const idempotencyKey = useMemo(() => `srm-${crypto.randomUUID()}`.slice(0, 45), []);

  const [scriptReady, setScriptReady] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hold the live Square card instance so we can call tokenize() on submit
  // and destroy() on unmount.
  const cardRef = useRef<SquareCard | null>(null);
  // Guard against React StrictMode double-mount initializing the card twice
  // (Square throws if you attach() the same selector twice).
  const initializedRef = useRef(false);

  const applicationId = config?.applicationId;
  const locationId = config?.locationId;
  const environment = config?.environment;

  useEffect(() => {
    if (!scriptReady || initializedRef.current) return;
    if (typeof window === "undefined" || !window.Square) return;
    if (!applicationId || !locationId) return;

    initializedRef.current = true;
    let destroyed = false;

    (async () => {
      try {
        const payments = window.Square!.payments(applicationId, locationId);
        const card = await payments.card({ style: CARD_STYLE });
        // If the effect was torn down before card() resolved, abandon.
        if (destroyed) {
          await card.destroy();
          return;
        }
        await card.attach(`#${MOUNT_DIV_ID}`);
        cardRef.current = card;
        setCardReady(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? `Couldn't load the secure card form: ${err.message}`
            : "Couldn't load the secure card form.",
        );
      }
    })();

    return () => {
      destroyed = true;
      // Best-effort teardown — Square's destroy() rejects if the card was
      // never attached, which can happen during fast remounts.
      cardRef.current?.destroy().catch(() => {
        /* nothing to clean up */
      });
      cardRef.current = null;
      initializedRef.current = false;
      setCardReady(false);
    };
  }, [scriptReady, applicationId, locationId]);

  async function handlePay() {
    const card = cardRef.current;
    if (!card || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await card.tokenize();
      if (result.status !== "OK" || !result.token) {
        // Surface a field-aware message for tokenize failures (Square gives
        // us the offending field, e.g. "cvv" / "postalCode"). We log the
        // raw error array so the dev console still has the full picture.
        console.error("Square tokenize failed", result.errors);
        throw new TokenizeError(result.errors ?? []);
      }
      // Single action call: validate + charge Square + insert booking +
      // dispatch emails/calendar. The booking row only exists after this
      // call resolves successfully, so abandoned-checkout drafts never
      // pile up on the calendar.
      await confirmAndCharge({
        idempotencyKey,
        sourceId: result.token,
        ...booking,
      });
      router.push(`/book/success?order_no=${encodeURIComponent(idempotencyKey)}`);
    } catch (err) {
      console.error("Square payment error", err);
      setError(friendlyPaymentError(err));
      setSubmitting(false);
    }
  }

  // Only resolve a script URL once the config query has actually returned.
  // Rendering the <Script> tag with a defaulted URL before then causes
  // Next.js to mount it, and when `environment` later flips from
  // sandbox-default to production the tag re-renders with the new src
  // WITHOUT unmounting the old one — both scripts end up on the page
  // and Square's SDK throws "initialized with production app id but
  // currently using sandbox" (or the inverse).
  const scriptUrl =
    environment === "production"
      ? SCRIPT_URL_PRODUCTION
      : environment === "sandbox"
        ? SCRIPT_URL_SANDBOX
        : null;

  return (
    <>
      {scriptUrl && (
        <Script
          src={scriptUrl}
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onLoad={() => setScriptReady(true)}
        />
      )}

      {/* Square injects its iframe into this div. White surface so the
          light-themed input fields don't look like floating pills on the
          dark card. Min height keeps the layout stable while the SDK
          loads in. */}
      <div id={MOUNT_DIV_ID} className="min-h-32 bg-white p-3" />

      {!cardReady && !error && (
        <p className="mt-4 text-label-tech text-foreground-muted flex items-center gap-2">
          <Loader2 className="animate-spin" size={14} /> Loading secure payment form…
        </p>
      )}

      {error && (
        <p className="mt-4 text-error text-body-md">{error}</p>
      )}

      {/* Cancellation policy notice — sits right above the Pay button so the
          customer sees the terms before authorizing the charge. */}
      <div className="mt-6 flex gap-3 p-4 border border-border bg-surface-container-low">
        <AlertCircle
          size={16}
          strokeWidth={1.5}
          className="text-primary shrink-0 mt-0.5"
          aria-hidden
        />
        <div className="text-body-md text-foreground-muted">
          <p className="text-foreground mb-1">Cancellation policy</p>
          <p>
            Your deposit secures the slot. Cancel at least <span className="text-foreground">48 hours</span>{" "}
            before your appointment for a full refund — cancellations inside that window, or no-shows,
            forfeit the deposit.
          </p>
        </div>
      </div>

      <Button
        variant="primary"
        size="lg"
        block
        className="mt-4"
        disabled={!cardReady || submitting}
        onClick={handlePay}
      >
        {submitting ? (
          <>
            <Loader2 className="animate-spin" size={14} /> Processing…
          </>
        ) : (
          <>
            <Lock size={14} /> Pay {formatPriceFromCents(depositCents)}
          </>
        )}
      </Button>

      <p className="mt-3 text-label-tech text-foreground-muted text-center">
        Payments are processed securely by Square. We never see your card details.
      </p>
    </>
  );
}

// Square sends an array of validation errors back from card.tokenize() when
// the customer's input is invalid (bad CVV, expired card, etc.). We wrap it
// in our own error class so the catch block can distinguish tokenize errors
// from server-side charge errors.
class TokenizeError extends Error {
  errors: Array<{ message?: string; type?: string; field?: string }>;
  constructor(errors: Array<{ message?: string; type?: string; field?: string }>) {
    super(errors[0]?.message ?? "Card details invalid");
    this.name = "TokenizeError";
    this.errors = errors;
  }
}

// Map a known Square error code to a customer-friendly message. Square's raw
// `code` values are pithy ALL_CAPS identifiers ("CARD_DECLINED",
// "INSUFFICIENT_FUNDS") and the `detail` is plain English but written for
// merchants, not shoppers. These messages are deliberately reassuring —
// blame the card or the bank, never the customer.
const SQUARE_FRIENDLY: Record<string, string> = {
  CARD_DECLINED:
    "Your card was declined. Please try a different card or contact your bank.",
  GENERIC_DECLINE:
    "Your card was declined. Please try a different card or contact your bank.",
  INSUFFICIENT_FUNDS:
    "There aren't enough funds on this card. Please try a different card.",
  CVV_FAILURE:
    "The security code (CVV) didn't match. Please re-enter it and try again.",
  ADDRESS_VERIFICATION_FAILURE:
    "The postal/ZIP code didn't match what the bank has on file. Please re-enter it.",
  INVALID_EXPIRATION:
    "The expiration date looks invalid, or the card has expired.",
  EXPIRATION_FAILURE:
    "The expiration date looks invalid.",
  CARD_DECLINED_VERIFICATION_REQUIRED:
    "Your bank wants to verify this charge. Please try a different card or contact your bank to approve the payment.",
  INVALID_CARD_DATA:
    "Those card details don't look right. Please double-check the number, expiry, and CVV.",
  CARD_TOKEN_EXPIRED:
    "Your card details timed out. Please re-enter them and try again.",
  CARD_TOKEN_USED:
    "This payment attempt already went through. Please refresh the page.",
  PAYMENT_LIMIT_EXCEEDED:
    "This card has hit a transaction limit. Please use a different card.",
  TEMPORARY_ERROR:
    "Our payment processor had a brief hiccup. Please try again in a moment.",
  UNAUTHORIZED:
    "Payments are temporarily unavailable. Please contact us so we can sort it out.",
  BAD_REQUEST:
    "Something about that payment didn't go through. Please try again or contact us.",
};

// Field-specific messages for tokenize-time validation failures. Square's
// SDK reports a `field` like "cardNumber" / "cvv" so we can point the
// customer at the exact thing to fix.
const TOKENIZE_FIELD_FRIENDLY: Record<string, string> = {
  cardNumber: "Please check the card number and try again.",
  expirationDate: "Please check the expiration date and try again.",
  cvv: "Please check the security code (CVV) and try again.",
  postalCode: "Please check the postal/ZIP code and try again.",
};

// Turn any thrown error from the payment flow into something a customer can
// actually act on. Tries hardest path → softest fallback:
//   1. Tokenize errors carry a `field` — point at the exact input.
//   2. Server charge errors include Square's code in parens — map it.
//   3. Network failures — tell the customer to check connectivity.
//   4. Anything else — generic apologetic fallback.
function friendlyPaymentError(err: unknown): string {
  if (err instanceof TokenizeError) {
    const first = err.errors[0];
    if (first?.field && TOKENIZE_FIELD_FRIENDLY[first.field]) {
      return TOKENIZE_FIELD_FRIENDLY[first.field];
    }
    return first?.message ?? "Please check your card details and try again.";
  }

  const raw = err instanceof Error ? err.message : String(err);

  // Server-side errors from convex/square.ts look like:
  //   "Square /payments failed (CARD_DECLINED): Card was declined."
  const codeMatch = raw.match(/Square [^(]+\(([A-Z_]+)\)/);
  if (codeMatch) {
    const code = codeMatch[1];
    if (SQUARE_FRIENDLY[code]) return SQUARE_FRIENDLY[code];
    // Unknown Square code — still better than the raw message.
    return "Your card couldn't be charged. Please try a different card or contact your bank.";
  }

  // Network / fetch failures bubble up from Convex when the action can't
  // reach Square at all.
  const lower = raw.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request")
  ) {
    return "We couldn't reach the payment processor. Check your connection and try again.";
  }

  return "We couldn't process the payment. Please try again — if it keeps happening, get in touch and we'll sort it out.";
}
