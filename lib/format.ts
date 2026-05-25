export function formatPriceFromCents(cents: number, currency: "CAD" = "CAD"): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDateTime(ts: number): string {
  // en-US locale forces 12-hour AM/PM output. en-CA defaults to 24-hour
  // which the shop owner explicitly didn't want. Date parts (weekday /
  // month / day) render identically in both locales for our options.
  return new Date(ts).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Human-friendly "when did X happen" formatter.
//   < 1 min:                 "just now"
//   < 60 min:                "5 min ago"
//   < 6 hours:               "2 hours ago"
//   same calendar day:       "today at 2:30 p.m."
//   yesterday:               "yesterday at 9:15 a.m."
//   within last 7 days:      "Mon at 11:00 a.m."
//   > 7 days, same year:     "May 3 at 11:00 a.m."
//   different year:          "May 3, 2025 at 11:00 a.m."
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diffMs = now - ts;
  if (diffMs < 0) return formatDateTime(ts); // future timestamp — fall back to absolute

  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 6) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;

  const then = new Date(ts);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThen) / 86_400_000);
  const time = then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (dayDiff === 0) return `today at ${time}`;
  if (dayDiff === 1) return `yesterday at ${time}`;
  if (dayDiff < 7) {
    const weekday = then.toLocaleDateString("en-CA", { weekday: "short" });
    return `${weekday} at ${time}`;
  }

  const sameYear = then.getFullYear() === today.getFullYear();
  const date = then.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date} at ${time}`;
}
