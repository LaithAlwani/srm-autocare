"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  Plus,
  Unplug,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { DateScroller } from "@/components/ui/date-scroller";
import {
  type BusinessHours,
  type DaySchedule,
  type Weekday,
  DEFAULT_BUSINESS_HOURS,
} from "@/lib/businessHours";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const JSON_KEYS = ["hero", "process"] as const;

export default function AdminSettingsPage() {
  return (
    <div className="space-y-12">
      <header>
        <Eyebrow className="mb-3">Configuration</Eyebrow>
        <h1 className="text-headline-lg uppercase mb-2">Settings</h1>
        <p className="text-body-md text-foreground-muted max-w-2xl">
          Business hours + integrations on this page. Static brand info
          (phone, address, social) lives in{" "}
          <code className="text-primary">config/site.ts</code>.
        </p>
      </header>

      <BusinessHoursSection />
      <GoogleCalendarSection />
      <SiteContentSection />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Business hours editor
// ───────────────────────────────────────────────────────────────────

function BusinessHoursSection() {
  const hours = useQuery(api.scheduling.getBusinessHours);
  const setBusinessHours = useMutation(api.scheduling.setBusinessHours);

  const [draft, setDraft] = useState<BusinessHours | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hours) setDraft(hours);
  }, [hours]);

  // Default to today so the DateScroller has a concrete date to render.
  // The owner clicks the icon to open the native picker for far jumps
  // (holidays months out), or uses the arrows for nearby dates.
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [newBlackout, setNewBlackout] = useState(todayISO);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await setBusinessHours({
        timeZone: draft.timeZone,
        slotIntervalMinutes: draft.slotIntervalMinutes,
        minBookingNoticeMinutes: draft.minBookingNoticeMinutes,
        bookingWindowDays: draft.bookingWindowDays,
        weekly: draft.weekly,
        blackoutDates: draft.blackoutDates,
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <section className="gloss-card p-6">
        <h2 className="text-headline-md uppercase mb-4">Hours & availability</h2>
        <p className="text-label-tech text-foreground-muted flex items-center gap-2">
          <Loader2 className="animate-spin" size={14} /> Loading…
        </p>
      </section>
    );
  }

  return (
    <section className="gloss-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-headline-md uppercase">Hours & availability</h2>
        <div className="flex items-center gap-3">
          {savedAt && Date.now() - savedAt < 3000 && (
            <span className="text-label-tech text-success flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          )}
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" size={12} /> Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {draft.weekly.map((day) => (
          <DayRow
            key={day.day}
            value={day}
            onChange={(next) =>
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      weekly: d.weekly.map((row) =>
                        row.day === day.day ? next : row,
                      ),
                    }
                  : d,
              )
            }
          />
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <NumberField
          label="Slot interval (min)"
          value={draft.slotIntervalMinutes}
          step={5}
          onChange={(v) =>
            setDraft((d) => (d ? { ...d, slotIntervalMinutes: v } : d))
          }
        />
        <NumberField
          label="Earliest booking (min from now)"
          value={draft.minBookingNoticeMinutes}
          onChange={(v) =>
            setDraft((d) => (d ? { ...d, minBookingNoticeMinutes: v } : d))
          }
        />
        <NumberField
          label="Booking window (days ahead)"
          value={draft.bookingWindowDays}
          onChange={(v) =>
            setDraft((d) => (d ? { ...d, bookingWindowDays: v } : d))
          }
        />
      </div>

      <div className="mt-8">
        <h3 className="text-label-tech text-foreground-muted mb-3">
          Blackout dates
        </h3>
        <p className="text-body-md text-foreground-muted mb-4">
          Days the shop is closed (holidays, vacation). Customers won't see any
          slots on these dates.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {draft.blackoutDates.length === 0 && (
            <span className="text-label-tech text-foreground-muted">None</span>
          )}
          {draft.blackoutDates.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-2 text-label-tech border border-border bg-surface-container-low px-3 py-1.5 text-foreground"
            >
              {d}
              <button
                type="button"
                aria-label={`Remove ${d}`}
                onClick={() =>
                  setDraft((cur) =>
                    cur
                      ? {
                          ...cur,
                          blackoutDates: cur.blackoutDates.filter((x) => x !== d),
                        }
                      : cur,
                  )
                }
                className="text-foreground-muted hover:text-error"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateScroller
            date={newBlackout}
            minDate={todayISO}
            onChange={setNewBlackout}
            ariaLabel="Pick a blackout date"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!newBlackout}
            onClick={() => {
              setDraft((cur) =>
                cur && !cur.blackoutDates.includes(newBlackout)
                  ? { ...cur, blackoutDates: [...cur.blackoutDates, newBlackout].sort() }
                  : cur,
              );
              setNewBlackout(todayISO);
            }}
          >
            <Plus size={12} /> Add
          </Button>
        </div>
      </div>

      <p className="text-label-tech text-foreground-muted mt-6">
        Time zone:{" "}
        <span className="font-mono-tech text-foreground">{draft.timeZone}</span>
      </p>

      {error && <p className="text-error text-body-md mt-4">{error}</p>}
    </section>
  );
}

