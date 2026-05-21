"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Plus, Trash2, Pencil, X, Check, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/admin/confirm-modal";
import { formatPriceFromCents, formatDuration } from "@/lib/format";
import { computeDepositCents, slugify } from "@/lib/booking";
import { ICON_OPTIONS, resolveIcon } from "@/lib/icons";

type FormState = {
  name: string;
  description: string;
  durationMinutes: number;
  // Dollars, with 2-decimal precision. Converted to cents on save so the
  // backend can stay integer-only (no floating-point currency bugs).
  priceFromDollars: number;
  icon: string;
  badge: string;
  order: number;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  durationMinutes: 60,
  priceFromDollars: 0,
  icon: ICON_OPTIONS[0],
  badge: "",
  order: 999,
  active: true,
};

const dollarsToCents = (d: number) => Math.round(d * 100);
const centsToDollars = (c: number) => Math.round(c) / 100;

export default function AdminServicesPage() {
  const services = useQuery(api.services.list, { includeInactive: true });
  const createService = useAction(api.services.create);
  const updateService = useAction(api.services.update);
  const removeService = useAction(api.services.remove);

  const [editingId, setEditingId] = useState<Id<"services"> | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"services">;
    name: string;
  } | null>(null);

  function startEdit(s: NonNullable<typeof services>[number]) {
    setEditingId(s._id);
    setForm({
      name: s.name,
      description: s.description,
      durationMinutes: s.durationMinutes,
      priceFromDollars: centsToDollars(s.priceFromCents),
      icon: s.icon ?? ICON_OPTIONS[0],
      badge: s.badge ?? "",
      order: s.order,
      active: s.active,
    });
  }

  function startNew() {
    setEditingId("new");
    setForm({ ...EMPTY_FORM, order: (services?.length ?? 0) + 1 });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const priceFromCents = dollarsToCents(form.priceFromDollars);
      if (editingId === "new") {
        await createService({
          name: form.name,
          description: form.description,
          durationMinutes: form.durationMinutes,
          priceFromCents,
          icon: form.icon || undefined,
          badge: form.badge || undefined,
          order: form.order,
          active: form.active,
        });
      } else if (editingId) {
        await updateService({
          id: editingId,
          patch: {
            name: form.name,
            description: form.description,
            durationMinutes: form.durationMinutes,
            priceFromCents,
            icon: form.icon || undefined,
            badge: form.badge || undefined,
            order: form.order,
            active: form.active,
          },
        });
      }
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }


  return (
    <div>
      <div className="flex justify-between items-end mb-10">
        <div>
          <Eyebrow className="mb-3">Catalog</Eyebrow>
          <h1 className="text-headline-lg uppercase">Services</h1>
        </div>
        {editingId === null && (
          <Button variant="primary" size="md" onClick={startNew}>
            <Plus size={14} /> New Service
          </Button>
        )}
      </div>

      {editingId !== null && (
        <div className="gloss-card p-4 md:p-8 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-headline-md uppercase">
              {editingId === "new" ? "New service" : "Edit service"}
            </h2>
            <button
              onClick={() => setEditingId(null)}
              className="text-foreground-muted hover:text-foreground"
            >
              <X size={20} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <Field
                label="Name"
                value={form.name}
                onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              />
              {/* The slug is auto-derived from the name and shown read-only so
                  the owner can see what the URL will look like — no extra
                  field to fill in. */}
              <p className="text-label-tech text-foreground-muted mt-2">
                URL slug:{" "}
                <span className="font-mono-tech text-foreground">
                  {slugify(form.name) || "—"}
                </span>
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="text-label-tech text-foreground-muted mb-2 block">Description</label>
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary resize-none"
              />
            </div>
            <NumberField
              label="Duration (minutes)"
              value={form.durationMinutes}
              onChange={(v) => setForm((f) => ({ ...f, durationMinutes: v }))}
            />
            <NumberField
              label="Order (display)"
              value={form.order}
              onChange={(v) => setForm((f) => ({ ...f, order: v }))}
            />
            <div>
              <MoneyField
                label="Price from"
                value={form.priceFromDollars}
                onChange={(v) => setForm((f) => ({ ...f, priceFromDollars: v }))}
              />
              <p className="text-label-tech text-foreground-muted mt-2">
                Deposit (33%):{" "}
                <span className="font-mono-tech text-foreground">
                  {formatPriceFromCents(
                    computeDepositCents(dollarsToCents(form.priceFromDollars)),
                  )}
                </span>
              </p>
            </div>
            <div>
              <label className="text-label-tech text-foreground-muted mb-2 block">Icon</label>
              <select
                value={form.icon}
                onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
              >
                {ICON_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Badge (optional)"
              value={form.badge}
              onChange={(v) => setForm((f) => ({ ...f, badge: v }))}
            />
            <div className="md:col-span-2 p-4 border border-border bg-surface-container-low">
              <p className="text-label-tech text-foreground-muted">
                Availability is computed from{" "}
                <span className="text-foreground">/admin/settings → Hours &amp; availability</span>{" "}
                plus the existing bookings on the calendar. When this service is{" "}
                <span className="text-foreground">Active</span>, customers will see slots that
                fit its duration. To push bookings to your Google Calendar, connect it under
                Settings.
              </p>
            </div>
            <div className="md:col-span-2 flex items-center gap-3">
              <input
                type="checkbox"
                id="active"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="active" className="text-label-tech text-foreground">
                Active (visible to customers)
              </label>
            </div>
          </div>

          {error && <p className="text-error text-body-md mt-4">{error}</p>}
          <div className="flex gap-2 mt-8 justify-end">
            <Button variant="ghost" size="md" onClick={() => setEditingId(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" size="md" onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="animate-spin" size={14} /> Saving...
                </>
              ) : (
                <>
                  <Check size={14} /> Save
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {services === undefined ? (
        <p className="text-foreground-muted">Loading services...</p>
      ) : (
        <>
          {/* Desktop: condensed table. Order + active chip + slug live in the
              Service cell, price + deposit share a Pricing cell. overflow-x-auto
              is a safety net for narrow viewports between md and lg. */}
          <div className="hidden md:block gloss-card overflow-x-auto">
            <table className="w-full min-w-180">
              <thead>
                <tr className="text-label-tech text-foreground-muted border-b border-border">
                  <th className="text-left p-4">Service</th>
                  <th className="text-left p-4 w-24">Duration</th>
                  <th className="text-right p-4 w-32">Pricing</th>
                  <th className="text-right p-4 w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => {
                  const Icon = resolveIcon(s.icon);
                  return (
                    <tr
                      key={s._id}
                      className="border-b border-border last:border-0 text-body-md align-top"
                    >
                      <td className="p-4">
                        <div className="flex items-start gap-3">
                          <Icon
                            size={20}
                            className="text-primary shrink-0 mt-0.5"
                            strokeWidth={1.5}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-foreground">{s.name}</span>
                              <span
                                className={`text-label-tech px-2 py-0.5 border ${
                                  s.active
                                    ? "text-success border-success/30 bg-success/10"
                                    : "text-foreground-muted border-border"
                                }`}
                              >
                                {s.active ? "ON" : "OFF"}
                              </span>
                            </div>
                            <div className="text-label-tech text-foreground-muted mt-1 truncate">
                              {s.slug} · #{s.order}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-foreground-muted whitespace-nowrap">
                        {formatDuration(s.durationMinutes)}
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="text-foreground font-mono-tech">
                          {formatPriceFromCents(s.priceFromCents)}
                        </div>
                        <div className="text-label-tech text-foreground-muted mt-1">
                          {formatPriceFromCents(computeDepositCents(s.priceFromCents))} dep.
                        </div>
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => startEdit(s)}
                          className="p-2 text-foreground-muted hover:text-foreground transition-colors"
                          aria-label="Edit"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() =>
                            setDeleteTarget({
                              id: s._id,
                              name: s.name,
                            })
                          }
                          className="p-2 text-foreground-muted hover:text-error transition-colors ml-1"
                          aria-label="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list */}
          <ul className="md:hidden space-y-3">
            {services.map((s) => {
              const Icon = resolveIcon(s.icon);
              return (
                <li key={s._id} className="gloss-card p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <Icon size={22} className="text-primary shrink-0 mt-0.5" strokeWidth={1.5} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-headline-md text-foreground wrap-break-word">
                          {s.name}
                        </div>
                        <span
                          className={`text-label-tech px-2 py-1 border shrink-0 ${
                            s.active
                              ? "text-success border-success/30 bg-success/10"
                              : "text-foreground-muted border-border"
                          }`}
                        >
                          {s.active ? "ON" : "OFF"}
                        </span>
                      </div>
                      <div className="text-label-tech text-foreground-muted mt-1 break-all">
                        {s.slug} · #{s.order}
                      </div>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-label-tech">
                    <dt className="text-foreground-muted">Duration</dt>
                    <dd className="text-right text-foreground">
                      {formatDuration(s.durationMinutes)}
                    </dd>
                    <dt className="text-foreground-muted">Price from</dt>
                    <dd className="text-right text-foreground font-mono-tech">
                      {formatPriceFromCents(s.priceFromCents)}
                    </dd>
                    <dt className="text-foreground-muted">Deposit (33%)</dt>
                    <dd className="text-right text-foreground-muted font-mono-tech">
                      {formatPriceFromCents(computeDepositCents(s.priceFromCents))}
                    </dd>
                  </dl>

                  <div className="flex gap-2 pt-2 border-t border-border">
                    <button
                      onClick={() => startEdit(s)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-label-tech border border-border text-foreground-muted hover:text-foreground hover:border-chrome transition-colors"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      onClick={() =>
                        setDeleteTarget({
                          id: s._id,
                          name: s.name,
                        })
                      }
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-label-tech border border-error/40 text-error hover:bg-error/10 transition-colors"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete service?"
          variant="danger"
          confirmLabel="Delete service"
          cancelLabel="Keep service"
          message={
            <p>
              <span className="text-foreground">{deleteTarget.name}</span> will be removed from
              the public site and the booking flow. Existing bookings tied to this service
              stay in the database.
            </p>
          }
          onConfirm={async () => {
            await removeService({ id: deleteTarget.id });
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-label-tech text-foreground-muted mb-2 block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-label-tech text-foreground-muted mb-2 block">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
      />
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-label-tech text-foreground-muted mb-2 block">{label} (CAD)</label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted text-body-md pointer-events-none">
          $
        </span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            // Snap to 2 decimal places so the saved cents value is exact.
            onChange(Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
          }}
          className="w-full bg-surface-container pl-8 pr-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
        />
      </div>
    </div>
  );
}
