"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  CalendarDays,
  DollarSign,
  Image as ImageIcon,
  Minus,
  PieChart,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Eyebrow } from "@/components/ui/eyebrow";
import { formatDateTime, formatPriceFromCents } from "@/lib/format";
import { RelativeTime } from "@/components/relative-time";

export default function AdminDashboard() {
  const services = useQuery(api.services.list, { includeInactive: true });
  const gallery = useQuery(api.gallery.list, {});
  const bookings = useQuery(api.bookings.listForAdmin, { limit: 50 });
  const stats = useQuery(api.bookings.getDashboardStats, {});

  return (
    <div>
      <Eyebrow className="mb-3">Overview</Eyebrow>
      <h1 className="text-headline-lg uppercase mb-10">Dashboard</h1>

      {/* Operating stats — today + week-over-week. Compact tiles with
          trend arrows that compare against the previous period. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mb-6">
        <RevenueTile
          label="Revenue today"
          icon={DollarSign}
          current={stats?.today.revenueCents}
          previous={stats?.yesterday.revenueCents}
          previousLabel="yesterday"
          accent
        />
        <RevenueTile
          label="Revenue this week"
          icon={TrendingUp}
          current={stats?.thisWeek.revenueCents}
          previous={stats?.lastWeek.revenueCents}
          previousLabel="last week"
        />
        <CountTile
          label="Bookings today"
          icon={CalendarDays}
          current={stats?.today.bookings}
          previous={stats?.yesterday.bookings}
          previousLabel="yesterday"
        />
        <UtilizationTile
          label="Slot utilization"
          icon={PieChart}
          stats={stats?.today}
        />
      </div>

      {/* Catalog / health stats — slower-changing, no comparisons. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-12">
        <CountTile
          label="Active services"
          icon={Sparkles}
          current={services?.filter((s) => s.active).length}
        />
        <CountTile label="Gallery items" icon={ImageIcon} current={gallery?.length} />
        <CountTile
          label="Upcoming bookings"
          icon={CalendarCheck}
          current={
            bookings === undefined
              ? undefined
              : bookings.filter(
                  (b) => b.status === "confirmed" && b.slotStart > Date.now(),
                ).length
          }
        />
        <CountTile
          label="Bookings this week"
          icon={CalendarDays}
          current={stats?.thisWeek.bookings}
          previous={stats?.lastWeek.bookings}
          previousLabel="last week"
        />
      </div>

      <div className="gloss-card">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border">
          <h2 className="text-headline-md uppercase">Recent bookings</h2>
          <Link
            href="/admin/bookings"
            className="text-label-tech text-primary hover:underline flex items-center gap-1"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {bookings === undefined ? (
          <div className="p-6 text-foreground-muted">Loading...</div>
        ) : bookings.length === 0 ? (
          <div className="p-6 text-foreground-muted">No bookings yet.</div>
        ) : (
          <>
            <table className="hidden md:table w-full table-fixed">
              <thead>
                <tr className="text-label-tech text-foreground-muted border-b border-border">
                  <th className="text-left p-4 w-[28%]">Customer</th>
                  <th className="text-left p-4">When</th>
                  <th className="text-left p-4 w-32">Status</th>
                  <th className="text-right p-4 w-24">Deposit</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b._id} className="border-b border-border last:border-0 text-body-md align-top">
                    <td className="p-4">
                      <div className="text-foreground truncate">{b.customerName}</div>
                      <div className="text-label-tech text-foreground-muted truncate">
                        {b.customerEmail}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="text-foreground-muted">{formatDateTime(b.slotStart)}</div>
                      <div className="text-label-tech text-foreground-muted mt-1 truncate">
                        {b.serviceName} · booked <RelativeTime ts={b.createdAt} />
                      </div>
                    </td>
                    <td className="p-4">
                      <StatusChip status={b.status} />
                    </td>
                    <td className="p-4 text-right text-foreground font-mono-tech whitespace-nowrap">
                      {formatPriceFromCents(b.depositAmountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="md:hidden divide-y divide-border">
              {bookings.map((b) => (
                <li key={b._id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-foreground wrap-break-word">{b.customerName}</div>
                      <div className="text-label-tech text-foreground-muted break-all">
                        {b.customerEmail}
                      </div>
                    </div>
                    <StatusChip status={b.status} />
                  </div>
                  <div className="text-body-md text-foreground-muted">{b.serviceName}</div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-label-tech text-foreground-muted">
                    <span>{formatDateTime(b.slotStart)}</span>
                    <span>·</span>
                    <span>
                      Booked <RelativeTime ts={b.createdAt} />
                    </span>
                    <span className="ml-auto text-foreground">
                      {formatPriceFromCents(b.depositAmountCents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Stat tiles
// ───────────────────────────────────────────────────────────────────────────

function RevenueTile({
  label,
  icon,
  current,
  previous,
  previousLabel,
  accent,
}: {
  label: string;
  icon: React.ElementType;
  current: number | undefined;
  previous: number | undefined;
  previousLabel: string;
  accent?: boolean;
}) {
  return (
    <TileShell label={label} icon={icon} accent={accent}>
      <p className={`text-display ${accent ? "text-primary" : "text-foreground"}`}>
        {current === undefined ? "—" : formatPriceFromCents(current)}
      </p>
      <TrendLine
        current={current}
        previous={previous}
        previousLabel={previousLabel}
        format={(n) => formatPriceFromCents(Math.abs(n))}
      />
    </TileShell>
  );
}

function CountTile({
  label,
  icon,
  current,
  previous,
  previousLabel,
}: {
  label: string;
  icon: React.ElementType;
  current: number | undefined;
  previous?: number;
  previousLabel?: string;
}) {
  return (
    <TileShell label={label} icon={icon}>
      <p className="text-display text-foreground">{current ?? "—"}</p>
      {previous !== undefined && previousLabel ? (
        <TrendLine
          current={current}
          previous={previous}
          previousLabel={previousLabel}
          format={(n) => String(Math.abs(n))}
        />
      ) : null}
    </TileShell>
  );
}

function UtilizationTile({
  label,
  icon,
  stats,
}: {
  label: string;
  icon: React.ElementType;
  stats:
    | {
        utilizationPercent: number;
        bookedMinutes: number;
        availableMinutes: number;
        totalMinutes: number;
        isOpen: boolean;
      }
    | undefined;
}) {
  return (
    <TileShell label={label} icon={icon}>
      {stats === undefined ? (
        <p className="text-display text-foreground">—</p>
      ) : !stats.isOpen ? (
        <>
          <p className="text-display text-foreground-muted">CLOSED</p>
          <p className="text-label-tech text-foreground-muted mt-2">No hours today</p>
        </>
      ) : (
        <>
          <p className="text-display text-foreground">
            {stats.utilizationPercent}
            <span className="text-headline-md text-foreground-muted">%</span>
          </p>
          {/* Bar so the percent has visual weight. */}
          <div className="h-1 bg-surface-container-low mt-3 mb-2 overflow-hidden">
            <div
              className="h-full bg-primary glow-blue-soft transition-all duration-500"
              style={{ width: `${stats.utilizationPercent}%` }}
            />
          </div>
          <p className="text-label-tech text-foreground-muted">
            {formatMinutes(stats.bookedMinutes)} booked ·{" "}
            {formatMinutes(stats.availableMinutes)} free
          </p>
        </>
      )}
    </TileShell>
  );
}

