"use client";

import { motion } from "framer-motion";
import { Award, Target, Users } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ButtonLink } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

const VALUES = [
  {
    icon: Award,
    title: "Excellence",
    body: "Every surface is treated with surgical care. Our standard is showroom — and then a half step beyond.",
  },
  {
    icon: Target,
    title: "Precision",
    body: "Premium products, calibrated tools, and 5000K inspection lighting at every stage of the process.",
  },
  {
    icon: Users,
    title: "Trust",
    body: "Your vehicle is documented before, during, and after. No surprises, no shortcuts.",
  },
];

export default function AboutPage() {
  return (
    <div>
      <section className="section-y border-b border-border">
        <Container>
          <Eyebrow className="mb-4">About</Eyebrow>
          <h1 className="text-display uppercase tracking-tighter mb-6 max-w-3xl">
            Engineered for the discerning owner
          </h1>
          <p className="text-body-lg text-foreground-muted max-w-2xl">
            {siteConfig.name} is a precision detailing studio dedicated to one thing: extracting the
            absolute best finish your paint and interior are capable of producing.
          </p>
        </Container>
      </section>

      <section className="section-y">
        <Container>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="aspect-4/5 bg-surface-container relative overflow-hidden gloss-card">
              <div className="absolute inset-0 bg-linear-to-tr from-surface to-surface-container-high" />
            </div>
            <div>
              <h2 className="text-headline-lg uppercase mb-6">Our story</h2>
              <div className="space-y-4 text-body-md text-foreground-muted">
                <p>
                  {siteConfig.name} began as a single-bay obsession with the deepest possible gloss
                  on a daily-driven sports car. Today it's a full studio serving owners who care
                  about every micron of their finish.
                </p>
                <p>
                  Our process is documented, repeatable, and inspectable. From decontamination to
                  ceramic coating curing, every stage is performed under 5000K lighting with the
                  same products and protocols used on collector vehicles.
                </p>
                <p>
                  We don't take more cars per day than we can finish to spec. That's the trade — and
                  it's why our calendar fills weeks in advance.
                </p>
              </div>
            </div>
          </div>
        </Container>
      </section>

      <section className="section-y bg-surface-container-low">
        <Container>
          <h2 className="text-headline-lg uppercase mb-12 text-center">Core values</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {VALUES.map((v, i) => (
              <motion.div
                key={v.title}
                className="gloss-card p-10 text-center"
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                viewport={{ once: true }}
              >
                <v.icon className="text-primary mx-auto mb-6" size={36} strokeWidth={1.5} />
                <h3 className="text-headline-md uppercase mb-3">{v.title}</h3>
                <p className="text-body-md text-foreground-muted">{v.body}</p>
              </motion.div>
            ))}
          </div>
        </Container>
      </section>

      <section className="section-y">
        <Container className="text-center max-w-2xl">
          <h2 className="text-headline-lg uppercase mb-6">
            Ready to see what your paint can do?
          </h2>
          <p className="text-body-md text-foreground-muted mb-8">
            Book a slot for a no-obligation inspection and quote.
          </p>
          <ButtonLink href="/book" variant="primary" size="lg">
            Book Your Session
          </ButtonLink>
        </Container>
      </section>
    </div>
  );
}
