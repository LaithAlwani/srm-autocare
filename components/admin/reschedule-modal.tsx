"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { DateScroller } from "@/components/ui/date-scroller";
import { formatDateTime } from "@/lib/format";
import { useModalTransition } from "@/lib/use-modal-transition";

// Inline modal launched from a row in /admin/bookings. Shows a date + slot
// picker scoped to the booking's service, then calls bookings.adminReschedule.
// The action patches the booking row directly + sends the customer a
// Resend-backed email + pushes the change to Google Calendar (if connected).
// The local row updates reactively via the Convex subscription on the
// parent table.
export function RescheduleModal({
  bookingId,
  serviceId,
  currentSlotStart,
  currentSlotEnd,
  customerName,
  serviceName,
  onClose,
}: {
  bookingId: Id<"bookings">;
  serviceId: Id<"services">;
  currentSlotStart: number;
  // End of the existing slot, used to derive the appointment's actual
  // length (service + any add-ons) so the slot picker reserves the right
  // amount of time at the new start.
  currentSlotEnd: number;
  customerName: string;
  serviceName: string;
  onClose: () => void;
}) {
  const adminReschedule = useAction(api.bookings.adminReschedule);
  const { shown, handleClose } = useModalTransition(onClose);

  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Total duration the slot picker needs to reserve. Derived from the
  // existing booking's range so any add-ons that extended the original
  // appointment are respected on the new slot too.
  const totalDurationMinutes = Math.max(
    1,
    Math.round((currentSlotEnd - currentSlotStart) / 60000),
  );

  // `excludeBookingId` makes the slot generator ignore THIS booking when
  // computing collisions — otherwise the row blocks every slot that
  // overlaps with its current window, including any nearby times the
  // admin might actually want to move it to. useQuery so cancellations
  // and other admin edits reflect live without closing + reopening.
  const slotsResult = useQuery(api.scheduling.listSlots, {
    serviceId,
    dateISO: date,
    totalDurationMinutes,
    excludeBookingId: bookingId,
  });
  const slots = slotsResult ?? [];
  const slotLoading = slotsResult === undefined;

  async function handleSubmit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminReschedule({
        bookingId,
        slotStartISO: selected,
        reason: reason.trim() || undefined,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reschedule");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-50 bg-surface/80 backdrop-blur flex items-center justify-center p-4 transition-opacity duration-200 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      onClick={() => !submitting && handleClose()}
    >
      <div
        className={`gloss-card bg-surface-container w-full max-w-2xl max-h-[90vh] overflow-y-auto transition-all duration-200 ${
          shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-headline-md uppercase">Reschedule</h2>
            <p className="text-label-tech text-foreground-muted mt-1">
              {customerName} · {serviceName}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="text-foreground-muted hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="text-body-md text-foreground-muted">
            Currently booked for{" "}
            <span className="text-foreground font-mono-tech">{formatDateTime(currentSlotStart)}</span>
          </div>

          <div>
            <label className="text-label-tech text-foreground-muted mb-2 block">
              New date
            </label>
            <DateScroller
              date={date}
              minDate={new Date().toISOString().slice(0, 10)}
              onChange={(d) => {
                setSelected(null);
                setDate(d);
              }}
              ariaLabel="Pick a new date"
            />
          </div>

          <div>
            <label className="text-label-tech text-foreground-muted mb-2 block">
              Available times
            </label>
            {/* Fixed-height container so the modal doesn't jump as the
                slot count changes between dates. Internal overflow-y
                scrolls when a day has unusually many slots. */}
            <div className="h-60 overflow-y-auto pr-1">
              {slotLoading ? (
                <div className="flex items-center gap-2 text-foreground-muted py-6">
                  <Loader2 size={16} className="animate-spin" /> Loading slots...
                </div>
              ) : slots.length === 0 ? (
                <p className="text-foreground-muted text-body-md py-4">
                  No slots available on this date — try another.
                </p>
              ) : (
                <div
                  key={date}
                  className="grid grid-cols-3 sm:grid-cols-4 gap-2 animate-slide-up"
                >
                  {slots.map((iso) => {
                    const active = selected === iso;
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => setSelected(iso)}
                        className={`gloss-card p-3 text-label-tech transition duration-200 ${
                          active ? "border-primary glow-blue-soft text-primary" : ""
                        }`}
                      >
                        {new Date(iso).toLocaleTimeString("en-CA", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-label-tech text-foreground-muted mb-2 block">
              Reason (internal note — optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Equipment maintenance, weather, etc."
              className="w-full bg-surface-container-low px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary resize-none"
            />
          </div>

          {error && <p className="text-error text-body-md">{error}</p>}
        </div>

        <div className="flex gap-2 justify-end p-6 border-t border-border">
          <Button variant="ghost" size="md" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!selected || submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Rescheduling...
              </>
            ) : (
              "Confirm reschedule"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
