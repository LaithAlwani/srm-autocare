"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Ban, CalendarClock, History, Mail, Phone, Plus, Undo2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatDuration, formatPriceFromCents } from "@/lib/format";
import { RelativeTime } from "@/components/relative-time";
import { RescheduleModal } from "@/components/admin/reschedule-modal";
import { ConfirmModal } from "@/components/admin/confirm-modal";
import { RefundModal } from "@/components/admin/refund-modal";
import { NewBookingModal } from "@/components/admin/new-booking-modal";
import { DateScroller } from "@/components/ui/date-scroller";

// Note: `pending` deliberately excluded — those rows are mid-checkout drafts
// that listForAdmin already filters out. The admin only ever sees real bookings.
const FILTERS = ["all", "confirmed", "cancelled", "completed"] as const;
type Filter = (typeof FILTERS)[number];

type RescheduleTarget = {
  bookingId: Id<"bookings">;
  serviceId: Id<"services">;
  currentSlotStart: number;
  currentSlotEnd: number;
  customerName: string;
  serviceName: string;
};

type CancelTarget = {
  bookingId: Id<"bookings">;
  customerName: string;
  serviceName: string;
  slotStart: number;
};

type RefundTarget = {
  bookingId: Id<"bookings">;
  customerName: string;
  depositAmountCents: number;
  alreadyRefundedCents: number;
};

// Color a thin left edge by status so the row state is scannable in a long list.
function statusAccent(status: string): string {
  switch (status) {
    case "cancelled":
      return "border-l-2 border-l-error";
    case "completed":
      return "border-l-2 border-l-foreground-muted";
    default:
      return "border-l-2 border-l-primary";
  }
}

function paymentColor(payment: string): string {
  switch (payment) {
    case "paid":
      return "text-success border-success/40 bg-success/10";
    case "refunded":
      return "text-foreground-muted border-border bg-surface-container-high";
    case "partially_refunded":
      return "text-primary-muted border-primary-muted/40 bg-primary-muted/10";
    case "failed":
      return "text-error border-error/40 bg-error/10";
    default:
      return "text-primary-muted border-primary-muted/40 bg-primary-muted/10";
  }
}

function paymentLabel(payment: string): string {
  return payment === "partially_refunded" ? "PARTIAL REFUND" : payment.toUpperCase();
}

