"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Horizontal strip of calendar-card buttons, one per day, showing up to
// the next 7 days. Used everywhere a YYYY-MM-DD date is picked — the
// public booking flow, the admin reschedule modal, and the admin
// settings blackouts list.
//
//   [<]   [MAY/21/Thu] [MAY/22/Fri] [MAY/23/Sat] ...   [>]
//
// Each card is a button that selects that day. The currently selected day
// gets a primary-strong border + glow. The visible count adjusts to the
// container width via ResizeObserver (1 day on a tiny phone, up to 7 on
// desktop). Arrows shift the date by one day, and the visible window
// auto-scrolls so the selected day stays inside the strip.

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

// Width of one day card including the gap to the next. Used by the
// ResizeObserver below to decide how many fit. Tweak together with
// `gap-2` (8px) in the strip className.
const CARD_WIDTH_PX = 64;
const CARD_GAP_PX = 8;
const MAX_VISIBLE_DAYS = 7;

function shiftDateISO(iso: string, days: number): string {
  // Parse as local midnight so day arithmetic doesn't cross a TZ boundary.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function compareDateISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function DateScroller({
  date,
  minDate,
  maxDate,
  onChange,
  ariaLabel,
  className = "",
}: {
  date: string;
  minDate?: string;
  maxDate?: string;
  onChange: (iso: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(MAX_VISIBLE_DAYS);
  // The first day shown in the strip. Auto-follows `date` so the selected
  // day always stays visible (see effect below).
  const [windowStart, setWindowStart] = useState(date);

  // Recompute the visible count whenever the strip resizes. Clamps to
  // [1, MAX_VISIBLE_DAYS] so we never render more days than the prop
  // allows or shrink below a single card.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      const fit = Math.floor((w + CARD_GAP_PX) / (CARD_WIDTH_PX + CARD_GAP_PX));
      setVisibleCount(Math.max(1, Math.min(MAX_VISIBLE_DAYS, fit)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the selected date inside the visible window. If the parent (or
  // an arrow click) moves `date` outside the strip, slide the window so
  // `date` is the leftmost cell on a forward jump, or the rightmost on
  // a backward jump.
  useEffect(() => {
    const windowEnd = shiftDateISO(windowStart, visibleCount - 1);
    if (compareDateISO(date, windowStart) < 0) {
      setWindowStart(date);
    } else if (compareDateISO(date, windowEnd) > 0) {
      setWindowStart(shiftDateISO(date, -(visibleCount - 1)));
    }
  }, [date, windowStart, visibleCount]);

  const today = useMemo(() => todayISO(), []);
  const canGoBack = !minDate || compareDateISO(date, minDate) > 0;
  const canGoForward = !maxDate || compareDateISO(date, maxDate) < 0;

  function shiftSelection(days: number) {
    const next = shiftDateISO(date, days);
    if (minDate && compareDateISO(next, minDate) < 0) return;
    if (maxDate && compareDateISO(next, maxDate) > 0) return;
    onChange(next);
  }

  const days = useMemo(
    () =>
      Array.from({ length: visibleCount }, (_, i) =>
        shiftDateISO(windowStart, i),
      ),
    [windowStart, visibleCount],
  );

  return (
    <div
      className={`flex items-stretch gap-2 w-full ${className}`}
      role="group"
      aria-label={ariaLabel ?? "Pick a date"}
    >
      <button
        type="button"
        onClick={() => shiftSelection(-1)}
        disabled={!canGoBack}
        aria-label="Previous day"
        className="shrink-0 w-10 flex items-center justify-center border border-border text-foreground-muted hover:text-foreground hover:border-chrome transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronLeft size={18} />
      </button>

      <div
        ref={stripRef}
        className="flex-1 flex items-stretch gap-2 overflow-hidden min-w-0"
      >
        {days.map((d) => {
          const [y, mo, dn] = d.split("-").map(Number);
          const monthLabel = MONTHS[(mo ?? 1) - 1] ?? "";
          const weekdayLabel = new Date(y, mo - 1, dn).toLocaleDateString("en-CA", {
            weekday: "short",
          });
          const selected = d === date;
          const isToday = d === today;
          const disabled =
            (minDate && compareDateISO(d, minDate) < 0) ||
            (maxDate && compareDateISO(d, maxDate) > 0);
          return (
            <button
              key={d}
              type="button"
              disabled={!!disabled}
              onClick={() => onChange(d)}
              aria-label={new Date(y, mo - 1, dn).toLocaleDateString("en-CA", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              aria-pressed={selected}
              className={`
                relative flex-1 min-w-0 flex flex-col items-stretch overflow-hidden border
                animate-slide-up transition duration-200
                ${
                  selected
                    ? "border-primary-strong glow-blue-soft"
                    : "border-border hover:border-chrome"
                }
                ${disabled ? "opacity-30 cursor-not-allowed" : ""}
              `}
            >
              {/* Binder-ring notches at the very top of the card — the
                  visual cue that gives each card the "tear-off calendar"
                  look. Two short vertical bars sit inside the card so
                  the strip's overflow-hidden doesn't clip them. */}
              <span
                aria-hidden
                className="absolute top-0 left-0 right-0 flex justify-center gap-3 pointer-events-none z-10"
              >
                <span
                  className={`block h-1.5 w-1 ${
                    selected ? "bg-on-primary" : "bg-foreground-muted"
                  }`}
                />
                <span
                  className={`block h-1.5 w-1 ${
                    selected ? "bg-on-primary" : "bg-foreground-muted"
                  }`}
                />
              </span>
              {/* Month bar — uses asymmetric padding (more on top) so the
                  binder rings above don't crash into the "MAY" text. */}
              <span
                className={`text-[9px] font-bold tracking-widest text-center leading-tight pt-2 pb-1 transition-colors duration-200 ${
                  selected
                    ? "bg-primary-strong text-on-primary"
                    : "bg-surface-container-low text-foreground-muted"
                }`}
              >
                {monthLabel}
              </span>
              <span
                className={`text-lg font-bold text-center leading-tight py-1 bg-surface transition-colors duration-200 ${
                  selected ? "text-primary" : "text-foreground"
                }`}
              >
                {String(dn).padStart(2, "0")}
              </span>
              <span
                className={`text-[9px] text-center pb-1 leading-none bg-surface transition-colors duration-200 ${
                  isToday && !selected
                    ? "text-primary font-bold"
                    : "text-foreground-muted"
                }`}
              >
                {isToday ? "TODAY" : weekdayLabel.toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => shiftSelection(1)}
        disabled={!canGoForward}
        aria-label="Next day"
        className="shrink-0 w-10 flex items-center justify-center border border-border text-foreground-muted hover:text-foreground hover:border-chrome transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
