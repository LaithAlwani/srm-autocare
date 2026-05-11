"use client";

import { useRef, useState } from "react";
import Image from "next/image";

// Bespoke before/after comparison slider per Midnight Precision design system —
// chrome silver vertical handle, sharp edges, no rounded corners.
export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  caption,
  alt,
}: {
  beforeUrl: string;
  afterUrl: string;
  caption?: string;
  alt: string;
}) {
  const [pos, setPos] = useState(50); // percentage
  const containerRef = useRef<HTMLDivElement>(null);

  function handleMove(clientX: number) {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setPos(next);
  }

  return (
    <div className="gloss-card overflow-hidden">
      <div
        ref={containerRef}
        className="relative aspect-[4/3] cursor-ew-resize select-none"
        onMouseMove={(e) => e.buttons === 1 && handleMove(e.clientX)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
        onMouseDown={(e) => handleMove(e.clientX)}
      >
        {/* After (full width, behind) */}
        <Image src={afterUrl} alt={`${alt} — after`} fill className="object-cover" sizes="100vw" />
        {/* Before (clipped to handle position) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        >
          <Image src={beforeUrl} alt={`${alt} — before`} fill className="object-cover" sizes="100vw" />
        </div>

        {/* Handle */}
        <div
          className="absolute top-0 bottom-0 w-px bg-chrome pointer-events-none"
          style={{ left: `${pos}%` }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-chrome flex items-center justify-center text-on-primary">
            <span className="text-label-tech">⇆</span>
          </div>
        </div>

        {/* Labels */}
        <span className="absolute top-4 left-4 text-label-tech text-chrome bg-surface/70 px-2 py-1">
          BEFORE
        </span>
        <span className="absolute top-4 right-4 text-label-tech text-chrome bg-surface/70 px-2 py-1">
          AFTER
        </span>
      </div>
      {caption && (
        <p className="p-4 text-body-md text-foreground-muted border-t border-border">{caption}</p>
      )}
    </div>
  );
}
