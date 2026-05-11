"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import { ArrowRight, Clock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Container } from "@/components/ui/container";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { resolveIcon } from "@/lib/icons";
import { formatPriceFromCents, formatDuration } from "@/lib/format";

export default function ServicesPage() {
  const services = useQuery(api.services.list, {});

  return (
    <div>
      {/* HEADER */}
      <section className="section-y border-b border-border">
        <Container>
          <Eyebrow className="mb-4">Service Catalog</Eyebrow>
          <h1 className="text-display uppercase tracking-tighter mb-6 max-w-3xl">
            Engineered detailing programs
          </h1>
          <p className="text-body-lg text-foreground-muted max-w-2xl">
            Every package is tailored to the condition and history of your vehicle. Pricing starts
            from the figures shown below; final quotes are confirmed after on-site inspection.
          </p>
        </Container>
      </section>

      {/* GRID */}
      <section className="section-y">
        <Container>
          {services === undefined ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-105 gloss-card animate-pulse" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <div className="text-center py-16 text-foreground-muted">
              <p>No services published yet. Add some in the admin panel.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {services.map((s, idx) => {
                const Icon = resolveIcon(s.icon);
                return (
                  <motion.article
                    key={s._id}
                    className="gloss-card relative overflow-hidden flex flex-col"
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.06, 0.3) }}
                    viewport={{ once: true, margin: "-100px" }}
                  >
                    {s.imageUrl && (
                      <div className="absolute inset-0 opacity-15 group-hover:opacity-25 transition-opacity">
                        <Image
                          src={s.imageUrl}
                          alt={s.name}
                          fill
                          className="object-cover"
                          sizes="(max-width: 768px) 100vw, 50vw"
                        />
                      </div>
                    )}
                    <div className="relative z-10 p-10 flex flex-col gap-6 flex-1">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <Icon className="text-primary" size={28} strokeWidth={1.5} />
                          {s.badge && (
                            <span className="text-label-tech text-foreground-muted">
                              {s.badge}
                            </span>
                          )}
                        </div>
                        <span className="text-label-tech text-foreground-muted flex items-center gap-1">
                          <Clock size={12} />
                          {formatDuration(s.durationMinutes)}
                        </span>
                      </div>

                      <div>
                        <h3 className="text-headline-lg uppercase mb-3">{s.name}</h3>
                        <p className="text-body-md text-foreground-muted mb-6">{s.description}</p>
                      </div>

                      <div className="mt-auto flex items-center justify-between border-t border-border pt-6">
                        <div>
                          <span className="text-label-tech text-foreground-muted block mb-1">
                            From
                          </span>
                          <span className="text-headline-lg text-primary font-display font-bold">
                            {formatPriceFromCents(s.priceFromCents)}
                          </span>
                        </div>
                        <ButtonLink
                          href={`/book?service=${s._id}`}
                          variant="primary"
                          size="md"
                          className="group"
                        >
                          Book
                          <ArrowRight
                            size={14}
                            className="group-hover:translate-x-0.5 transition-transform"
                          />
                        </ButtonLink>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          )}
        </Container>
      </section>
    </div>
  );
}
