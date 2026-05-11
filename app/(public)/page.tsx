"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Container } from "@/components/ui/container";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { resolveIcon } from "@/lib/icons";
import { siteConfig } from "@/config/site";

type SiteHero = {
  eyebrow?: string;
  headline?: string;
  subhead?: string;
};

const DEFAULT_HERO: SiteHero = {
  eyebrow: "Precision Engineering",
  headline: "PRECISION IN EVERY DETAIL",
  subhead:
    "Elevating automotive care to an exact science. Our bespoke detailing services deliver a mirror-like finish that defines true luxury.",
};

const DEFAULT_PROCESS_STEPS = [
  { number: "01", title: "Decontamination", body: "Multi-stage citrus wash and iron removal to strip surface impurities." },
  { number: "02", title: "Inspection", body: "Microscopic analysis under 5000K high-intensity lighting arrays." },
  { number: "03", title: "Correction", body: "Surgical paint leveling using precision rotary and dual-action tools." },
  { number: "04", title: "Preservation", body: "Curing ceramic or graphene coatings for permanent luster." },
];

export default function HomePage() {
  const services = useQuery(api.services.list, {});
  const reviews = useQuery(api.reviews.listFeatured, { limit: 3 });
  const heroContent = useQuery(api.siteContent.get, { key: "hero" }) as SiteHero | null | undefined;
  const processContent = useQuery(api.siteContent.get, { key: "process" }) as
    | { eyebrow?: string; headline?: string; steps?: typeof DEFAULT_PROCESS_STEPS }
    | null
    | undefined;

  const hero = { ...DEFAULT_HERO, ...(heroContent ?? {}) };
  const processSteps = processContent?.steps ?? DEFAULT_PROCESS_STEPS;
  const processEyebrow = processContent?.eyebrow ?? "Our Methodology";
  const processHeadline = processContent?.headline ?? "THE SRM PROTOCOL";

  // Featured services: large card for top 1, smaller for next 3.
  const previewServices = (services ?? []).slice(0, 4);

  return (
    <div>
      {/* HERO */}
      <section className="relative h-[88vh] min-h-[600px] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-surface-container-low" />
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-surface/40" />
        <Container className="relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Eyebrow className="tracking-[0.3em] mb-4">{hero.eyebrow}</Eyebrow>
          </motion.div>
          <motion.h1
            className="text-display text-foreground mb-8 tracking-tighter uppercase max-w-4xl mx-auto"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
          >
            {hero.headline}
          </motion.h1>
          <motion.p
            className="text-body-lg text-foreground-muted max-w-2xl mx-auto mb-12"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            {hero.subhead}
          </motion.p>
          <motion.div
            className="flex flex-col md:flex-row gap-4 justify-center"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
          >
            <ButtonLink href="/book" variant="primary" size="lg">
              Book Your Session
            </ButtonLink>
            <ButtonLink href="/gallery" variant="secondary" size="lg">
              View Gallery
            </ButtonLink>
          </motion.div>
        </Container>
        <motion.div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 text-primary"
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <ChevronDown size={28} />
        </motion.div>
      </section>

      {/* SERVICES PREVIEW (Bento) */}
      <section id="services" className="section-y">
        <Container>
          <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-4">
            <div className="max-w-xl">
              <Eyebrow className="mb-2">Our Expertise</Eyebrow>
              <h2 className="text-headline-lg text-foreground uppercase">Engineered Protection</h2>
            </div>
            <p className="text-body-md text-foreground-muted max-w-sm">
              From daily drivers to showroom collectibles, we apply surgical precision to every surface.
            </p>
          </div>

          {previewServices.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
              {[8, 4, 4, 8].map((span, i) => (
                <div
                  key={i}
                  className={`md:col-span-${span} h-[360px] gloss-card animate-pulse`}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
              {previewServices.map((s, idx) => {
                const Icon = resolveIcon(s.icon);
                const span = idx === 0 || idx === 3 ? "md:col-span-8" : "md:col-span-4";
                return (
                  <Link
                    key={s._id}
                    href="/services"
                    className={`${span} gloss-card group relative overflow-hidden h-[360px] block`}
                  >
                    {s.imageUrl && (
                      <div className="absolute inset-0 opacity-25 group-hover:opacity-45 transition-opacity">
                        <Image
                          src={s.imageUrl}
                          alt={s.name}
                          fill
                          className="object-cover"
                          sizes="(max-width: 768px) 100vw, 66vw"
                        />
                      </div>
                    )}
                    <div className="relative z-10 h-full flex flex-col justify-between p-8">
                      <div className="flex justify-between items-start">
                        <Icon size={36} className="text-primary" strokeWidth={1.5} />
                        {s.badge && (
                          <span className="text-label-tech text-foreground-muted">{s.badge}</span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-headline-md uppercase mb-2">{s.name}</h3>
                        <p className="text-body-md text-foreground-muted max-w-md line-clamp-3">
                          {s.description}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Container>
      </section>

      {/* PROCESS */}
      <section id="process" className="section-y bg-surface-container-low">
        <Container>
          <div className="text-center mb-16">
            <Eyebrow className="mb-2">{processEyebrow}</Eyebrow>
            <h2 className="text-headline-lg uppercase mb-6">{processHeadline}</h2>
            <div className="w-20 h-0.5 bg-primary mx-auto" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 relative">
            <div className="hidden md:block absolute top-[44px] left-0 w-full h-px bg-border z-0" />
            {processSteps.map((step, i) => (
              <motion.div
                key={step.number}
                className="relative z-10 text-center p-6"
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                viewport={{ once: true, margin: "-50px" }}
              >
                <div
                  className={`w-12 h-12 mx-auto mb-6 flex items-center justify-center text-label-tech border ${
                    i === processSteps.length - 1
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface text-primary border-primary"
                  }`}
                >
                  {step.number}
                </div>
                <h4 className="text-headline-md uppercase mb-4">{step.title}</h4>
                <p className="text-body-md text-foreground-muted">{step.body}</p>
              </motion.div>
            ))}
          </div>
        </Container>
      </section>

      {/* REVIEWS */}
      {reviews && reviews.length > 0 && (
        <section className="section-y">
          <Container>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-start">
              <div>
                <Eyebrow className="mb-4">Client Feedback</Eyebrow>
                <h2 className="text-headline-lg uppercase leading-tight mb-8">
                  Trusted by enthusiasts &amp; collectors
                </h2>
                <div className="space-y-6">
                  {reviews.map((r) => (
                    <div key={r._id} className="gloss-card p-8">
                      <p className="text-body-lg text-foreground italic mb-6">“{r.body}”</p>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary-container/20 text-primary flex items-center justify-center text-label-tech">
                          {r.author
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="text-headline-md text-foreground text-base">{r.author}</p>
                          {r.vehicleInfo && (
                            <p className="text-label-tech text-foreground-muted">
                              {r.vehicleInfo}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative h-[600px] gloss-card overflow-hidden hidden md:block">
                <div className="absolute inset-0 bg-gradient-to-r from-surface to-transparent z-10" />
                <div className="absolute inset-0 bg-surface-container-high" />
              </div>
            </div>
          </Container>
        </section>
      )}

      {/* CTA */}
      <section className="bg-primary text-on-primary section-y" id="booking">
        <Container className="text-center max-w-4xl">
          <h2 className="text-display uppercase mb-8 tracking-tighter">Restore the gloss</h2>
          <p className="text-body-lg text-on-primary/80 mb-12 uppercase tracking-widest font-bold">
            Limited monthly slots available for bespoke detailing.
          </p>
          <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
            <ButtonLink href="/book" variant="secondary" size="lg" className="bg-on-primary text-primary border-on-primary hover:bg-on-primary/90">
              Book Your Session
            </ButtonLink>
            <a
              href={siteConfig.contact.phoneHref}
              className="text-label-tech text-on-primary hover:underline"
            >
              or call {siteConfig.contact.phone}
            </a>
          </div>
        </Container>
      </section>
    </div>
  );
}

