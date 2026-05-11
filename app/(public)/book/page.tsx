"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Calendar, Check, Clock, Loader2 } from "lucide-react";
import { loadStripe, type Stripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { StripePaymentForm } from "@/components/stripe-payment-form";
import { formatPriceFromCents, formatDuration } from "@/lib/format";
import { resolveIcon } from "@/lib/icons";

// Midnight Precision palette mapped to Stripe Elements appearance API.
// Stripe needs literal hex strings here — keep in sync with app/globals.css.
const STRIPE_APPEARANCE: StripeElementsOptions["appearance"] = {
  theme: "night",
  labels: "above",
  variables: {
    colorPrimary: "#007aff",
    colorBackground: "#201f1f",
    colorText: "#e5e2e1",
    colorTextSecondary: "#c1c6d7",
    colorTextPlaceholder: "#8b90a0",
    colorDanger: "#ffb4ab",
    colorIcon: "#c1c6d7",
    colorIconTab: "#c1c6d7",
    colorIconTabSelected: "#007aff",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSizeBase: "16px",
    fontWeightNormal: "400",
    spacingUnit: "4px",
    borderRadius: "0px",
    focusBoxShadow: "0 0 0 1px #007aff",
    focusOutline: "none",
  },
  rules: {
    ".Input": {
      backgroundColor: "#201f1f",
      border: "1px solid rgba(229, 229, 229, 0.1)",
      boxShadow: "none",
      padding: "12px 14px",
    },
    ".Input:focus": {
      borderColor: "#007aff",
      boxShadow: "0 0 0 1px #007aff",
    },
    ".Label": {
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
      fontSize: "12px",
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "#c1c6d7",
      marginBottom: "8px",
    },
    ".Tab": {
      backgroundColor: "#201f1f",
      border: "1px solid rgba(229, 229, 229, 0.1)",
      boxShadow: "none",
    },
    ".Tab:hover": {
      backgroundColor: "#2a2a2a",
    },
    ".Tab--selected": {
      backgroundColor: "#2a2a2a",
      borderColor: "#007aff",
      boxShadow: "0 0 0 1px #007aff",
    },
  },
};

type Step = 0 | 1 | 2 | 3;
const STEP_LABELS: Record<Step, string> = {
  0: "Service",
  1: "Slot",
  2: "Details",
  3: "Payment",
};

// Loaded once at module scope per Stripe.js best practice — calling loadStripe
// inside the component would re-create the script tag on every render.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set");
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}