function TileShell({
  label,
  icon: Icon,
  children,
  accent,
}: {
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`gloss-card p-6 ${accent ? "border-primary/40" : ""}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-label-tech text-foreground-muted">{label}</span>
        <Icon size={16} className={accent ? "text-primary" : "text-foreground-muted"} />
      </div>
      {children}
    </div>
  );
}

// Up / down arrow + delta line under each stat tile. Handles the
// edge cases:
//   - current and previous both zero → neutral, "no change"
//   - previous zero (new!) → up arrow, "new"
//   - undefined (still loading) → render nothing
function TrendLine({
  current,
  previous,
  previousLabel,
  format,
}: {
  current: number | undefined;
  previous: number | undefined;
  previousLabel: string;
  format: (n: number) => string;
}) {
  if (current === undefined || previous === undefined) {
    return <p className="text-label-tech text-foreground-muted mt-2">vs {previousLabel}</p>;
  }
  const diff = current - previous;

  let tone: "up" | "down" | "flat";
  let label: string;
  if (diff === 0) {
    tone = "flat";
    label = "no change";
  } else if (previous === 0) {
    tone = "up";
    label = "new";
  } else {
    tone = diff > 0 ? "up" : "down";
    const pct = Math.round((diff / previous) * 100);
    label = `${format(diff)} (${Math.abs(pct)}%)`;
  }

  const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : Minus;
  const color =
    tone === "up"
      ? "text-success"
      : tone === "down"
        ? "text-error"
        : "text-foreground-muted";

  return (
    <p className={`text-label-tech mt-2 flex items-center gap-1 ${color}`}>
      <Icon size={12} strokeWidth={2} />
      <span>{label}</span>
      <span className="text-foreground-muted">vs {previousLabel}</span>
    </p>
  );
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function StatusChip({ status }: { status: string }) {
  const tone =
    status === "confirmed" || status === "paid"
      ? "bg-success/15 text-success border-success/30"
      : status === "cancelled" || status === "failed"
        ? "bg-error/15 text-error border-error/30"
        : status === "completed" || status === "refunded"
          ? "bg-foreground-muted/10 text-foreground-muted border-border"
          : "bg-primary/15 text-primary border-primary/30";
  return (
    <span className={`text-label-tech px-2 py-1 border ${tone}`}>{status.toUpperCase()}</span>
  );
}
