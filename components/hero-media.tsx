import Image from "next/image";
import { clsx } from "clsx";

// Background media (image or video) for hero sections. Lives behind the
// section content with a configurable dim + gradient so foreground text stays
// legible against bright source assets. Use video for the marquee home/CTA
// heroes; use image for everything else (cheaper, faster).
//
// TODO: when per-page hero images are ready, swap the `src` prop on each
// page that currently uses the shared placeholder.

type Common = {
  className?: string;
  /** 0–100 — dim percent applied to the source. Default 55. */
  dim?: number;
  /** Tint color for an additional overlay (e.g. "primary" for the CTA). */
  tint?: "none" | "primary";
  /**
   * Mark this hero as the page's LCP (largest contentful paint) element.
   * Tells the browser to fetch it with high network priority, skips lazy
   * loading, and (for video) preloads the full file instead of just metadata.
   * Set on EXACTLY ONE hero per page — typically the one above the fold.
   */
  priority?: boolean;
};

type ImageProps = Common & {
  kind: "image";
  src: string;
  alt?: string;
};

type VideoProps = Common & {
  kind: "video";
  src: string;
  /** Optional first-frame poster (jpg/webp) shown before the video loads. */
  poster?: string;
  /**
   * Accessible description of the footage. Surfaced as aria-label on the
   * <video> element. <video> has no `alt` attribute, so this is the canonical
   * way to expose its content to assistive tech.
   */
  alt?: string;
};

export function HeroMedia(props: ImageProps | VideoProps) {
  const dim = props.dim ?? 55;
  const tint = props.tint ?? "none";
  const priority = props.priority ?? false;

  return (
    <div className={clsx("absolute inset-0 overflow-hidden", props.className)}>
      {props.kind === "image" ? (
        <Image
          src={props.src}
          alt={props.alt ?? ""}
          fill
          // `priority` already disables lazy loading and bumps Next/Image's
          // internal fetch priority. We also stamp fetchPriority for browsers
          // that read it directly off the rendered <img>.
          priority={priority}
          fetchPriority={priority ? "high" : "auto"}
          sizes="100vw"
          className="object-cover"
        />
      ) : (
        <video
          // playsInline + muted are required for browsers (esp. iOS Safari)
          // to allow autoplay without a user gesture.
          autoPlay
          muted
          loop
          playsInline
          // For the LCP hero we preload the full file so the first frames
          // can paint ASAP. For non-LCP heroes "metadata" keeps initial
          // payload small.
          preload={priority ? "auto" : "metadata"}
          poster={props.poster}
          aria-label={props.alt}
          aria-hidden={props.alt ? undefined : true}
          className="w-full h-full object-cover"
          // fetchPriority isn't typed on <video> in @types/react yet, but the
          // HTML attribute is honored by Chromium-based browsers and falls
          // back gracefully elsewhere. Spread via cast keeps the intent clear.
          {...({ fetchPriority: priority ? "high" : "auto" } as { fetchPriority: "high" | "auto" })}
        >
          <source src={props.src} type="video/mp4" />
        </video>
      )}

      {/* Dim overlay so text reads cleanly. */}
      <div
        className="absolute inset-0 bg-surface"
        style={{ opacity: dim / 100 }}
      />

      {/* Optional brand tint (used on the booking CTA where we want the
          electric blue treatment to stay even with footage behind it). */}
      {tint === "primary" && (
        <div className="absolute inset-0 bg-primary/70 mix-blend-multiply" />
      )}

      {/* Soft top→bottom fade so the section blends into the dark background
          above and below — kills any harsh edge between sections. */}
      <div className="absolute inset-0 bg-linear-to-b from-surface/40 via-transparent to-surface" />
    </div>
  );
}
