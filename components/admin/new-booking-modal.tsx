"use client";

import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { DateScroller } from "@/components/ui/date-scroller";
import { formatPriceFromCents, formatDuration } from "@/lib/format";
import { computeDepositCents } from "@/lib/booking";
import { useModalTransition } from "@/lib/use-modal-transition";

// Admin-side "new booking" modal — for walk-ins, phone bookings,
// owner-blocked time, anything that doesn't go through Square. Mirrors
// the public booking flow but compressed: one screen with all fields,
// optional deposit override, optional silent mode (no confirmation
// email). Slot collisions are caught inside the server mutation.

const dollarsToCents = (d: number) => Math.round(d * 100);
const centsToDollars = (c: number) => Math.round(c) / 100;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function NewBookingModal({ onClose }: { onClose: () => void }) {
  const services = useQuery(api.services.list, {});
  const addOns = useQuery(api.addOns.list, {});
  const adminCreateBooking = useAction(api.bookings.adminCreateBooking);
  const { shown, handleClose } = useModalTransition(onClose);

  const [serviceId, setServiceId] = useState<Id<"services"> | "">("");
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<Id<"addOns">[]>([]);
  const [date, setDate] = useState<string>(todayISO());
  const [slotStartISO, setSlotStartISO] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [vehicleInfo, setVehicleInfo] = useState("");
  const [notes, setNotes] = useState("");
  const [depositOverride, setDepositOverride] = useState<number | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "pending">("paid");
  const [sendEmail, setSendEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedService = useMemo(
    () => (serviceId ? services?.find((s) => s._id === serviceId) ?? null : null),
    [services, serviceId],
  );
  const selectedAddOns = useMemo(
    () => (addOns ?? []).filter((a) => selectedAddOnIds.includes(a._id)),
    [addOns, selectedAddOnIds],
  );
  const addOnsTotalCents = selectedAddOns.reduce((sum, a) => sum + a.priceCents, 0);
  const addOnsTotalMinutes = selectedAddOns.reduce(
    (sum, a) => sum + a.durationMinutes,
    0,
  );
  const totalDurationMinutes =
    (selectedService?.durationMinutes ?? 0) + addOnsTotalMinutes;
  const totalCents = (selectedService?.priceFromCents ?? 0) + addOnsTotalCents;
  const defaultDepositCents = computeDepositCents(totalCents);
  const effectiveDepositCents =
    depositOverride !== null ? dollarsToCents(depositOverride) : defaultDepositCents;

  // Slot list scoped to the picked service + date. Subscribes via useQuery
  // so cancelled / new bookings on this day reflect live.
  const slotsResult = useQuery(
    api.scheduling.listSlots,
    selectedService
      ? {
          serviceId: selectedService._id,
          dateISO: date,
          totalDurationMinutes: totalDurationMinutes || undefined,
        }
      : "skip",
  );
  const slots = slotsResult ?? [];
  const slotsLoading = selectedService !== null && slotsResult === undefined;

  const canSubmit =
    serviceId &&
    slotStartISO &&
    customerName.trim() &&
    customerEmail.trim() &&
    customerPhone.trim() &&
    vehicleInfo.trim() &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit || !serviceId || !slotStartISO) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminCreateBooking({
        serviceId,
        slotStartISO,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim(),
        vehicleInfo: vehicleInfo.trim(),
        notes: notes.trim() || undefined,
        addOnIds: selectedAddOnIds.length > 0 ? selectedAddOnIds : undefined,
        depositAmountCentsOverride:
          depositOverride !== null ? dollarsToCents(depositOverride) : undefined,
        paymentStatus,
        sendConfirmationEmail: sendEmail,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create booking");
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
        className={`gloss-card bg-surface-container w-full max-w-3xl max-h-[90vh] overflow-y-auto transition-all duration-200 ${
          shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-surface-container z-10">
          <div>
            <h2 className="text-headline-md uppercase">New booking</h2>
            <p className="text-label-tech text-foreground-muted mt-1">
              Walk-in / phone / off-platform — no Square charge.
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
          {/* Service */}
          <Field label="Service">
            <select
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value as Id<"services">);
                setSlotStartISO(null);
              }}
              className="w-full bg-surface-container-low px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
            >
              <option value="">Select a service…</option>
              {(services ?? []).map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name} · {formatDuration(s.durationMinutes)} ·{" "}
                  {formatPriceFromCents(s.priceFromCents)}
                </option>
              ))}
            </select>
          </Field>

          {/* Add-ons */}
          {(addOns?.length ?? 0) > 0 && (
            <Field label="Add-ons (optional)">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {(addOns ?? []).map((a) => {
                  const checked = selectedAddOnIds.includes(a._id);
                  return (
                    <label
                      key={a._id}
                      className={`flex items-center gap-3 p-3 border cursor-pointer transition-colors ${
                        checked
                          ? "border-primary glow-blue-soft"
                          : "border-border hover:border-chrome"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedAddOnIds((ids) =>
                            e.target.checked
                              ? [...ids, a._id]
                              : ids.filter((id) => id !== a._id),
                          );
                          setSlotStartISO(null);
                        }}
                        className="accent-primary"
                      />
                      <div className="flex-1 text-body-md">
                        <div className="text-foreground">{a.name}</div>
                        <div className="text-label-tech text-foreground-muted">
                          +{formatPriceFromCents(a.priceCents)} · +
                          {a.durationMinutes}m
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </Field>
          )}

          {/* Date + slot */}
          {selectedService && (
            <>
              <Field label="Date">
                <DateScroller
                  date={date}
                  onChange={(d) => {
                    setSlotStartISO(null);
                    setDate(d);
                  }}
                  ariaLabel="Pick a date"
                />
              </Field>

              <Field label="Available times">
                <div className="h-48 overflow-y-auto pr-1">
                  {slotsLoading ? (
                    <div className="flex items-center gap-2 text-foreground-muted py-6">
                      <Loader2 size={16} className="animate-spin" /> Loading slots…
                    </div>
                  ) : slots.length === 0 ? (
                    <p className="text-foreground-muted text-body-md py-4">
                      No slots available on this date.
                    </p>
                  ) : (
                    <div
                      key={date}
                      className="grid grid-cols-3 sm:grid-cols-4 gap-2 animate-slide-up"
                    >
                      {slots.map((iso) => {
                        const active = slotStartISO === iso;
                        return (
                          <button
                            key={iso}
                            type="button"
                            onClick={() => setSlotStartISO(iso)}
                            className={`gloss-card p-3 text-label-tech transition duration-200 ${
                              active
                                ? "border-primary glow-blue-soft text-primary"
                                : ""
                            }`}
                          >
                            {new Date(iso).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Field>
            </>
          )}

          {/* Customer */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Customer name">
              <Input value={customerName} onChange={setCustomerName} placeholder="Jane Doe" />
            </Field>
            <Field label="Phone">
              <Input
                type="tel"
                value={customerPhone}
                onChange={setCustomerPhone}
                placeholder="(613) 555-1234"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={customerEmail}
                onChange={setCustomerEmail}
                placeholder="jane@example.com"
              />
            </Field>
            <Field label="Vehicle">
              <Input
                value={vehicleInfo}
                onChange={setVehicleInfo}
                placeholder="2022 Honda Civic — Silver"
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Notes (optional)">
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Cash paid at appointment, ceramic prep needed, etc."
                  className="w-full bg-surface-container-low px-4 py-2 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary resize-none"
                />
              </Field>
            </div>
          </div>

          {/* Deposit + payment status */}
          {selectedService && (
            <div className="gloss-card p-4 space-y-3">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <span className="text-label-tech text-foreground-muted">
                  Total (service + add-ons)
                </span>
                <span className="text-foreground font-mono-tech">
                  {formatPriceFromCents(totalCents)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <label className="text-label-tech text-foreground-muted">
                  Deposit collected (CAD)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-foreground-muted">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={
                      depositOverride !== null
                        ? depositOverride
                        : centsToDollars(defaultDepositCents)
                    }
                    onChange={(e) => setDepositOverride(Number(e.target.value))}
                    className="w-24 bg-surface-container-low px-3 py-1.5 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary text-right"
                  />
                  {depositOverride !== null && (
                    <button
                      type="button"
                      onClick={() => setDepositOverride(null)}
                      className="text-label-tech text-primary hover:underline"
                    >
                      reset
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <label className="text-label-tech text-foreground-muted">
                  Payment status
                </label>
                <select
                  value={paymentStatus}
                  onChange={(e) =>
                    setPaymentStatus(e.target.value as "paid" | "pending")
                  }
                  className="bg-surface-container-low px-3 py-1.5 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
                >
                  <option value="paid">Paid (collected outside Square)</option>
                  <option value="pending">Collect at appointment</option>
                </select>
              </div>
              <p className="text-label-tech text-foreground-muted">
                Final deposit on the booking row:{" "}
                <span className="text-foreground font-mono-tech">
                  {formatPriceFromCents(effectiveDepositCents)}
                </span>
              </p>
            </div>
          )}

          {/* Notification toggles */}
          <label className="flex items-center gap-3 text-label-tech text-foreground-muted">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="accent-primary"
            />
            Send confirmation email to customer
          </label>

          {error && <p className="text-error text-body-md">{error}</p>}
        </div>

        <div className="flex gap-2 justify-end p-6 border-t border-border sticky bottom-0 bg-surface-container">
          <Button variant="ghost" size="md" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Creating…
              </>
            ) : (
              "Create booking"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-label-tech text-foreground-muted mb-2 block">{label}</label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-surface-container-low px-4 py-2 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
    />
  );
}
