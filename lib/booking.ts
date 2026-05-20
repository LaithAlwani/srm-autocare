// Booking-related primitives shared by the public site, the admin pages,
// and Convex actions. Pure functions — no I/O, no React, no `process.env`.

// Fraction of the total (service price + add-ons) we ask for up front. Kept
// as a single constant so the admin UI, the public service cards, and the
// Square charge action all agree on the number.
export const DEPOSIT_FRACTION = 0.33;

// 33% of the supplied total, rounded UP to the nearest whole dollar so the
// deposit never has trailing cents (a $52.50 deposit becomes $53). Cents in,
// cents out — currency math never touches floats beyond the % multiply.
export function computeDepositCents(totalCents: number): number {
  const raw = totalCents * DEPOSIT_FRACTION;
  return Math.ceil(raw / 100) * 100;
}

// Turn a human service name into a URL-safe slug. Lowercases, collapses any
// run of non-alphanumeric characters into a single dash, trims dashes from
// the ends. The admin form auto-generates this from the Name field so the
// owner doesn't have to think about URLs.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
