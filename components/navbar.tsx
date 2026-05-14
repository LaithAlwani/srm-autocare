"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { siteConfig } from "@/config/site";
import { ButtonLink } from "@/components/ui/button";

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full bg-surface/85 backdrop-blur-md border-b border-border">
      <div className="container-stitch py-4 flex items-center justify-between">
        <Link
          href="/"
          aria-label={siteConfig.name}
          className="inline-flex flex-col items-end leading-none"
        >
          <Image
            src="/logo.png"
            alt={siteConfig.name}
            width={108}
            height={108}
            priority
          />
          {/* Tagline tucked under the right edge of the logo. Small label-tech
              style so the logo stays the dominant element. */}
          <span className="-mt-3 -mr-8 text-label-tech text-foreground-muted">
            auto care
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-10">
          {siteConfig.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-label-tech text-foreground-muted hover:text-foreground transition-colors"
            >
              {item.label}
            </Link>
          ))}
          <ButtonLink href="/book" variant="primary" size="sm">
            Book Now
          </ButtonLink>
        </nav>

        <button
          className="md:hidden text-foreground"
          aria-label="Toggle menu"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile dropdown nav. Always mounted so CSS can transition both
          directions; `grid-template-rows: 0fr ↔ 1fr` is the modern lock-free
          recipe for "transition to auto height" without measuring at runtime. */}
      <div
        className={`md:hidden grid border-t border-border overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${
          open
            ? "grid-rows-[1fr] opacity-100 border-border"
            : "grid-rows-[0fr] opacity-0 border-transparent"
        }`}
        aria-hidden={!open}
      >
        <div className="min-h-0">
          <div className="container-stitch py-6 flex flex-col gap-4">
            {siteConfig.nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="text-label-tech text-foreground-muted hover:text-foreground py-2 transition-colors"
              >
                {item.label}
              </Link>
            ))}
            <ButtonLink href="/book" variant="primary" size="md" block>
              Book Now
            </ButtonLink>
          </div>
        </div>
      </div>
    </header>
  );
}
