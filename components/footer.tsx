import Link from "next/link";
import { Camera, Mail, MapPin, Phone, Share2 } from "lucide-react";
import { siteConfig } from "@/config/site";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-surface-container-lowest border-t border-border mt-20">
      <div className="container-stitch section-y grid grid-cols-1 md:grid-cols-4 gap-12">
        {/* Brand */}
        <div>
          <Link
            href="/"
            className="font-display text-headline-md font-black uppercase text-foreground block mb-6"
          >
            {siteConfig.name}
          </Link>
          <p className="text-body-md text-foreground-muted max-w-xs">
            {siteConfig.description}
          </p>
        </div>

        {/* Navigation */}
        <div>
          <h5 className="text-label-tech text-primary mb-6">Navigation</h5>
          <ul className="space-y-4">
            {siteConfig.footerNav.navigation.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-body-md text-foreground-muted hover:text-foreground transition-colors"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Contact */}
        <div>
          <h5 className="text-label-tech text-primary mb-6">Contact</h5>
          <ul className="space-y-4 text-body-md text-foreground-muted">
            <li className="flex items-start gap-3">
              <Phone size={16} className="mt-1 shrink-0" />
              <a href={siteConfig.contact.phoneHref} className="hover:text-foreground transition-colors">
                {siteConfig.contact.phone}
              </a>
            </li>
            <li className="flex items-start gap-3">
              <Mail size={16} className="mt-1 shrink-0" />
              <a
                href={`mailto:${siteConfig.contact.email}`}
                className="hover:text-foreground transition-colors"
              >
                {siteConfig.contact.email}
              </a>
            </li>
            <li className="flex items-start gap-3">
              <MapPin size={16} className="mt-1 shrink-0" />
              <a
                href={siteConfig.address.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                {siteConfig.address.street}
                <br />
                {siteConfig.address.city}, {siteConfig.address.state} {siteConfig.address.zip}
              </a>
            </li>
          </ul>
        </div>

        {/* Connect */}
        <div>
          <h5 className="text-label-tech text-primary mb-6">Connect</h5>
          <div className="flex gap-3">
            <a
              href={siteConfig.social.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="w-10 h-10 border border-border flex items-center justify-center text-foreground hover:border-primary hover:text-primary transition-all"
            >
              <Camera size={18} />
            </a>
            <a
              href={siteConfig.social.facebook}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share"
              className="w-10 h-10 border border-border flex items-center justify-center text-foreground hover:border-primary hover:text-primary transition-all"
            >
              <Share2 size={18} />
            </a>
            <a
              href={`mailto:${siteConfig.contact.email}`}
              aria-label="Email"
              className="w-10 h-10 border border-border flex items-center justify-center text-foreground hover:border-primary hover:text-primary transition-all"
            >
              <Mail size={18} />
            </a>
          </div>
          <ul className="mt-8 space-y-3 text-body-md text-foreground-muted">
            {siteConfig.footerNav.legal.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-foreground transition-colors">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="container-stitch py-6 text-label-tech text-foreground-muted">
          © {year} {siteConfig.legal.copyrightHolder}. {siteConfig.legal.copyrightLine}
        </div>
      </div>
    </footer>
  );
}
