"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, Trash2, Pencil, X, Check, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { formatPriceFromCents, formatDuration } from "@/lib/format";
import { ICON_OPTIONS, resolveIcon } from "@/lib/icons";

type FormState = {
  name: string;
  slug: string;
  description: string;
  durationMinutes: number;
  // Dollars, with 2-decimal precision. Converted to cents on save so the
  // backend can stay integer-only (no floating-point currency bugs).
  priceFromDollars: number;
  depositDollars: number;
  icon: string;
  badge: string;
  // 0 = no per-service event type configured (falls back to env var).
  calcomEventTypeId: number;
  order: number;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  slug: "",
  description: "",
  durationMinutes: 60,
  priceFromDollars: 0,
  depositDollars: 0,
  icon: ICON_OPTIONS[0],
  badge: "",
  calcomEventTypeId: 0,
  order: 999,
  active: true,
};

const dollarsToCents = (d: number) => Math.round(d * 100);
const centsToDollars = (c: number) => Math.round(c) / 100;

export default function AdminServicesPage() {
  const services = useQuery(api.services.list, { includeInactive: true });
  const createService = useMutation(api.services.create);
  const updateService = useMutation(api.services.update);
  const removeService = useMutation(api.services.remove);

  const [editingId, setEditingId] = useState<Id<"services"> | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(s: NonNullable<typeof services>[number]) {
    setEditingId(s._id);
    setForm({
      name: s.name,
      slug: s.slug,
      description: s.description,
      durationMinutes: s.durationMinutes,
      priceFromDollars: centsToDollars(s.priceFromCents),
      depositDollars: centsToDollars(s.depositCents),
      icon: s.icon ?? ICON_OPTIONS[0],
      badge: s.badge ?? "",
      calcomEventTypeId: s.calcomEventTypeId ?? 0,
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
      const depositCents = dollarsToCents(form.depositDollars);
      const calcomEventTypeId = form.calcomEventTypeId > 0 ? form.calcomEventTypeId : undefined;
      if (editingId === "new") {
        await createService({
          name: form.name,
          slug: form.slug,
          description: form.description,
          durationMinutes: form.durationMinutes,
          priceFromCents,
          depositCents,
          icon: form.icon || undefined,
          badge: form.badge || undefined,
          calcomEventTypeId,
          order: form.order,
          active: form.active,
        });
      } else if (editingId) {
        await updateService({
          id: editingId,
          patch: {
            name: form.name,
            slug: form.slug,
            description: form.description,
            durationMinutes: form.durationMinutes,
            priceFromCents,
            depositCents,
            icon: form.icon || undefined,
            badge: form.badge || undefined,
            calcomEventTypeId: calcomEventTypeId ?? null,
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

  async function handleDelete(id: Id<"services">) {
    if (!confirm("Delete this service?")) return;
    await removeService({ id });
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
        <div className="gloss-card p-8 mb-8">
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
            <Field label="Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <Field
              label="Slug (URL key)"
              value={form.slug}
              onChange={(v) => setForm((f) => ({ ...f, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
            />
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
            <MoneyField
              label="Price from"
              value={form.priceFromDollars}
              onChange={(v) => setForm((f) => ({ ...f, priceFromDollars: v }))}
            />
            <MoneyField
              label="Deposit"
              value={form.depositDollars}
              onChange={(v) => setForm((f) => ({ ...f, depositDollars: v }))}
            />
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
            <div className="md:col-span-2">
              <label className="text-label-tech text-foreground-muted mb-2 block">
                Cal.com event type ID
              </label>
              <input
                type="number"
                min="0"
                value={form.calcomEventTypeId || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, calcomEventTypeId: Number(e.target.value) || 0 }))
                }
                placeholder="e.g. 5650170 — leave blank to use the global fallback"
                className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
              />
              <p className="text-label-tech text-foreground-muted mt-2">
                Find in Cal.com → Event Types → open the event → URL ends in <code className="text-primary">/event-types/12345</code>.
                The duration set in Cal.com determines how long the slot is blocked off.
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
        <div className="gloss-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-label-tech text-foreground-muted border-b border-border">
                <th className="text-left p-4">Order</th>
                <th className="text-left p-4">Service</th>
                <th className="text-left p-4">Duration</th>
                <th className="text-right p-4">Price from</th>
                <th className="text-right p-4">Deposit</th>
                <th className="text-center p-4">Active</th>
                <th className="text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => {
                const Icon = resolveIcon(s.icon);
                return (
                  <tr key={s._id} className="border-b border-border last:border-0 text-body-md">
                    <td className="p-4 text-foreground-muted">{s.order}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <Icon size={18} className="text-primary" strokeWidth={1.5} />
                        <div>
                          <div className="text-foreground">{s.name}</div>
                          <div className="text-label-tech text-foreground-muted">{s.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-foreground-muted">{formatDuration(s.durationMinutes)}</td>
                    <td className="p-4 text-right text-foreground">{formatPriceFromCents(s.priceFromCents)}</td>
                    <td className="p-4 text-right text-foreground-muted">
                      {formatPriceFromCents(s.depositCents)}
                    </td>
                    <td className="p-4 text-center">
                      <span
                        className={`text-label-tech px-2 py-1 ${
                          s.active ? "text-success" : "text-foreground-muted"
                        }`}
                      >
                        {s.active ? "ON" : "OFF"}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => startEdit(s)}
                        className="p-2 text-foreground-muted hover:text-foreground transition-colors"
                        aria-label="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(s._id)}
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