function DayRow({
  value,
  onChange,
}: {
  value: DaySchedule;
  onChange: (next: DaySchedule) => void;
}) {
  const open = value.open !== null && value.close !== null;
  return (
    <div className="flex flex-wrap items-center gap-4 p-3 border border-border bg-surface-container-lowest">
      <div className="w-28 text-foreground">
        {WEEKDAY_NAMES[value.day as Weekday]}
      </div>
      <label className="inline-flex items-center gap-2 text-label-tech text-foreground-muted">
        <input
          type="checkbox"
          checked={open}
          onChange={(e) => {
            if (e.target.checked) {
              const fallback = DEFAULT_BUSINESS_HOURS.weekly.find(
                (d) => d.day === value.day,
              );
              onChange({
                day: value.day,
                open: fallback?.open ?? "09:00",
                close: fallback?.close ?? "18:00",
              });
            } else {
              onChange({ day: value.day, open: null, close: null });
            }
          }}
          className="accent-primary"
        />
        Open
      </label>
      {open && (
        <>
          <TimeInput
            label="Open"
            value={value.open!}
            onChange={(v) => onChange({ ...value, open: v })}
          />
          <TimeInput
            label="Close"
            value={value.close!}
            onChange={(v) => onChange({ ...value, close: v })}
          />
        </>
      )}
      {!open && (
        <span className="text-label-tech text-foreground-muted">Closed</span>
      )}
    </div>
  );
}