export default function BookPage() {
  const searchParams = useSearchParams();
  const services = useQuery(api.services.list, {});
  const listSlots = useAction(api.calcom.listSlots);
  const createPaymentIntent = useAction(api.stripe.createPaymentIntent);

  const [step, setStep] = useState<Step>(0);
  const [serviceId, setServiceId] = useState<Id<"services"> | null>(
    (searchParams.get("service") as Id<"services"> | null) ?? null,
  );
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [slots, setSlots] = useState<string[]>([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
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
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const selectedService = useMemo(
    () => (serviceId ? services?.find((s) => s._id === serviceId) ?? null : null),
    [services, serviceId],
  );

  // If a service was prefilled via ?service=, auto-advance to step 1.
  useEffect(() => {
    if (serviceId && step === 0 && services && selectedService) {
      setStep(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);

  // Re-fetch slots when date, service, or step changes to step 1.
  useEffect(() => {
    if (step !== 1 || !serviceId) return;
    setSlotLoading(true);
    setSlotError(null);
    listSlots({ serviceId, dateISO: date })
      .then((s) => setSlots(s))
      .catch((err) => setSlotError(err instanceof Error ? err.message : "Could not load slots"))
      .finally(() => setSlotLoading(false));
  }, [step, date, serviceId, listSlots]);

  async function handleBookAndPay() {
    if (!serviceId || !slotStartISO || !selectedService) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const slotStart = new Date(slotStartISO).getTime();
      const slotEnd = slotStart + selectedService.durationMinutes * 60 * 1000;

      const { clientSecret: cs } = await createPaymentIntent({
        serviceId,
        slotStart,
        slotEnd,
        customerName: details.customerName.trim(),
        customerEmail: details.customerEmail.trim(),
        customerPhone: details.customerPhone.trim(),
        vehicleInfo: details.vehicleInfo.trim(),
        notes: details.notes.trim() || undefined,
      });
      setClientSecret(cs);
      setStep(3);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not create booking.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <section className="section-y border-b border-border">
        <Container>
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
          {/* Stepper */}
          <ol className="flex gap-2 mb-12 text-label-tech">
            {(Object.entries(STEP_LABELS) as [string, string][]).map(([k, label]) => {
              const n = Number(k) as Step;
              const active = step === n;
              const done = step > n;
              return (
                <li key={k} className="flex-1 flex items-center gap-3">
                  <span
                    className={`w-8 h-8 flex items-center justify-center border ${
                      active
                        ? "border-primary bg-primary text-on-primary glow-blue"
                        : done
                          ? "border-primary text-primary"
                          : "border-border text-foreground-muted"
                    }`}
                  >
                    {done ? <Check size={14} /> : `0${n + 1}`}
                  </span>
                  <span className={active ? "text-foreground" : "text-foreground-muted"}>
                    {label}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </li>
              );
            })}
          </ol>

          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
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
                                Deposit {formatPriceFromCents(s.depositCents)}
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
                    onClick={() => setStep(1)}
                  >
                    Continue
                    <ArrowRight size={14} />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 1 && selectedService && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <h2 className="text-headline-lg uppercase mb-8">Pick a time</h2>
                <div className="gloss-card p-6 mb-8 flex items-center gap-4">
                  <Calendar className="text-primary" size={20} />
                  <input
                    type="date"
                    value={date}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => {
                      setSlotStartISO(null);
                      setDate(e.target.value);
                    }}
                    className="bg-transparent text-foreground text-body-md focus:outline-none"
                  />
                  <div className="ml-auto text-label-tech text-foreground-muted">
                    {selectedService.name} • {formatDuration(selectedService.durationMinutes)}
                  </div>
                </div>

                {slotLoading ? (
                  <div className="flex items-center gap-3 text-foreground-muted">
                    <Loader2 className="animate-spin" size={18} /> Loading availability...
                  </div>
                ) : slotError ? (
                  <p className="text-error">{slotError}</p>
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
                  <Button variant="ghost" size="lg" onClick={() => setStep(0)}>
                    <ArrowLeft size={14} /> Back
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={!slotStartISO}
                    onClick={() => setStep(2)}
                  >
                    Continue
                    <ArrowRight size={14} />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 2 && selectedService && slotStartISO && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
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
                        value={formatDuration(selectedService.durationMinutes)}
                      />
                    </dl>
                    <div className="border-t border-border pt-4 mb-8">
                      <SummaryRow
                        label="Total (from)"
                        value={formatPriceFromCents(selectedService.priceFromCents)}
                      />
                      <div className="flex justify-between items-baseline mt-2">
                        <span className="text-label-tech text-primary">Deposit due now</span>
                        <span className="text-headline-md text-primary">
                          {formatPriceFromCents(selectedService.depositCents)}
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
                  <Button variant="ghost" size="lg" onClick={() => setStep(1)} disabled={submitting}>
                    <ArrowLeft size={14} /> Back
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 3 && selectedService && slotStartISO && clientSecret && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <h2 className="text-headline-lg uppercase mb-8">Payment</h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2">
                    <div className="gloss-card p-8">
                      <Elements
                        stripe={getStripe()}
                        options={{ clientSecret, appearance: STRIPE_APPEARANCE }}
                      >
                        <StripePaymentForm
                          returnUrl={`${window.location.origin}/book/success`}
                          customerEmail={details.customerEmail.trim()}
                          amountLabel={formatPriceFromCents(selectedService.depositCents)}
                        />
                      </Elements>
                    </div>
                  </div>
                  <aside className="gloss-card p-8 self-start">
                    <h3 className="text-headline-md uppercase mb-6">Summary</h3>
                    <dl className="space-y-4 text-body-md mb-8">
                      <SummaryRow label="Service" value={selectedService.name} />
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
                        value={formatDuration(selectedService.durationMinutes)}
                      />
                    </dl>
                    <div className="border-t border-border pt-4">
                      <div className="flex justify-between items-baseline">
                        <span className="text-label-tech text-primary">Deposit due now</span>
                        <span className="text-headline-md text-primary">
                          {formatPriceFromCents(selectedService.depositCents)}
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
                      setClientSecret(null);
                      setStep(2);
                    }}
                  >
                    <ArrowLeft size={14} /> Back
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Container>
      </section>
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
