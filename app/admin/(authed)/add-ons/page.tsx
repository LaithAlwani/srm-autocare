"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, Trash2, Pencil, X, Check, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/admin/confirm-modal";
import { formatPriceFromCents, formatDuration } from "@/lib/format";

type FormState = {
  name: string;
  description: string;
  priceDollars: number;
  durationMinutes: number;
  order: number;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  priceDollars: 0,
  durationMinutes: 15,
  order: 999,
  active: true,
};

const dollarsToCents = (d: number) => Math.round(d * 100);
const centsToDollars = (c: number) => Math.round(c) / 100;

export default function AdminAddOnsPage() {
  const addOns = useQuery(api.addOns.list, { includeInactive: true });
  const create = useMutation(api.addOns.create);
  const update = useMutation(api.addOns.update);
  const remove = useMutation(api.addOns.remove);

  const [editingId, setEditingId] = useState<Id<"addOns"> | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"addOns">;
    name: string;
  } | null>(null);

  function startEdit(a: NonNullable<typeof addOns>[number]) {
    setEditingId(a._id);
    setForm({
      name: a.name,
      description: a.description ?? "",
      priceDollars: centsToDollars(a.priceCents),
      durationMinutes: a.durationMinutes,
      order: a.order,
      active: a.active,
    });
  }

  function startNew() {
    setEditingId("new");
    setForm({ ...EMPTY_FORM, order: (addOns?.length ?? 0) + 1 });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const priceCents = dollarsToCents(form.priceDollars);
      // Snap to 15-minute steps so the value matches Cal.com's
      // `lengthInMinutesOptions` granularity (15-min increments).
      const durationMinutes = Math.max(0, Math.round(form.durationMinutes / 15) * 15);
      if (editingId === "new") {
        await create({
          name: form.name,
          description: form.description.trim() || undefined,
          priceCents,
          durationMinutes,
          order: form.order,
          active: form.active,
        });
      } else if (editingId) {
        await update({
          id: editingId,
          patch: {
            name: form.name,
            description: form.description.trim() || undefined,
            priceCents,
            durationMinutes,
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
          <h1 className="text-headline-lg uppercase">Add-ons</h1>
        </div>
        {editingId === null && (
          <Button variant="primary" size="md" onClick={startNew}>
            <Plus size={14} /> New Add-on
          </Button>
        )}
      </div>

      <p className="text-body-md text-foreground-muted mb-8 max-w-2xl">
        Optional extras the customer can stack onto any service during booking.
        Each add-on contributes its price to the deposit and lengthens the
        appointment by its duration so the calendar blocks the right window.
      </p>

      {editingId !== null && (
        <div className="gloss-card p-4 md:p-8 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-headline-md uppercase">
              {editingId === "new" ? "New add-on" : "Edit add-on"}
            </h2>
            <button
              onClick={() => setEditingId(null)}
              className="text-foreground-muted hover:text-foreground"
              aria-label="Close"
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
            </div>
            <div className="md:col-span-2">
              <label className="text-label-tech text-foreground-muted mb-2 block">
                Description (optional)
              </label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="A short note about what's included."
                className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary resize-none"
              />
            </div>
            <MoneyField
              label="Price"
              value={form.priceDollars}
              onChange={(v) => setForm((f) => ({ ...f, priceDollars: v }))}
            />
            <NumberField
              label="Duration (minutes)"
              value={form.durationMinutes}
              step={15}
              onChange={(v) => setForm((f) => ({ ...f, durationMinutes: v }))}
              hint="Snapped to 15-minute steps on save."
            />
            <NumberField
              label="Order (display)"
              value={form.order}
              onChange={(v) => setForm((f) => ({ ...f, order: v }))}
            />
            <div className="flex items-center gap-3 self-end pb-2">
              <input
                type="checkbox"
                id="active"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="active" className="text-label-tech text-foreground">
                Active (offered during booking)
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

      {addOns === undefined ? (
        <p className="text-foreground-muted">Loading add-ons...</p>
      ) : addOns.length === 0 ? (
        <div className="gloss-card p-8 text-center">
          <p className="text-foreground-muted mb-4">No add-ons yet.</p>
          {editingId === null && (
            <Button variant="primary" size="md" onClick={startNew}>
              <Plus size={14} /> Create your first add-on
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden md:block gloss-card overflow-x-auto">
            <table className="w-full min-w-180">
              <thead>
                <tr className="text-label-tech text-foreground-muted border-b border-border">
                  <th className="text-left p-4">Add-on</th>
                  <th className="text-left p-4 w-32">Duration</th>
                  <th className="text-right p-4 w-28">Price</th>
                  <th className="text-right p-4 w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {addOns.map((a) => (
                  <tr
                    key={a._id}
                    className="border-b border-border last:border-0 text-body-md align-top"
                  >
                    <td className="p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-foreground">{a.name}</span>
                          <span
                            className={`text-label-tech px-2 py-0.5 border ${
                              a.active
                                ? "text-success border-success/30 bg-success/10"
                                : "text-foreground-muted border-border"
                            }`}
                          >
                            {a.active ? "ON" : "OFF"}
                          </span>
                        </div>
                        <div className="text-label-tech text-foreground-muted mt-1">
                          #{a.order}
                          {a.description && <> · {a.description}</>}
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-foreground-muted whitespace-nowrap">
                      +{formatDuration(a.durationMinutes)}
                    </td>
                    <td className="p-4 text-right text-foreground font-mono-tech whitespace-nowrap">
                      +{formatPriceFromCents(a.priceCents)}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => startEdit(a)}
                        className="p-2 text-foreground-muted hover:text-foreground transition-colors"
                        aria-label="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget({ id: a._id, name: a.name })}
                        className="p-2 text-foreground-muted hover:text-error transition-colors ml-1"
                        aria-label="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <ul className="md:hidden space-y-3">
            {addOns.map((a) => (
              <li key={a._id} className="gloss-card p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-headline-md text-foreground wrap-break-word">
                      {a.name}
                    </div>
                    <div className="text-label-tech text-foreground-muted mt-1">
                      #{a.order}
                    </div>
                  </div>
                  <span
                    className={`text-label-tech px-2 py-1 border shrink-0 ${
                      a.active
                        ? "text-success border-success/30 bg-success/10"
                        : "text-foreground-muted border-border"
                    }`}
                  >
                    {a.active ? "ON" : "OFF"}
                  </span>
                </div>

                {a.description && (
                  <p className="text-body-md text-foreground-muted">{a.description}</p>
                )}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-label-tech">
                  <dt className="text-foreground-muted">Duration</dt>
                  <dd className="text-right text-foreground">
                    +{formatDuration(a.durationMinutes)}
                  </dd>
                  <dt className="text-foreground-muted">Price</dt>
                  <dd className="text-right text-foreground font-mono-tech">
                    +{formatPriceFromCents(a.priceCents)}
                  </dd>
                </dl>

                <div className="flex gap-2 pt-2 border-t border-border">
                  <button
                    onClick={() => startEdit(a)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-label-tech border border-border text-foreground-muted hover:text-foreground hover:border-chrome transition-colors"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ id: a._id, name: a.name })}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-label-tech border border-error/40 text-error hover:bg-error/10 transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete add-on?"
          variant="danger"
          confirmLabel="Delete add-on"
          cancelLabel="Keep add-on"
          message={
            <p>
              <span className="text-foreground">{deleteTarget.name}</span> will no
              longer be offered during booking. Past bookings keep their snapshot
              of this add-on, so receipts stay legible.
            </p>
          }
          onConfirm={async () => {
            await remove({ id: deleteTarget.id });
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
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-label-tech text-foreground-muted mb-2 block">{label}</label>
      <input
        type="number"
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
      />
      {hint && <p className="text-label-tech text-foreground-muted mt-2">{hint}</p>}
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
            onChange(Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
          }}
          className="w-full bg-surface-container pl-8 pr-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
        />
      </div>
    </div>
  );
}
