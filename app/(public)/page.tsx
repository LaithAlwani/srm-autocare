"use client";

import Link from "next/link";
import Image from "next/image";
import { useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Container } from "@/components/ui/container";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { resolveIcon } from "@/lib/icons";
import { ServiceDescription } from "@/components/ui/service-description";
import { siteConfig } from "@/config/site";
import { heroMedia } from "@/config/media";
import { HeroMedia } from "@/components/hero-media";
import { AddOnsList } from "@/components/add-ons-list";

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
      {/*
        Resource hint: tell the browser to start fetching the hero video at
        the highest priority before it discovers the <video> tag inside
        <HeroMedia>. Cuts LCP because the video file download begins during
        HTML parse instead of after React hydration. React 19 hoists `<link>`
        elements rendered inside components into <head> automatically.
      */}
      <link
        rel="preload"
        as="video"
        href={heroMedia.homeHeroVideo}
        type="video/mp4"
        fetchPriority="high"
      />

      {/* HERO */}
      <section className="relative h-[88vh] min-h-[600px] flex items-center justify-center overflow-hidden">
        <HeroMedia
          kind="video"
          src={heroMedia.homeHeroVideo}
          alt="Detailing footage of a luxury vehicle being polished and ceramic-coated in the SRM Auto Care studio"
          dim={45}
          priority
        />
        {/*
          Hero entrance is now pure CSS (`animate-slide-up` keyframes from
          globals.css) with staggered `animation-delay` per element. Saves
          ~120 KB of framer-motion JS off the LCP path. The `both` fill mode
          on the keyframe keeps elements invisible until their delay elapses.
        */}
        <Container className="relative z-10 text-center">
          <div className="animate-slide-up" style={{ animationDelay: "0ms" }}>
            <Eyebrow className="tracking-[0.3em] mb-4">{hero.eyebrow}</Eyebrow>
          </div>
          <h1
            className="animate-slide-up text-display text-foreground mb-8 tracking-tighter uppercase max-w-4xl mx-auto"
            style={{ animationDelay: "100ms" }}
          >
            {hero.headline}
          </h1>
          <p
            className="animate-slide-up text-body-lg text-foreground-muted max-w-2xl mx-auto mb-12"
            style={{ animationDelay: "200ms" }}
          >
            {hero.subhead}
          </p>
          <div
            className="animate-slide-up flex flex-col md:flex-row gap-4 justify-center"
            style={{ animationDelay: "300ms" }}
          >
            <ButtonLink href="/book" variant="primary" size="lg">
              Book Your Session
            </ButtonLink>
            <ButtonLink href="/gallery" variant="secondary" size="lg">
              View Gallery
            </ButtonLink>
          </div>
        </Container>
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-primary animate-bounce">
          <ChevronDown size={28} />
        </div>
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
                    className={`${span} gloss-card group relative overflow-hidden min-h-[360px] block`}
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
                    <div className="relative z-10 h-full flex flex-col gap-6 p-8">
                      <div className="flex justify-between items-start">
                        <Icon size={36} className="text-primary" strokeWidth={1.5} />
                        {s.badge && (
                          <span className="text-label-tech text-foreground-muted">{s.badge}</span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-headline-md uppercase mb-3">{s.name}</h3>
                        <ServiceDescription text={s.description} className="max-w-md" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Container>
      </section>

      {/* ADD-ONS — auto-hides itself when the shop hasn't configured any. */}
      <AddOnsList
        subhead="Optional extras you can stack onto any service during booking. Each one extends the appointment by the listed duration."
      />

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
              <div
                key={step.number}
                className="relative z-10 text-center p-6 animate-slide-up"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div
                  className={`w-12 h-12 mx-auto mb-6 flex items-center justify-center text-label-tech border ${
                    i === processSteps.length - 1
                      ? "bg-primary-strong text-on-primary border-primary-strong"
                      : "bg-surface text-primary border-primary"
                  }`}
                >
                  {step.number}
                </div>
                <h3 className="text-headline-md uppercase mb-4">{step.title}</h3>
                <p className="text-body-md text-foreground-muted">{step.body}</p>
              </div>
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
                {/* TODO: swap to a hero showcase image when one is available
                    (the reviews section currently reuses one of the detail
                    photos so the area isn't a flat dark block). */}
                <Image
                  src={heroMedia.servicesHero}
                  alt="Detailed vehicle showcase"
                  fill
                  sizes="50vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-linear-to-r from-surface via-surface/40 to-transparent z-10" />
              </div>
            </div>
          </Container>
        </section>
      )}

      {/* CTA */}
      <section className="relative section-y text-on-primary overflow-hidden" id="booking">
        <HeroMedia
          kind="video"
          src={heroMedia.homeCtaVideo}
          alt="Mirror-finish car paint reflecting workshop lights after a complete detail"
          dim={20}
          tint="primary"
        />
        <Container className="relative z-10 text-center max-w-4xl">
          <h2 className="text-display uppercase mb-8 tracking-tighter">Restore the gloss</h2>
          <p className="text-body-lg text-on-primary/80 mb-12 uppercase tracking-widest font-bold">
            Limited monthly slots available for bespoke detailing.
          </p>
          <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
            <ButtonLink
              href="/book"
              variant="secondary"
              size="lg"
              className="bg-on-primary text-primary-strong border-on-primary hover:bg-on-primary/90"
            >
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

