"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowRight, CalendarCheck, Image as ImageIcon, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Eyebrow } from "@/components/ui/eyebrow";
import { formatDateTime, formatPriceFromCents } from "@/lib/format";
import { RelativeTime } from "@/components/relative-time";

export default function AdminDashboard() {
  const services = useQuery(api.services.list, { includeInactive: true });
  const gallery = useQuery(api.gallery.list, {});
  const bookings = useQuery(api.bookings.listForAdmin, { limit: 5 });

  const pendingBookings = (bookings ?? []).filter((b) => b.status === "pending").length;
  const upcoming = (bookings ?? []).filter(
    (b) => b.status === "confirmed" && b.slotStart > Date.now(),
  ).length;

  return (
    <div>
      <Eyebrow className="mb-3">Overview</Eyebrow>
      <h1 className="text-headline-lg uppercase mb-10">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-12">
        <Stat label="Active services" value={services?.filter((s) => s.active).length ?? "—"} icon={Sparkles} />
        <Stat label="Gallery items" value={gallery?.length ?? "—"} icon={ImageIcon} />
        <Stat label="Pending bookings" value={pendingBookings} icon={CalendarCheck} accent />
        <Stat label="Upcoming confirmed" value={upcoming} icon={CalendarCheck} />
      </div>

      <div className="gloss-card">
        <div className="flex items-center justify-between p-6 border-b border-border">
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
          <table className="w-full">
            <thead>
              <tr className="text-label-tech text-foreground-muted border-b border-border">
                <th className="text-left p-4">Customer</th>
                <th className="text-left p-4">Service</th>
                <th className="text-left p-4">When</th>
                <th className="text-left p-4">Booked</th>
                <th className="text-left p-4">Status</th>
                <th className="text-right p-4">Deposit</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b._id} className="border-b border-border last:border-0 text-body-md">
                  <td className="p-4">
                    <div className="text-foreground">{b.customerName}</div>
                    <div className="text-label-tech text-foreground-muted">{b.customerEmail}</div>
                  </td>
                  <td className="p-4 text-foreground-muted">{b.serviceName}</td>
                  <td className="p-4 text-foreground-muted">{formatDateTime(b.slotStart)}</td>
                  <td className="p-4 text-foreground-muted">
                    <RelativeTime ts={b.createdAt} />
                  </td>
                  <td className="p-4">
                    <StatusChip status={b.status} />
                  </td>
                  <td className="p-4 text-right text-foreground">
                    {formatPriceFromCents(b.depositAmountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    status === "confirmed"
      ? "bg-success/15 text-success border-success/30"
      : status === "cancelled"
        ? "bg-error/15 text-error border-error/30"
        : status === "completed"
          ? "bg-foreground-muted/10 text-foreground-muted border-border"
          : "bg-primary/15 text-primary border-primary/30";
  return (
    <span className={`text-label-tech px-2 py-1 border ${tone}`}>{status.toUpperCase()}</span>
  );
}
