"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { MonerisCheckout, MonerisCallbackResponse } from "@/types/moneris";

// Embedded Moneris Checkout iframe. Mounts the Moneris JS into the page,
// wires its callbacks to our verifyAndConfirm action, and on success pushes
// the customer to /book/success?order_no=… where the booking row will be
// found (already created as a draft during preload, just promoted to
// confirmed by verifyAndConfirm).
//
// We deliberately do NOT trust the in-browser callback alone — verifyAndConfirm
// re-fetches the receipt server-side from Moneris before flipping the row.

const SCRIPT_URL_QA = "https://gatewayt.moneris.com/chkt/js/chkt_v1.00.js";
const SCRIPT_URL_PROD = "https://gateway.moneris.com/chkt/js/chkt_v1.00.js";

const MOUNT_DIV_ID = "moneris-checkout-mount";

export function MonerisPaymentForm({
  ticket,
  orderNo,
  env,
}: {
  ticket: string;
  orderNo: string;
  env: "qa" | "prod";
}) {
  const router = useRouter();
  const verifyAndConfirm = useAction(api.moneris.verifyAndConfirm);

  const [scriptReady, setScriptReady] = useState(false);
  const [status, setStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Hold the live Moneris instance so we can call closeCheckout on unmount.
  const checkoutRef = useRef<MonerisCheckout | null>(null);
  // Guard against React StrictMode double-mount triggering startCheckout twice.
  const startedRef = useRef(false);
  // Once we've kicked off verification, ignore any subsequent success
  // callbacks — Moneris fires both `payment_complete` and `payment_receipt`
  // for the same payment when the receipt page is enabled, and we only want
  // to call verifyAndConfirm + redirect once.
  const handledRef = useRef(false);

  useEffect(() => {
    if (!scriptReady || startedRef.current) return;
    if (typeof window === "undefined" || !window.monerisCheckout) return;

    startedRef.current = true;
    const checkout = new window.monerisCheckout();
    checkoutRef.current = checkout;
    checkout.setMode(env);
    checkout.setCheckoutDiv(MOUNT_DIV_ID);

    async function handlePaymentSuccess(response: MonerisCallbackResponse | string) {
      if (handledRef.current) return;
      handledRef.current = true;
      setStatus("verifying");
      try {
        const ticketFromResponse =
          typeof response === "object" && response !== null
            ? response.ticket
            : undefined;
        await verifyAndConfirm({
          ticket: ticketFromResponse ?? ticket,
          orderNo,
        });
        try {
          checkout.closeCheckout();
        } catch {
          /* fine if it's already torn down */
        }
        router.push(`/book/success?order_no=${encodeURIComponent(orderNo)}`);
      } catch (err) {
        // Reset so the user can retry without reloading the whole page.
        handledRef.current = false;
        setStatus("error");
        setError(
          err instanceof Error
            ? err.message
            : "We couldn't confirm the payment. Please contact us.",
        );
      }
    }

    // `payment_complete` fires as soon as Moneris approves the card.
    // `payment_receipt` only fires if the profile has the receipt page on
    // AND the customer clicks "Done". We listen to both — handledRef de-dupes.
    checkout.setCallback("payment_complete", handlePaymentSuccess);
    checkout.setCallback("payment_receipt", handlePaymentSuccess);

    checkout.setCallback("error_event", (response) => {
      const message =
        typeof response === "object" && response !== null
          ? (response as MonerisCallbackResponse).response_code ?? "unknown"
          : String(response);
      setStatus("error");
      setError(`Payment error (${message}). Please try again.`);
    });

    checkout.setCallback("cancel_transaction", () => {
      // No-op: customer hit cancel inside the iframe. We leave them on /book
      // step 3 with the form re-rendered so they can try again.
      setStatus("idle");
      setError(null);
    });

    checkout.startCheckout(ticket);

    return () => {
      try {
        checkout.closeCheckout();
      } catch {
        /* iframe may already be torn down — fine. */
      }
      checkoutRef.current = null;
    };
  }, [scriptReady, env, ticket, orderNo, verifyAndConfirm, router]);

  return (
    <>
      <Script
        src={env === "prod" ? SCRIPT_URL_PROD : SCRIPT_URL_QA}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onLoad={() => setScriptReady(true)}
      />

      {/* Moneris injects its iframe into this div. Min height keeps the
          surrounding card from collapsing while the script loads. */}
      <div id={MOUNT_DIV_ID} className="min-h-[480px]" />

      {status === "verifying" && (
        <p className="mt-4 text-label-tech text-foreground-muted flex items-center gap-2">
          <Loader2 className="animate-spin" size={14} /> Verifying payment with Moneris…
        </p>
      )}
      {status === "error" && error && (
        <p className="mt-4 text-error text-body-md">{error}</p>
      )}
      {!scriptReady && status !== "error" && (
        <p className="mt-4 text-label-tech text-foreground-muted flex items-center gap-2">
          <Loader2 className="animate-spin" size={14} /> Loading secure payment form…
        </p>
      )}
    </>
  );
}
