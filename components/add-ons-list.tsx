"use client";

import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { formatPriceFromCents, formatDuration } from "@/lib/format";

// Compact list-style preview of every active add-on. Renders a single
// gloss-card with one row per add-on rather than a card per item — keeps
// the visual weight low so add-ons feel like complementary extras, not
// alternative services.
//
// Returns null when:
//   - the query is still loading (we don't want a flash of empty state)
//   - or the shop hasn't configured any active add-ons (zero clutter)
//
// Used on both the home page (below the Services bento) and the services
// page (below the grid). Both pages already wrap content in <Container>,
// so this component does not — let the caller compose its own padding.
export function AddOnsList({
  eyebrow = "Optional Extras",
  headline = "Boost your detail",
  subhead,
  // Override the section's background (defaults to the page background so the
  // component slots into any layout without breaking alternating-bg rhythm).
  // Pass `bg-surface-container-low` to get the "tinted block" treatment.
  className = "",
}: {
  eyebrow?: string;
  headline?: string;
  subhead?: string;
  className?: string;
}) {
  const addOns = useQuery(api.addOns.list, {});

  if (addOns === undefined) return null;
  if (addOns.length === 0) return null;

  return (
    <section className={`section-y ${className}`}>
      <Container>
        <div className="max-w-2xl mb-12">
          <Eyebrow className="mb-2">{eyebrow}</Eyebrow>
          <h2 className="text-headline-lg uppercase mb-4">{headline}</h2>
          {subhead && (
            <p className="text-body-md text-foreground-muted">{subhead}</p>
          )}
        </div>

        <ul className="gloss-card divide-y divide-border">
          {addOns.map((a) => (
            <li
              key={a._id}
              className="flex flex-wrap items-baseline gap-x-6 gap-y-2 p-5 md:p-6"
            >
              <Plus
                size={16}
                strokeWidth={1.5}
                className="text-primary shrink-0 self-center"
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="text-headline-md text-foreground">{a.name}</div>
                {a.description && (
                  <p className="text-body-md text-foreground-muted mt-1">
                    {a.description}
                  </p>
                )}
              </div>
              <div className="flex items-baseline gap-4 shrink-0 ml-auto">
                <span className="text-label-tech text-foreground-muted whitespace-nowrap">
                  +{formatDuration(a.durationMinutes)}
                </span>
                <span className="text-headline-md text-primary font-mono-tech whitespace-nowrap">
                  +{formatPriceFromCents(a.priceCents)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-label-tech text-foreground-muted mt-6">
          Add any of these during checkout — they extend the appointment by the
          listed time.
        </p>
      </Container>
    </section>
  );
}
