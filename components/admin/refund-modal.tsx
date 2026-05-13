"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatPriceFromCents } from "@/lib/format";

// Editable-amount refund modal. Defaults to the full remaining balance but
// lets the admin issue a partial refund instead. Submits in dollars; we
// convert to cents at the API boundary so the backend never sees floats.
export function RefundModal({
  bookingId,
  customerName,
  depositAmountCents,
  alreadyRefundedCents,
  onClose,
}: {
  bookingId: Id<"bookings">;
  customerName: string;
  depositAmountCents: number;
  alreadyRefundedCents: number;
  onClose: () => void;
}) {
  const adminRefund = useAction(api.bookings.adminRefund);

  const remainingCents = depositAmountCents - alreadyRefundedCents;
  const [dollars, setDollars] = useState<number>(remainingCents / 100);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submitting, onClose]);

  const cents = Math.round(dollars * 100);
  const valid = cents > 0 && cents <= remainingCents;
  const isPartial = cents < remainingCents;

  async function handleSubmit() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminRefund({
        bookingId,
        amountCents: cents,
        reason: reason.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refund failed.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="refund-modal-title"
      className="fixed inset-0 z-50 bg-surface/80 backdrop-blur flex items-center justify-center p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="gloss-card bg-surface-container w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 flex items-center justify-center bg-error/15 text-error border border-error/30 shrink-0">
              <AlertTriangle size={16} />
            </span>
            <div>
              <h2 id="refund-modal-title" className="text-headline-md uppercase">
                Refund deposit
              </h2>
              <p className="text-label-tech text-foreground-muted mt-1">{customerName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-foreground-muted hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <dl className="grid grid-cols-2 gap-y-2 text-body-md">
            <dt className="text-label-tech text-foreground-muted">Deposit</dt>
            <dd className="text-right text-foreground font-mono-tech">
              {formatPriceFromCents(depositAmountCents)}
            </dd>
            {alreadyRefundedCents > 0 && (
              <>
                <dt className="text-label-tech text-foreground-muted">Already refunded</dt>
                <dd className="text-right text-foreground-muted font-mono-tech">
                  {formatPriceFromCents(alreadyRefundedCents)}
                </dd>
              </>
            )}
            <dt className="text-label-tech text-foreground-muted">Remaining</dt>
            <dd className="text-right text-foreground font-mono-tech">
              {formatPriceFromCents(remainingCents)}
            </dd>
          </dl>

          <div>
            <label className="text-label-tech text-foreground-muted mb-2 block">
              Refund amount (CAD)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted text-body-md pointer-events-none">
                $
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max={remainingCents / 100}
                value={Number.isFinite(dollars) ? dollars : 0}
                onChange={(e) => setDollars(Number(e.target.value) || 0)}
                disabled={submitting}
                autoFocus
                className="w-full bg-surface-container-low pl-8 pr-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex justify-between mt-2 text-label-tech">
              <span className="text-foreground-muted">
                {isPartial ? "Partial refund" : "Full remaining refund"}
              </span>
              <button
                type="button"
                onClick={() => setDollars(remainingCents / 100)}
                disabled={submitting}
                className="text-primary hover:underline"
              >
                Refund full {formatPriceFromCents(remainingCents)}
              </button>
            </div>
          </div>

          <div>
            <label className="text-label-tech text-foreground-muted mb-2 block">
              Internal note (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Customer cancelled outside policy window"
              className="w-full bg-surface-container-low px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary resize-none"
            />
            <p className="text-label-tech text-foreground-muted mt-1">
              Internal note for your records. The customer doesn't see this.
            </p>
          </div>

          {error && (
            <div className="p-3 border border-error/30 bg-error/10 text-error text-body-md">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end p-6 border-t border-border">
          <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={handleSubmit}
            disabled={submitting || !valid}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Refunding...
              </>
            ) : (
              `Refund ${formatPriceFromCents(cents)}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
