"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/format";

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
    <time dateTime={new Date(ts).toISOString()} title={title ?? new Date(ts).toLocaleString()}>
      {now === null ? "" : formatRelativeTime(ts, now)}
    </time>
  );
}
