"use client";

import { useEffect, useState } from "react";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

// Re-renders once a minute so labels like "3 min ago" tick forward without a refresh.
// Falls back to a server-safe absolute label until hydration to avoid mismatch.
export function RelativeTime({ ts, title }: { ts: number; title?: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    // Tooltip uses the same en-US 12-hour format as the rest of the site
    // so hovering "3 min ago" reveals "Tue, May 21, 2:30 PM" not "14:30".
    <time dateTime={new Date(ts).toISOString()} title={title ?? formatDateTime(ts)}>
      {now === null ? "" : formatRelativeTime(ts, now)}
    </time>
  );
}
