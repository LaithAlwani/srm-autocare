"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Eyebrow } from "@/components/ui/eyebrow";
import { formatDateTime, formatPriceFromCents } from "@/lib/format";
import { RelativeTime } from "@/components/relative-time";
import { StatusChip } from "../page";

const FILTERS = ["all", "pending", "confirmed", "cancelled", "completed"] as const;
type Filter = (typeof FILTERS)[number];

export default function AdminBookingsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const bookings = useQuery(
    api.bookings.listForAdmin,
    filter === "all" ? { limit: 100 } : { status: filter, limit: 100 },
  );
  const updateStatus = useMutation(api.bookings.updateStatus);

  async function changeStatus(id: Id<"bookings">, next: Exclude<Filter, "all">) {
    await updateStatus({ id, status: next });
  }

  return (
    <div>
      <Eyebrow className="mb-3">Operations</Eyebrow>
      <h1 className="text-headline-lg uppercase mb-8">Bookings</h1>

      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-label-tech px-4 py-2 border transition-colors ${
              filter === f
                ? "bg-primary text-on-primary border-primary"
                : "border-border text-foreground-muted hover:text-foreground hover:border-chrome"
            }`}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {bookings === undefined ? (
        <p className="text-foreground-muted">Loading...</p>
      ) : bookings.length === 0 ? (
        <div className="gloss-card p-12 text-center text-foreground-muted">
          No bookings match this filter.
        </div>
      ) : (
        <div className="gloss-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-label-tech text-foreground-muted border-b border-border">
                <th className="text-left p-4">Customer</th>
                <th className="text-left p-4">Service</th>
                <th className="text-left p-4">When</th>
                <th className="text-left p-4">Booked</th>
                <th className="text-left p-4">Vehicle</th>
                <th className="text-left p-4">Payment</th>
                <th className="text-right p-4">Deposit</th>
                <th className="text-left p-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b._id} className="border-b border-border last:border-0 text-body-md align-top">
                  <td className="p-4">
                    <div className="text-foreground">{b.customerName}</div>
                    <div className="text-label-tech text-foreground-muted">{b.customerEmail}</div>
                    <div className="text-label-tech text-foreground-muted">{b.customerPhone}</div>
                  </td>
                  <td className="p-4 text-foreground-muted">{b.serviceName}</td>
                  <td className="p-4 text-foreground-muted">{formatDateTime(b.slotStart)}</td>
                  <td className="p-4 text-foreground-muted">
                    <RelativeTime ts={b.createdAt} />
                  </td>
                  <td className="p-4 text-foreground-muted max-w-[200px]">
                    {b.vehicleInfo}
                    {b.notes && (
                      <p className="text-label-tech mt-2 italic">"{b.notes}"</p>
                    )}
                  </td>
                  <td className="p-4 text-foreground-muted">
                    <StatusChip status={b.paymentStatus} />
                  </td>
                  <td className="p-4 text-right text-foreground">
                    {formatPriceFromCents(b.depositAmountCents)}
                  </td>
                  <td className="p-4">
                    <select
                      value={b.status}
                      onChange={(e) =>
                        changeStatus(b._id, e.target.value as Exclude<Filter, "all">)
                      }
                      className="bg-surface-container text-body-md text-foreground border border-border px-2 py-1 focus:outline-none focus:border-primary"
                    >
                      <option value="pending">PENDING</option>
                      <option value="confirmed">CONFIRMED</option>
                      <option value="cancelled">CANCELLED</option>
                      <option value="completed">COMPLETED</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