function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-label-tech text-foreground-muted">
      {label}
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-container px-2 py-1 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-label-tech text-foreground-muted mb-2 block">
        {label}
      </label>
      <input
        type="number"
        value={value}
        step={step ?? 1}
        min={0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Google Calendar connect / disconnect
// ───────────────────────────────────────────────────────────────────

function GoogleCalendarSection() {
  const status = useQuery(api.googleOauth.getConnectionStatus);
  const getAuthUrl = useAction(api.googleOauth.getAuthUrl);
  const disconnect = useAction(api.googleOauth.disconnect);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [banner, setBanner] = useState<
    { kind: "ok" | "error"; message: string } | null
  >(null);

  // Surface ?googleConnected=1 / ?googleError=... from the callback redirect.
  useEffect(() => {
    if (searchParams.get("googleConnected") === "1") {
      setBanner({ kind: "ok", message: "Google Calendar connected." });
      // Clean the URL so refreshing doesn't replay the toast.
      router.replace("/admin/settings");
    } else {
      const err = searchParams.get("googleError");
      if (err) {
        setBanner({ kind: "error", message: decodeURIComponent(err) });
        router.replace("/admin/settings");
      }
    }
  }, [searchParams, router]);

  async function connect() {
    setConnecting(true);
    try {
      const url = await getAuthUrl({});
      window.location.assign(url);
    } catch (err) {
      setBanner({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not start connect flow",
      });
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Google Calendar? New bookings won't be pushed.")) {
      return;
    }
    setDisconnecting(true);
    try {
      await disconnect();
      setBanner({ kind: "ok", message: "Google Calendar disconnected." });
    } catch (err) {
      setBanner({
        kind: "error",
        message: err instanceof Error ? err.message : "Disconnect failed",
      });
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section className="gloss-card p-6">
      <h2 className="text-headline-md uppercase mb-4">Google Calendar</h2>

      {banner && (
        <div
          className={`flex items-start gap-3 p-3 mb-6 border ${
            banner.kind === "ok"
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          {banner.kind === "ok" ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
          )}
          <span className="text-body-md flex-1">{banner.message}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <p className="text-body-md text-foreground-muted mb-6 max-w-2xl">
        Push every booking, reschedule, and cancellation to the owner's
        Google Calendar so the schedule shows up on your phone, Gmail, and any
        other calendar that syncs from Google. We only push — to block off
        personal time, use the blackout dates above.
      </p>

      {status === undefined ? (
        <p className="text-label-tech text-foreground-muted flex items-center gap-2">
          <Loader2 className="animate-spin" size={14} /> Loading…
        </p>
      ) : status.connected ? (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-body-md">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 size={16} /> Connected
            </div>
            <div className="text-label-tech text-foreground-muted mt-2">
              Calendar:{" "}
              <span className="font-mono-tech text-foreground">
                {status.calendarId}
              </span>
              {status.connectedByEmail && (
                <>
                  {" · "}as{" "}
                  <span className="text-foreground">{status.connectedByEmail}</span>
                </>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="md"
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? (
              <>
                <Loader2 className="animate-spin" size={14} /> Disconnecting…
              </>
            ) : (
              <>
                <Unplug size={14} /> Disconnect
              </>
            )}
          </Button>
        </div>
      ) : (
        <Button variant="primary" size="md" onClick={connect} disabled={connecting}>
          {connecting ? (
            <>
              <Loader2 className="animate-spin" size={14} /> Opening Google…
            </>
          ) : (
            "Connect Google Calendar"
          )}
        </Button>
      )}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────
// Hero / Process JSON editors (legacy)
// ───────────────────────────────────────────────────────────────────

function SiteContentSection() {
  const content = useQuery(api.siteContent.getMany, { keys: [...JSON_KEYS] });
  const setContent = useMutation(api.siteContent.set);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});

  useEffect(() => {
    if (content) {
      const next: Record<string, string> = {};
      for (const k of JSON_KEYS) {
        next[k] = JSON.stringify(content[k] ?? null, null, 2);
      }
      setDrafts(next);
    }
  }, [content]);

  async function save(key: string) {
    setSaving(key);
    try {
      const parsed = JSON.parse(drafts[key]);
      await setContent({ key, value: parsed });
      setSavedAt((s) => ({ ...s, [key]: Date.now() }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section>
      <h2 className="text-headline-md uppercase mb-2">Page content</h2>
      <p className="text-body-md text-foreground-muted mb-6 max-w-2xl">
        Raw JSON for the home page hero and process sections.
      </p>
      <div className="space-y-4">
        {JSON_KEYS.map((key) => (
          <div key={key} className="gloss-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-headline-md uppercase">{key}</h3>
              <div className="flex items-center gap-3">
                {savedAt[key] && Date.now() - savedAt[key] < 3000 && (
                  <span className="text-label-tech text-success flex items-center gap-1">
                    <Check size={12} /> Saved
                  </span>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => save(key)}
                  disabled={saving === key}
                >
                  {saving === key ? (
                    <>
                      <Loader2 className="animate-spin" size={12} /> Saving…
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
            <textarea
              value={drafts[key] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
              rows={Math.min(20, drafts[key]?.split("\n").length ?? 5)}
              className="w-full bg-surface-container-lowest font-mono-tech text-body-md text-foreground border border-border p-4 focus:outline-none focus:border-primary resize-y"
              spellCheck={false}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
