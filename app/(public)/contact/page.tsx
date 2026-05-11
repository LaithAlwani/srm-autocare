"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

type Status = "idle" | "sending" | "sent" | "error";

export default function ContactPage() {
  const sendInquiry = useAction(api.contact.sendInquiry);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    try {
      await sendInquiry({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        message: form.message.trim(),
      });
      setStatus("sent");
      setForm({ name: "", email: "", phone: "", message: "" });
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Could not send inquiry. Please try again.");
    }
  }

  return (
    <div>
      <section className="section-y border-b border-border">
        <Container>
          <Eyebrow className="mb-4">Contact</Eyebrow>
          <h1 className="text-display uppercase tracking-tighter mb-6 max-w-3xl">
            Get in touch
          </h1>
          <p className="text-body-lg text-foreground-muted max-w-2xl">
            Questions, custom packages, or fleet inquiries — drop a note and we'll respond within
            one business day.
          </p>
        </Container>
      </section>

      <section className="section-y">
        <Container>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Contact details */}
            <div>
              <h2 className="text-headline-lg uppercase mb-8">Details</h2>
              <ul className="space-y-8">
                <li className="flex gap-4">
                  <Phone className="text-primary mt-1 shrink-0" size={20} strokeWidth={1.5} />
                  <div>
                    <p className="text-label-tech text-foreground-muted mb-1">Phone</p>
                    <a
                      href={siteConfig.contact.phoneHref}
                      className="text-body-lg text-foreground hover:text-primary transition-colors"
                    >
                      {siteConfig.contact.phone}
                    </a>
                  </div>
                </li>
                <li className="flex gap-4">
                  <Mail className="text-primary mt-1 shrink-0" size={20} strokeWidth={1.5} />
                  <div>
                    <p className="text-label-tech text-foreground-muted mb-1">Email</p>
                    <a
                      href={`mailto:${siteConfig.contact.email}`}
                      className="text-body-lg text-foreground hover:text-primary transition-colors"
                    >
                      {siteConfig.contact.email}
                    </a>
                  </div>
                </li>
                <li className="flex gap-4">
                  <MapPin className="text-primary mt-1 shrink-0" size={20} strokeWidth={1.5} />
                  <div>
                    <p className="text-label-tech text-foreground-muted mb-1">Garage</p>
                    <a
                      href={siteConfig.address.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-body-lg text-foreground hover:text-primary transition-colors"
                    >
                      {siteConfig.address.street}
                      <br />
                      {siteConfig.address.city}, {siteConfig.address.state}{" "}
                      {siteConfig.address.zip}
                    </a>
                  </div>
                </li>
                <li className="flex gap-4">
                  <Clock className="text-primary mt-1 shrink-0" size={20} strokeWidth={1.5} />
                  <div>
                    <p className="text-label-tech text-foreground-muted mb-1">Hours</p>
                    <ul className="text-body-md text-foreground space-y-1">
                      {siteConfig.defaultHours.map((h) => (
                        <li key={h.day} className="flex justify-between gap-6 min-w-45">
                          <span className="text-foreground-muted">{h.day}</span>
                          <span>{h.open ? `${h.open} – ${h.close}` : "Closed"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              </ul>
            </div>

            {/* Form */}
            <div className="gloss-card p-8 md:p-10">
              <form onSubmit={handleSubmit} className="space-y-6">
                <FormField
                  label="Name"
                  name="name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  disabled={status === "sending"}
                />
                <FormField
                  label="Email"
                  name="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(v) => setForm((f) => ({ ...f, email: v }))}
                  disabled={status === "sending"}
                />
                <FormField
                  label="Phone (optional)"
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                  disabled={status === "sending"}
                />
                <div>
                  <label
                    htmlFor="message"
                    className="text-label-tech text-foreground-muted mb-2 block"
                  >
                    Message
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    required
                    rows={5}
                    disabled={status === "sending"}
                    value={form.message}
                    onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                    className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary transition-colors resize-none"
                    placeholder="Tell us about your vehicle..."
                  />
                </div>

                {status === "sent" && (
                  <p className="text-body-md text-success">
                    Thanks — your inquiry is on its way. We'll be in touch shortly.
                  </p>
                )}
                {status === "error" && errorMsg && (
                  <p className="text-body-md text-error">{errorMsg}</p>
                )}

                <Button type="submit" variant="primary" size="lg" block disabled={status === "sending"}>
                  {status === "sending" ? "Sending..." : "Send Inquiry"}
                </Button>
              </form>
            </div>
          </div>
        </Container>
      </section>

      {/* MAP — embedded Google Maps view of the studio. Uses the unauthenticated
          ?output=embed trick (no API key needed) and centers on the configured
          address from siteConfig so it stays in sync with the rest of the site. */}
      <section className="pb-20">
        <Container>
          <div className="gloss-card overflow-hidden">
            <iframe
              title={`Map: ${siteConfig.name}`}
              src={`https://maps.google.com/maps?q=${encodeURIComponent(
                `${siteConfig.address.street}, ${siteConfig.address.city}, ${siteConfig.address.state} ${siteConfig.address.zip}, ${siteConfig.address.country}`,
              )}&output=embed`}
              className="w-full h-105 block"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <p className="text-label-tech text-foreground-muted mt-4 text-center">
            <a
              href={siteConfig.address.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Open in Google Maps ↗
            </a>
          </p>
        </Container>
      </section>
    </div>
  );
}

function FormField({
  label,
  name,
  type,
  value,
  onChange,
  required,
  disabled,
}: {
  label: string;
  name: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-label-tech text-foreground-muted mb-2 block">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary transition-colors"
      />
    </div>
  );
}
