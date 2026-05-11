"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowRight, CalendarCheck, CalendarDays, Image as ImageIcon, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Eyebrow } from "@/components/ui/eyebrow";
import { formatDateTime, formatPriceFromCents } from "@/lib/format";
import { RelativeTime } from "@/components/relative-time";

export default function AdminDashboard() {
  const services = useQuery(api.services.list, { includeInactive: true });
  const gallery = useQuery(api.gallery.list, {});
  const bookings = useQuery(api.bookings.listForAdmin, { limit: 50 });

  const now = Date.now();
  const startOfTomorrow = new Date(now);
  startOfTomorrow.setHours(0, 0, 0, 0);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const todayBookings = (bookings ?? []).filter(
    (b) =>
      b.status === "confirmed" &&
      b.slotStart >= now &&
      b.slotStart < startOfTomorrow.getTime(),
  ).length;
  const upcoming = (bookings ?? []).filter(
    (b) => b.status === "confirmed" && b.slotStart > Date.now(),
  ).length;

  return (
    <div>
      <Eyebrow className="mb-3">Overview</Eyebrow>
      <h1 className="text-headline-lg uppercase mb-10">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-12">
        <Stat label="Active services" value={services?.filter((s) => s.active).length ?? "—"} icon={Sparkles} />
        <Stat label="Gallery items" value={gallery?.length ?? "—"} icon={ImageIcon} />
        <Stat label="Today" value={todayBookings} icon={CalendarDays} accent />
        <Stat label="Upcoming" value={upcoming} icon={CalendarCheck} />
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
            {/* Desktop: condensed table — Customer / When+Service / Status / Deposit.
                Booked-time + service moved into the When cell so the dashboard
                preview stays scannable in narrow content widths beside the sidebar. */}
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

            {/* Mobile: compact cards */}
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

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent?: boolean;
}) {
  return (
    <div className={`gloss-card p-6 ${accent ? "border-primary/40" : ""}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-label-tech text-foreground-muted">{label}</span>
        <Icon size={16} className={accent ? "text-primary" : "text-foreground-muted"} />
      </div>
      <p className={`text-display ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
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
