"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ButtonLink } from "@/components/ui/button";
import { formatPriceFromCents, formatDateTime } from "@/lib/format";

export default function BookSuccessPage() {
  const searchParams = useSearchParams();
  // Moneris's payment_receipt callback is what brought us here — components/
  // moneris-payment-form.tsx pushes us to /book/success?order_no=... after
  // calling verifyAndConfirm. The booking row will already exist (created
  // as a draft during preload, promoted to confirmed by verifyAndConfirm).
  const orderNo = searchParams.get("order_no");

  const booking = useQuery(
    api.bookings.getByMonerisOrder,
    orderNo ? { orderNo } : "skip",
  );

  return (
    <div>
      <section className="section-y">
        <Container className="max-w-2xl text-center">
          {!orderNo ? (
            <p className="text-foreground-muted">Missing payment reference — nothing to confirm.</p>
          ) : booking === undefined ? (
            <div className="flex flex-col items-center gap-4 text-foreground-muted">
              <Loader2 className="animate-spin" size={32} />
              <p>Confirming your booking...</p>
            </div>
          ) : booking === null ? (
            <p className="text-foreground-muted">
              We couldn't find that booking yet. Refresh in a few seconds — Moneris is still
              notifying us.
            </p>
          ) : (
            <>
              <CheckCircle2 className="text-success mx-auto mb-6" size={64} strokeWidth={1.5} />
              <Eyebrow className="mb-4">Confirmed</Eyebrow>
              <h1 className="text-display uppercase tracking-tighter mb-6">
                You're booked
              </h1>
              <p className="text-body-lg text-foreground-muted mb-12">
                Confirmation has been sent to {booking.customerEmail}. We'll see you soon.
              </p>

              <div className="gloss-card p-8 text-left space-y-4">
                <Row label="Service" value={booking.serviceName} />
                {booking.selectedAddOns && booking.selectedAddOns.length > 0 && (
                  <div className="flex justify-between gap-6 border-b border-border pb-3">
                    <span className="text-label-tech text-foreground-muted">Add-ons</span>
                    <ul className="text-foreground text-right space-y-1">
                      {booking.selectedAddOns.map((a) => (
                        <li key={a.id}>
                          {a.name}{" "}
                          <span className="text-foreground-muted">
                            (+{formatPriceFromCents(a.priceCents)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <Row label="When" value={formatDateTime(booking.slotStart)} />
                <Row label="Vehicle" value={booking.vehicleInfo} />
                <Row
                  label="Deposit paid"
                  value={formatPriceFromCents(booking.depositAmountCents)}
                />
                <Row label="Status" value={booking.status} />
              </div>

              <div className="mt-12 flex flex-col md:flex-row gap-4 justify-center">
                <ButtonLink href="/" variant="secondary" size="lg">
                  Back to home
                </ButtonLink>
                <ButtonLink href="/services" variant="ghost" size="lg">
                  Browse more services
                </ButtonLink>
              </div>
            </>
          )}
        </Container>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 border-b border-border pb-3 last:border-0">
      <span className="text-label-tech text-foreground-muted">{label}</span>
      <span className="text-foreground text-right">{value}</span>
    </div>
  );
}
