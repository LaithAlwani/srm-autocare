"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { BeforeAfterSlider } from "@/components/before-after-slider";

export default function GalleryPage() {
  const items = useQuery(api.gallery.list, {});

  const beforeAfters = (items ?? []).filter(
    (i): i is typeof i & { beforeImageUrl: string } =>
      i.beforeAfter && !!i.beforeImageUrl,
  );
  const standalones = (items ?? []).filter((i) => !i.beforeAfter || !i.beforeImageUrl);

  return (
    <div>
      <section className="section-y border-b border-border">
        <Container>
          <Eyebrow className="mb-4">Results Gallery</Eyebrow>
          <h1 className="text-display uppercase tracking-tighter mb-6 max-w-3xl">
            Before. After. Surgical precision.
          </h1>
          <p className="text-body-lg text-foreground-muted max-w-2xl">
            Every transformation below was performed in our studio. Drag the slider on each pair to
            inspect the difference yourself.
          </p>
        </Container>
      </section>

      {/* Before/After section */}
      {beforeAfters.length > 0 && (
        <section className="section-y">
          <Container>
            <h2 className="text-headline-lg uppercase mb-12">Comparisons</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {beforeAfters.map((item) => (
                <BeforeAfterSlider
                  key={item._id}
                  beforeUrl={item.beforeImageUrl}
                  afterUrl={item.imageUrl ?? item.beforeImageUrl}
                  caption={item.caption}
                  alt={item.caption ?? "Detail comparison"}
                />
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* Showcase grid */}
      <section className="section-y">
        <Container>
          <h2 className="text-headline-lg uppercase mb-12">Recent work</h2>
          {items === undefined ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="aspect-square gloss-card animate-pulse" />
              ))}
            </div>
          ) : standalones.length === 0 ? (
            <div className="text-center py-16 text-foreground-muted">
              <p>No images yet. Upload some in the admin gallery.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {standalones.map((item, i) => (
                <motion.div
                  key={item._id}
                  className="gloss-card relative aspect-square overflow-hidden group"
                  initial={{ opacity: 0, scale: 0.96 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3) }}
                  viewport={{ once: true, margin: "-50px" }}
                  whileHover={{ scale: 1.02 }}
                >
                  {item.imageUrl && (
                    <Image
                      src={item.imageUrl}
                      alt={item.caption ?? "Detail showcase"}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 50vw, 25vw"
                    />
                  )}
                  {item.caption && (
                    <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-surface/90 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-label-tech text-foreground">{item.caption}</p>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </Container>
      </section>
    </div>
  );
}
