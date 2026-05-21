"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { HeroMedia } from "@/components/hero-media";
import { heroMedia } from "@/config/media";
import { SquarePaymentForm } from "@/components/square-payment-form";
import { formatPriceFromCents, formatDuration } from "@/lib/format";
import { computeDepositCents } from "@/lib/booking";
import { resolveIcon } from "@/lib/icons";

type Step = 0 | 1 | 2 | 3 | 4;
// `Add-ons` is step 1. When the shop hasn't configured any active add-ons we
// skip past it automatically (see `nextStep` / `prevStep` below) so the
// customer never sees it.
const STEP_LABELS: Record<Step, string> = {
  0: "Service",
  1: "Add-ons",
  2: "Slot",
  3: "Details",
  4: "Payment",
};

// Today as `YYYY-MM-DD` in the browser's local zone. Used as the lower bound
// on the date picker — we never let the customer pick a day in the past.
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDateISO(iso: string, days: number): string {
  // Parse as local midnight so day arithmetic doesn't accidentally cross a
  // timezone boundary and land on the wrong calendar day.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function BookPage() {
  const searchParams = useSearchParams();
  const services = useQuery(api.services.list, {});
  const addOns = useQuery(api.addOns.list, {});
  const createDraftBooking = useAction(api.square.createDraftBooking);

  const [step, setStep] = useState<Step>(0);
  const [serviceId, setServiceId] = useState<Id<"services"> | null>(
    (searchParams.get("service") as Id<"services"> | null) ?? null,
  );
  const minDate = todayISO();
  const [date, setDate] = useState<string>(minDate);
  // Tracks whether we've auto-selected the nearest open date for this service
  // already — once the user manually changes it we leave them alone.
  const [autoSelectedFor, setAutoSelectedFor] = useState<Id<"services"> | null>(null);
  // Anchor we scroll to whenever the step changes — keeps mobile users from
  // landing on the footer when a step's content is shorter than what they
  // were viewing before.
  const stepperRef = useRef<HTMLDivElement>(null);
  const [slotStartISO, setSlotStartISO] = useState<string | null>(null);
  const [details, setDetails] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    vehicleInfo: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The Square preload returns everything we need to mount the Web Payments
  // SDK on step 4: a freshly-minted idempotency key (also used as the URL
  // token on the success page), the deposit amount, and the public app /
  // location IDs that initialize the SDK on the client.
  const [paymentSession, setPaymentSession] = useState<{
    idempotencyKey: string;
    depositCents: number;
    applicationId: string;
    locationId: string;
    environment: "sandbox" | "production";
  } | null>(null);
  // Add-ons selected for the current booking. Stored as IDs; we resolve them
  // to full rows when computing totals + when submitting to the backend.
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<Id<"addOns">[]>([]);

  // True when the shop has at least one active add-on; gates the entire
  // Add-ons step (skipped in stepper + nav when false).
  const hasAddOns = (addOns?.length ?? 0) > 0;

  const selectedAddOns = useMemo(
    () => (addOns ?? []).filter((a) => selectedAddOnIds.includes(a._id)),
    [addOns, selectedAddOnIds],
  );
  const addOnsTotalCents = selectedAddOns.reduce((sum, a) => sum + a.priceCents, 0);
  const addOnsTotalMinutes = selectedAddOns.reduce((sum, a) => sum + a.durationMinutes, 0);

  const selectedService = useMemo(
    () => (serviceId ? services?.find((s) => s._id === serviceId) ?? null : null),
    [services, serviceId],
  );

  // Total appointment minutes when the booking lands. Service duration plus
  // every add-on's duration. Drives Cal.com slot lookups + the deposit math.
  const totalDurationMinutes =
    (selectedService?.durationMinutes ?? 0) + addOnsTotalMinutes;
  // Deposit is 33% of (service price + add-on prices). Computed via the
  // shared `computeDepositCents` helper so the server (square.ts) and the
  // UI always arrive at the same number — Square charges whatever the
  // server says, never what the client previews.
  const totalCents = (selectedService?.priceFromCents ?? 0) + addOnsTotalCents;
  const totalDepositCents = computeDepositCents(totalCents);

  // Step navigation that auto-jumps over Add-ons when the shop hasn't
  // configured any. Both helpers clamp to valid Step values.
  function nextStep(from: Step): Step {
    if (from === 0 && !hasAddOns) return 2;
    return Math.min(4, from + 1) as Step;
  }
  function prevStep(from: Step): Step {
    if (from === 2 && !hasAddOns) return 0;
    return Math.max(0, from - 1) as Step;
  }

  // If a service was prefilled via ?service=, auto-advance past the Service
  // step. Skips Add-ons too when the shop has none configured.
  useEffect(() => {
    if (serviceId && step === 0 && services && selectedService) {
      setStep(hasAddOns ? 1 : 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, addOns]);

  // Live slot list — reactive query so cancellations / new bookings show
  // up immediately for anyone viewing this step.
  const slotsResult = useQuery(
    api.scheduling.listSlots,
    step === 2 && serviceId
      ? {
          serviceId,
          dateISO: date,
          totalDurationMinutes: totalDurationMinutes || undefined,
        }
      : "skip",
  );
  const slots = slotsResult ?? [];
  const slotLoading = step === 2 && serviceId !== null && slotsResult === undefined;

  // The first time the customer lands on the slot step for a given service,
  // jump them to the nearest day that actually has open slots — saves them
  // clicking forward through empty days. Subscribes only while we haven't
  // auto-picked yet; after the first hop it falls back to "skip".
  const nextAvailableDate = useQuery(
    api.scheduling.findNextAvailableDate,
    step === 2 && serviceId && autoSelectedFor !== serviceId
      ? { serviceId, totalDurationMinutes: totalDurationMinutes || undefined }
      : "skip",
  );

  useEffect(() => {
    if (
      step === 2 &&
      serviceId &&
      autoSelectedFor !== serviceId &&
      nextAvailableDate !== undefined
    ) {
      setAutoSelectedFor(serviceId);
      if (nextAvailableDate && nextAvailableDate >= minDate) {
        setDate(nextAvailableDate);
      }
    }
  }, [step, serviceId, autoSelectedFor, nextAvailableDate, minDate]);

  // Scroll the stepper into view whenever the step changes. Skip the very
  // first render so we don't jolt the page on initial mount. `start` block
  // alignment keeps the stepper visible at the top of the viewport.
  const firstStepRender = useRef(true);
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    stepperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  async function handleBookAndPay() {
    if (!serviceId || !slotStartISO || !selectedService) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const slotStart = new Date(slotStartISO).getTime();
      // slotEnd must reflect the full appointment duration (service + add-ons)
      // so the Cal.com booking blocks out the right window and a second
      // customer can't book on top of the tail end.
      const slotEnd = slotStart + totalDurationMinutes * 60 * 1000;

      const session = await createDraftBooking({
        serviceId,
        slotStart,
        slotEnd,
        customerName: details.customerName.trim(),
        customerEmail: details.customerEmail.trim(),
        customerPhone: details.customerPhone.trim(),
        vehicleInfo: details.vehicleInfo.trim(),
        notes: details.notes.trim() || undefined,
        addOnIds: selectedAddOnIds.length > 0 ? selectedAddOnIds : undefined,
      });
      setPaymentSession(session);
      setStep(4);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not create booking.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <section className="relative section-y border-b border-border overflow-hidden">
        <HeroMedia kind="image" src={heroMedia.bookHero} dim={70} />
        <Container className="relative z-10">
          <Eyebrow className="mb-4">Book an Appointment</Eyebrow>
          <h1 className="text-display uppercase tracking-tighter mb-6 max-w-3xl">
            Reserve your slot
          </h1>
          <p className="text-body-lg text-foreground-muted max-w-2xl">
            Select a service, pick a time, and place your deposit to confirm. The remaining balance
            is due at drop-off.
          </p>
        </Container>
      </section>

      <section className="section-y">
        <Container>
          {/* Stepper — full version on desktop, compact line + progress bar on mobile. */}
          {(() => {
            // Visible steps depend on whether the shop has add-ons. We keep
            // step indices stable internally (so the Step type can stay 0-4)
            // and only filter for display.
            const visibleSteps = (Object.entries(STEP_LABELS) as [string, string][])
              .map(([k, label]) => [Number(k) as Step, label] as const)
              .filter(([n]) => hasAddOns || n !== 1);
            const total = visibleSteps.length;
            const currentIndex = visibleSteps.findIndex(([n]) => n === step);
            const displayIndex = currentIndex >= 0 ? currentIndex : 0;
            const currentLabel = STEP_LABELS[step];
            const progress = ((displayIndex + 1) / total) * 100;
            return (
              <div ref={stepperRef} className="scroll-mt-20">
                {/* Mobile: condensed indicator */}
                <div className="md:hidden mb-10">
                  <div className="flex items-baseline justify-between mb-2 text-label-tech">
                    <span className="text-primary">
                      Step {String(displayIndex + 1).padStart(2, "0")} of {String(total).padStart(2, "0")}
                    </span>
                    <span className="text-foreground">{currentLabel}</span>
                  </div>
                  <div className="h-px bg-border relative">
                    <div
                      className="absolute inset-y-0 left-0 bg-primary glow-blue-soft transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Desktop: full stepper */}
                <ol className="hidden md:flex gap-2 mb-12 text-label-tech">
                  {visibleSteps.map(([n, label], idx) => {
                    const active = step === n;
                    const done = step > n;
                    return (
                      <li key={n} className="flex-1 flex items-center gap-3">
                        <span
                          className={`w-8 h-8 flex items-center justify-center border ${
                            active
                              ? "border-primary-strong bg-primary-strong text-on-primary glow-blue"
                              : done
                                ? "border-primary text-primary"
                                : "border-border text-foreground-muted"
                          }`}
                        >
                          {done ? <Check size={14} /> : `0${idx + 1}`}
                        </span>
                        <span className={active ? "text-foreground" : "text-foreground-muted"}>
                          {label}
                        </span>
                        <div className="flex-1 h-px bg-border" />
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })()}

          {/* Each step has a unique `key` so React remounts on step change,
              which re-triggers the CSS slide-up animation. No exit animation —
              the new step just appears in place of the old, which matches the
              feel of AnimatePresence's `mode="wait"` closely enough that most
              users won't notice the difference. */}
          <div>
            {step === 0 && (
              <div key="step-0" className="animate-slide-up">
                <h2 className="text-headline-lg uppercase mb-8">Choose a service</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {services === undefined ? (
                    [0, 1, 2, 3].map((i) => (
                      <div key={i} className="h-40 gloss-card animate-pulse" />
                    ))
                  ) : (
                    services.map((s) => {
                      const Icon = resolveIcon(s.icon);
                      const selected = serviceId === s._id;
                      return (
                        <button
                          key={s._id}
                          type="button"
                          onClick={() => setServiceId(s._id)}
                          className={`gloss-card p-6 text-left flex gap-4 items-start ${
                            selected ? "border-primary glow-blue-soft" : ""
                          }`}
                        >
                          <Icon className="text-primary shrink-0 mt-1" size={24} strokeWidth={1.5} />
                          <div className="flex-1">
                            <div className="flex items-baseline justify-between mb-1">
                              <h3 className="text-headline-md">{s.name}</h3>
                              <span className="text-label-tech text-foreground-muted">
                                {formatDuration(s.durationMinutes)}
                              </span>
                            </div>
                            <p className="text-body-md text-foreground-muted line-clamp-2 mb-3">
                              {s.description}
                            </p>
                            <div className="flex items-baseline gap-3">
                              <span className="text-label-tech text-foreground-muted">From</span>
                              <span className="text-headline-md text-primary">
                                {formatPriceFromCents(s.priceFromCents)}
                              </span>
                              <span className="text-label-tech text-foreground-muted ml-auto">
                                Deposit{" "}
                                {formatPriceFromCents(computeDepositCents(s.priceFromCents))}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="mt-12 flex justify-end">
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={!serviceId}
                    onClick={() => setStep(nextStep(0))}
                  >
                    Continue
                    <ArrowRight size={14} />
                  </Button>
                </div>
              </div>
            )}

            {step === 1 && selectedService && hasAddOns && (
              <div key="step-1" className="animate-slide-up">
                <div className="flex items-baseline justify-between mb-8 gap-4 flex-wrap">
                  <h2 className="text-headline-lg uppercase">Add-ons</h2>
                  <span className="text-label-tech text-foreground-muted">
                    Optional — skip any you don't need
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(addOns ?? []).map((a) => {
                    const selected = selectedAddOnIds.includes(a._id);
                    return (
                      <button
                        key={a._id}
                        type="button"
                        onClick={() =>
                          setSelectedAddOnIds((ids) =>
                            ids.includes(a._id)
                              ? ids.filter((id) => id !== a._id)
                              : [...ids, a._id],
                          )
                        }
                        className={`gloss-card p-6 text-left flex gap-4 items-start ${
                          selected ? "border-primary glow-blue-soft" : ""
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`mt-1 w-5 h-5 shrink-0 flex items-center justify-center border ${
                            selected
                              ? "border-primary-strong bg-primary-strong text-on-primary"
                              : "border-chrome"
                          }`}
                        >
                          {selected && <Check size={12} />}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-baseline justify-between mb-1 gap-3">
                            <h3 className="text-headline-md">{a.name}</h3>
                            <span className="text-label-tech text-foreground-muted">
                              +{formatDuration(a.durationMinutes)}
                            </span>
                          </div>
                          {a.description && (
                            <p className="text-body-md text-foreground-muted line-clamp-2 mb-3">
                              {a.description}
                            </p>
                          )}
                          <div className="text-headline-md text-primary">
                            +{formatPriceFromCents(a.priceCents)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedAddOns.length > 0 && (
                  <div className="mt-8 gloss-card p-6 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                    <span className="text-label-tech text-foreground-muted">Running total</span>
                    <span className="text-foreground">
                      +{formatPriceFromCents(addOnsTotalCents)} •{" "}
                      +{formatDuration(addOnsTotalMinutes)}
                    </span>
                    <span className="text-label-tech text-foreground-muted ml-auto">
                      Appointment {formatDuration(totalDurationMinutes)}
                    </span>
                  </div>
                )}

                <div className="mt-12 flex justify-between">
                  <Button variant="ghost" size="lg" onClick={() => setStep(prevStep(1))}>
                    <ArrowLeft size={14} /> Back
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => {
                      // Selecting different add-ons changes the appointment
                      // length, so any previously-picked slot is stale — clear
                      // it and force a fresh availability lookup.
                      setSlotStartISO(null);
                      setAutoSelectedFor(null);
                      setStep(nextStep(1));
                    }}
                  >
                    Continue
                    <ArrowRight size={14} />
                  </Button>
                </div>
              </div>
            )}

            {step === 2 && selectedService && (
              <div key="step-2" className="animate-slide-up">
                <h2 className="text-headline-lg uppercase mb-8">Pick a time</h2>
                <div className="gloss-card p-4 md:p-6 mb-8 flex flex-col md:flex-row md:items-center gap-4">
                  <DatePicker
                    date={date}
                    minDate={minDate}
                    onChange={(d) => {
                      setSlotStartISO(null);
                      setDate(d);
                    }}
                  />
                  <div className="md:ml-auto text-label-tech text-foreground-muted">
                    {selectedService.name} • {formatDuration(totalDurationMinutes)}
                    {selectedAddOns.length > 0 && (
                      <> • {selectedAddOns.length} add-on{selectedAddOns.length === 1 ? "" : "s"}</>
                    )}
                  </div>
                </div>

                {slotLoading ? (
                  <div className="flex items-center gap-3 text-foreground-muted">
                    <Loader2 className="animate-spin" size={18} /> Loading availability...
                  </div>
                ) : slots.length === 0 ? (
                  <p className="text-foreground-muted">No slots available on this date — try another.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {slots.map((iso) => {
                      const active = slotStartISO === iso;
                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => setSlotStartISO(iso)}
                          className={`gloss-card p-4 text-label-tech ${
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

                <div className="mt-12 flex justify-between">
                  <Button variant="ghost" size="lg" onClick={() => setStep(prevStep(2))}>
                    <ArrowLeft size={14} /> Back
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={!slotStartISO}
                    onClick={() => setStep(nextStep(2))}
                  >
                    Continue
                    <ArrowRight size={14} />
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && selectedService && slotStartISO && (
              <div key="step-3" className="animate-slide-up">
                <h2 className="text-headline-lg uppercase mb-8">Your details</h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 gloss-card p-8 space-y-6">
                    <Field
                      label="Full name"
                      value={details.customerName}
                      onChange={(v) => setDetails((d) => ({ ...d, customerName: v }))}
                      required
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <Field
                        label="Email"
                        type="email"
                        value={details.customerEmail}
                        onChange={(v) => setDetails((d) => ({ ...d, customerEmail: v }))}
                        required
                      />
                      <Field
                        label="Phone"
                        type="tel"
                        value={details.customerPhone}
                        onChange={(v) => setDetails((d) => ({ ...d, customerPhone: v }))}
                        required
                      />
                    </div>
                    <Field
                      label="Vehicle (year, make, model, color)"
                      value={details.vehicleInfo}
                      onChange={(v) => setDetails((d) => ({ ...d, vehicleInfo: v }))}
                      required
                      placeholder="e.g. 2024 Porsche 911 GT3 — Guards Red"
                    />
                    <div>
                      <label className="text-label-tech text-foreground-muted mb-2 block">
                        Notes (optional)
                      </label>
                      <textarea
                        rows={4}
                        value={details.notes}
                        onChange={(e) => setDetails((d) => ({ ...d, notes: e.target.value }))}
                        placeholder="Anything we should know about the vehicle's condition or your goals."
                        className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary transition-colors resize-none"
                      />
                    </div>
                  </div>
                  <aside className="gloss-card p-8 self-start">
                    <h3 className="text-headline-md uppercase mb-6">Summary</h3>
                    <dl className="space-y-4 text-body-md mb-8">
                      <SummaryRow label="Service" value={selectedService.name} />
                      {selectedAddOns.length > 0 && (
                        <div>
                          <dt className="text-label-tech text-foreground-muted mb-2">Add-ons</dt>
                          <dd className="space-y-1">
                            {selectedAddOns.map((a) => (
                              <div
                                key={a._id}
                                className="flex justify-between gap-3 text-foreground"
                              >
                                <span>{a.name}</span>
                                <span className="text-foreground-muted">
                                  +{formatPriceFromCents(a.priceCents)}
                                </span>
                              </div>
                            ))}
                          </dd>
                        </div>
                      )}
                      <SummaryRow
                        label="Date"
                        value={new Date(slotStartISO).toLocaleDateString("en-CA", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      />
                      <SummaryRow
                        label="Time"
                        value={new Date(slotStartISO).toLocaleTimeString("en-CA", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      />
                      <SummaryRow
                        label="Duration"
                        value={formatDuration(totalDurationMinutes)}
                      />
                    </dl>
                    <div className="border-t border-border pt-4 mb-8">
                      <SummaryRow
                        label="Total (from)"
                        value={formatPriceFromCents(
                          selectedService.priceFromCents + addOnsTotalCents,
                        )}
                      />
                      <div className="flex justify-between items-baseline mt-2">
                        <span className="text-label-tech text-primary">Deposit due now</span>
                        <span className="text-headline-md text-primary">
                          {formatPriceFromCents(totalDepositCents)}
                        </span>
                      </div>
                    </div>

                    {submitError && (
                      <p className="text-error text-body-md mb-4">{submitError}</p>
                    )}
                    <Button
                      variant="primary"
                      size="lg"
                      block
                      onClick={handleBookAndPay}
                      disabled={
                        submitting ||
                        !details.customerName ||
                        !details.customerEmail ||
                        !details.customerPhone ||
                        !details.vehicleInfo
                      }
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="animate-spin" size={14} /> Loading...
                        </>
                      ) : (
                        <>
                          Continue to payment
                          <ArrowRight size={14} />
                        </>
                      )}
                    </Button>
                    <p className="text-label-tech text-foreground-muted mt-4 text-center">
                      <Clock size={10} className="inline mr-1" />
                      Card details collected on the next step
                    </p>
                  </aside>
                </div>

                <div className="mt-12 flex justify-start">
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={() => setStep(prevStep(3))}
                    disabled={submitting}
                  >
                    <ArrowLeft size={14} /> Back
                  </Button>
                </div>
              </div>
            )}

            {step === 4 && selectedService && slotStartISO && paymentSession && (
              <div key="step-4" className="animate-slide-up">
                <h2 className="text-headline-lg uppercase mb-8">Payment</h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2">
                    <div className="gloss-card p-4 md:p-6">
                      <SquarePaymentForm
                        applicationId={paymentSession.applicationId}
                        locationId={paymentSession.locationId}
                        environment={paymentSession.environment}
                        idempotencyKey={paymentSession.idempotencyKey}
                        depositCents={paymentSession.depositCents}
                      />
                    </div>
                  </div>
                  <aside className="gloss-card p-8 self-start">
                    <h3 className="text-headline-md uppercase mb-6">Summary</h3>
                    <dl className="space-y-4 text-body-md mb-8">
                      <SummaryRow label="Service" value={selectedService.name} />
                      {selectedAddOns.length > 0 && (
                        <div>
                          <dt className="text-label-tech text-foreground-muted mb-2">Add-ons</dt>
                          <dd className="space-y-1">
                            {selectedAddOns.map((a) => (
                              <div
                                key={a._id}
                                className="flex justify-between gap-3 text-foreground"
                              >
                                <span>{a.name}</span>
                                <span className="text-foreground-muted">
                                  +{formatPriceFromCents(a.priceCents)}
                                </span>
                              </div>
                            ))}
                          </dd>
                        </div>
                      )}
                      <SummaryRow
                        label="When"
                        value={new Date(slotStartISO).toLocaleString("en-CA", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      />
                      <SummaryRow
                        label="Duration"
                        value={formatDuration(totalDurationMinutes)}
                      />
                    </dl>
                    <div className="border-t border-border pt-4">
                      <div className="flex justify-between items-baseline">
                        <span className="text-label-tech text-primary">Deposit due now</span>
                        <span className="text-headline-md text-primary">
                          {formatPriceFromCents(totalDepositCents)}
                        </span>
                      </div>
                    </div>
                  </aside>
                </div>

                <div className="mt-12 flex justify-start">
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={() => {
                      setPaymentSession(null);
                      setStep(prevStep(4));
                    }}
                  >
                    <ArrowLeft size={14} /> Back
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Container>
      </section>
    </div>
  );
}

// Bigger, more tappable date picker — arrow buttons either side of a single
// big "calendar icon + date" button that opens the browser's native date
// picker. Going back is disabled once we hit today so customers can't ever
// pick a past day.
function DatePicker({
  date,
  minDate,
  onChange,
}: {
  date: string;
  minDate: string;
  onChange: (iso: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canGoBack = date > minDate;

  function shift(days: number) {
    const next = shiftDateISO(date, days);
    if (next < minDate) return;
    onChange(next);
  }

  function openPicker() {
    const el = inputRef.current;
    if (!el) return;
    // Modern browsers expose showPicker(); fall back to focusing the input.
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        /* Some browsers throw if not triggered by direct user input — fall through. */
      }
    }
    el.focus();
    el.click();
  }

  return (
    <div className="flex items-stretch gap-2 w-full md:w-auto">
      <button
        type="button"
        onClick={() => shift(-1)}
        disabled={!canGoBack}
        aria-label="Previous day"
        className="w-12 flex items-center justify-center border border-border text-foreground-muted hover:text-foreground hover:border-chrome transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronLeft size={18} />
      </button>

      <button
        type="button"
        onClick={openPicker}
        className="flex-1 md:flex-none flex items-center justify-center gap-3 px-5 py-3 bg-surface-container border border-primary text-foreground hover:bg-surface-container-high transition-colors glow-blue-soft"
      >
        <Calendar size={18} className="text-primary shrink-0" />
        <span className="text-body-md whitespace-nowrap">{formatLongDate(date)}</span>
      </button>

      <button
        type="button"
        onClick={() => shift(1)}
        aria-label="Next day"
        className="w-12 flex items-center justify-center border border-border text-foreground-muted hover:text-foreground hover:border-chrome transition-colors"
      >
        <ChevronRight size={18} />
      </button>

      {/* Native input — visually hidden but still focusable / pickable. */}
      <input
        ref={inputRef}
        type="date"
        value={date}
        min={minDate}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="sr-only"
        aria-label="Pick a date"
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-label-tech text-foreground-muted mb-2 block">{label}</label>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary transition-colors"
      />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-label-tech text-foreground-muted">{label}</dt>
      <dd className="text-foreground text-right">{value}</dd>
    </div>
  );
}