// Today as YYYY-MM-DD in the browser's local zone. Used as the initial
// date for the calendar strip + the lower bound on backward scrolling
// (admins can still pick past days to audit completed/cancelled bookings
// — we just default to today).
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AdminBookingsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  // Date scope for the bookings list. Defaults to today so the admin
  // immediately sees what's on the calendar today. "all" hides the
  // date filter entirely and shows the upcoming-first list.
  const [scope, setScope] = useState<"date" | "all">("date");
  const [date, setDate] = useState<string>(() => todayISO());

  const bookings = useQuery(api.bookings.listForAdmin, {
    ...(filter === "all" ? {} : { status: filter }),
    ...(scope === "date" ? { dateISO: date } : {}),
    limit: 100,
  });
  const updateStatus = useMutation(api.bookings.updateStatus);
  const adminCancel = useAction(api.bookings.adminCancel);
  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [refundTarget, setRefundTarget] = useState<RefundTarget | null>(null);
  const [newBookingOpen, setNewBookingOpen] = useState(false);

  function changeStatus(
    booking: { _id: Id<"bookings">; customerName: string; serviceName: string; slotStart: number },
    next: Exclude<Filter, "all">,
  ) {
    if (next === "cancelled") {
      setCancelTarget({
        bookingId: booking._id,
        customerName: booking.customerName,
        serviceName: booking.serviceName,
        slotStart: booking.slotStart,
      });
      return;
    }
    void updateStatus({ id: booking._id, status: next });
  }

  return (
    <div>
      <div className="flex justify-between items-end gap-3 flex-wrap mb-8">
        <div>
          <Eyebrow className="mb-3">Operations</Eyebrow>
          <h1 className="text-headline-lg uppercase">Bookings</h1>
        </div>
        <Button variant="primary" size="md" onClick={() => setNewBookingOpen(true)}>
          <Plus size={14} /> New booking
        </Button>
      </div>

      {/* Calendar strip — defaults to today. The "All upcoming" pill
          clears the date scope entirely and shows the date-agnostic
          upcoming-first list. */}
      <div className="gloss-card p-4 md:p-6 mb-6 space-y-4">
        <DateScroller
          date={date}
          onChange={(d) => {
            setScope("date");
            setDate(d);
          }}
          ariaLabel="Pick a date to view bookings"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() =>
              scope === "date" ? setScope("all") : setDate(todayISO())
            }
            className="text-label-tech text-foreground-muted hover:text-foreground transition-colors"
          >
            {scope === "date" ? "Show all upcoming →" : "← Back to today"}
          </button>
          {scope === "date" && (
            <span className="text-label-tech text-foreground-muted">
              Showing bookings on{" "}
              <span className="text-foreground">
                {new Date(
                  Number(date.slice(0, 4)),
                  Number(date.slice(5, 7)) - 1,
                  Number(date.slice(8, 10)),
                ).toLocaleDateString("en-CA", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-label-tech px-4 py-2 border transition-colors ${
              filter === f
                ? "bg-primary-strong text-on-primary border-primary-strong"
                : "border-border text-foreground-muted hover:text-foreground hover:border-chrome"
            }`}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {bookings === undefined ? (
        <p className="text-foreground-muted">Loading...</p>
      ) : bookings.length === 0 ? (
        <div className="gloss-card p-12 text-center text-foreground-muted">
          {scope === "date" ? "No bookings on this date." : "No bookings match this filter."}
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const isCancelled = b.status === "cancelled";
            return (
              <article
                key={b._id}
                className={`gloss-card ${statusAccent(b.status)} ${isCancelled ? "opacity-70" : ""}`}
              >
                {/* HERO — when + duration + service + payment chip */}
                <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-start md:justify-between gap-4 border-b border-border">
                  <div className="min-w-0">
                    <div
                      className={`text-label-tech text-primary mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${
                        isCancelled ? "line-through text-foreground-muted" : ""
                      }`}
                    >
                      <span>{formatDateTime(b.slotStart)}</span>
                      <span className="text-foreground-muted">
                        ·{" "}
                        {formatDuration(
                          Math.max(1, Math.round((b.slotEnd - b.slotStart) / 60000)),
                        )}
                      </span>
                    </div>
                    <h3 className="text-headline-md text-foreground uppercase tracking-tight">
                      {b.serviceName}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <span
                      className={`text-label-tech px-2 py-1 border ${paymentColor(b.paymentStatus)}`}
                    >
                      {paymentLabel(b.paymentStatus)}
                    </span>
                    {isCancelled ? (
                      <span className="inline-flex items-center gap-1 text-label-tech px-2 py-1 border border-error/40 text-error bg-error/10">
                        <Ban size={10} /> CANCELLED
                      </span>
                    ) : (
                      b.rescheduledAt && (
                        <span
                          className="inline-flex items-center gap-1 text-label-tech px-2 py-1 border border-primary/40 text-primary bg-primary/10"
                          title={`Rescheduled ${formatDateTime(b.rescheduledAt)}`}
                        >
                          <History size={10} /> RESCHEDULED
                        </span>
                      )
                    )}
                  </div>
                </div>

                {/* INFO — label/value pairs */}
                <dl className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-[160px_1fr] gap-x-6 gap-y-4">
                  <Row label="Customer">
                    <div className="text-foreground wrap-break-word">{b.customerName}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-label-tech text-foreground-muted">
                      <a
                        href={`mailto:${b.customerEmail}`}
                        className="flex items-center gap-1.5 min-w-0 max-w-full hover:text-foreground transition-colors"
                      >
                        <Mail size={11} className="shrink-0" />
                        <span className="break-all">{b.customerEmail}</span>
                      </a>
                      <a
                        href={`tel:${b.customerPhone}`}
                        className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                      >
                        <Phone size={11} className="shrink-0" />
                        <span className="whitespace-nowrap">{b.customerPhone}</span>
                      </a>
                    </div>
                  </Row>

                  <Row label="Vehicle">
                    <div className="text-foreground">{b.vehicleInfo}</div>
                    {b.notes && (
                      <p className="text-label-tech text-foreground-muted italic mt-1">
                        “{b.notes}”
                      </p>
                    )}
                  </Row>

                  {b.selectedAddOns && b.selectedAddOns.length > 0 && (
                    <Row label="Add-ons">
                      <ul className="space-y-1">
                        {b.selectedAddOns.map((a) => (
                          <li
                            key={a.id}
                            className="text-foreground flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
                          >
                            <span>{a.name}</span>
                            <span className="text-label-tech text-foreground-muted">
                              +{formatPriceFromCents(a.priceCents)} · +
                              {a.durationMinutes}m
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Row>
                  )}

                  <Row label="Deposit">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-foreground font-mono-tech">
                        {formatPriceFromCents(b.depositAmountCents)}
                      </span>
                      {b.refundedAmountCents !== undefined && b.refundedAmountCents > 0 && (
                        <span className="text-label-tech text-foreground-muted">
                          – {formatPriceFromCents(b.refundedAmountCents)} refunded
                        </span>
                      )}
                    </div>
                  </Row>

                  <Row label="Booked">
                    <span className="text-foreground-muted text-label-tech">
                      <RelativeTime ts={b.createdAt} />
                    </span>
                  </Row>

                  {!isCancelled && b.rescheduledAt && b.originalSlotStart && (
                    <Row label="Originally">
                      <span className="text-label-tech text-foreground-muted line-through">
                        {formatDateTime(b.originalSlotStart)}
                      </span>
                    </Row>
                  )}
                </dl>

                {/* ACTIONS */}
                <div className="px-6 md:px-8 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 border-t border-border bg-surface-container-lowest">
                  <select
                    value={b.status}
                    onChange={(e) =>
                      changeStatus(b, e.target.value as Exclude<Filter, "all">)
                    }
                    className="bg-surface-container text-label-tech text-foreground border border-border px-3 py-2 focus:outline-none focus:border-primary"
                    aria-label="Change status"
                  >
                    <option value="confirmed">CONFIRMED</option>
                    <option value="cancelled">CANCELLED</option>
                    <option value="completed">COMPLETED</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setRescheduleTarget({
                        bookingId: b._id,
                        serviceId: b.serviceId,
                        currentSlotStart: b.slotStart,
                        currentSlotEnd: b.slotEnd,
                        customerName: b.customerName,
                        serviceName: b.serviceName,
                      })
                    }
                    disabled={isCancelled}
                    className="inline-flex items-center justify-center gap-1.5 text-label-tech px-3 py-2 border border-border text-foreground-muted hover:text-primary hover:border-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={isCancelled ? "Booking is cancelled" : "Reschedule"}
                  >
                    <CalendarClock size={12} /> Reschedule
                  </button>
                  {isCancelled &&
                    b.paymentStatus !== "refunded" &&
                    b.paymentStatus !== "failed" &&
                    b.squarePaymentId && (
                      <button
                        type="button"
                        onClick={() =>
                          setRefundTarget({
                            bookingId: b._id,
                            customerName: b.customerName,
                            depositAmountCents: b.depositAmountCents,
                            alreadyRefundedCents: b.refundedAmountCents ?? 0,
                          })
                        }
                        className="inline-flex items-center justify-center gap-1.5 text-label-tech px-3 py-2 border border-error/40 text-error hover:bg-error/10 transition-colors"
                      >
                        <Undo2 size={12} /> Refund
                      </button>
                    )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {rescheduleTarget && (
        <RescheduleModal
          bookingId={rescheduleTarget.bookingId}
          serviceId={rescheduleTarget.serviceId}
          currentSlotStart={rescheduleTarget.currentSlotStart}
          currentSlotEnd={rescheduleTarget.currentSlotEnd}
          customerName={rescheduleTarget.customerName}
          serviceName={rescheduleTarget.serviceName}
          onClose={() => setRescheduleTarget(null)}
        />
      )}

      {newBookingOpen && (
        <NewBookingModal onClose={() => setNewBookingOpen(false)} />
      )}

      {cancelTarget && (
        <ConfirmModal
          title="Cancel booking?"
          variant="danger"
          confirmLabel="Cancel booking"
          cancelLabel="Keep booking"
          message={
            <div className="space-y-3">
              <p>
                <span className="text-foreground">{cancelTarget.customerName}</span>'s{" "}
                <span className="text-foreground">{cancelTarget.serviceName}</span> appointment on{" "}
                <span className="text-foreground font-mono-tech">
                  {formatDateTime(cancelTarget.slotStart)}
                </span>{" "}
                will be cancelled.
              </p>
              <p>
                The customer will receive a cancellation email from us. Use the Refund button on
                the cancelled booking to issue a refund.
              </p>
            </div>
          }
          onConfirm={async () => {
            await adminCancel({ bookingId: cancelTarget.bookingId });
          }}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {refundTarget && (
        <RefundModal
          bookingId={refundTarget.bookingId}
          customerName={refundTarget.customerName}
          depositAmountCents={refundTarget.depositAmountCents}
          alreadyRefundedCents={refundTarget.alreadyRefundedCents}
          onClose={() => setRefundTarget(null)}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-label-tech text-foreground-muted">{label}</dt>
      <dd className="text-body-md">{children}</dd>
    </>
  );
}
