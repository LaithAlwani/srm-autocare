import { siteConfig } from "@/config/site";

// Structured data for Google's local-business rich results. Uses
// schema.org's `AutoBodyShop` type (a subtype of `LocalBusiness` and
// `AutomotiveBusiness`), which is the closest fit for an auto-detailing
// shop and unlocks the "Open now · Gloucester ON" knowledge-panel card in
// search results.
//
// Lives in the public layout so every marketing page carries the same
// business graph — the admin section is intentionally excluded.

// Precise coordinates for 1645 Comstock Rd, Gloucester, ON — pin-pointed
// from Google Maps. Used in the GeoCoordinates schema below so Google's
// local pack and Maps integration can place the business exactly.
const GEO_LAT = 45.41809402496926;
const GEO_LNG = -75.62036504417831;

// Map our friendly day labels to schema.org's day URIs.
const DAY_URI: Record<string, string> = {
  Mon: "https://schema.org/Monday",
  Tue: "https://schema.org/Tuesday",
  Wed: "https://schema.org/Wednesday",
  Thu: "https://schema.org/Thursday",
  Fri: "https://schema.org/Friday",
  Sat: "https://schema.org/Saturday",
  Sun: "https://schema.org/Sunday",
};

function openingHours() {
  return siteConfig.defaultHours
    .filter((d) => d.open && d.close)
    .map((d) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DAY_URI[d.day],
      opens: d.open,
      closes: d.close,
    }));
}

// Appointment-only days described in a separate spec — Schema.org doesn't
// have a dedicated "by appointment" marker, but adding the spec with no
// opens/closes plus a `description` is the recommended pattern (Google
// surfaces this as a note in rich results).
function appointmentOnlyHours() {
  return siteConfig.defaultHours
    .filter((d) => d.appointmentOnly)
    .map((d) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DAY_URI[d.day],
      description: "By appointment only — no walk-ins",
    }));
}

export function JsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "AutoBodyShop",
    "@id": `${siteConfig.url}/#business`,
    name: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    telephone: siteConfig.contact.phone,
    email: siteConfig.contact.email,
    image: `${siteConfig.url}/logo.png`,
    priceRange: "$$",
    address: {
      "@type": "PostalAddress",
      streetAddress: siteConfig.address.street,
      addressLocality: siteConfig.address.city,
      addressRegion: siteConfig.address.state,
      postalCode: siteConfig.address.zip,
      addressCountry: siteConfig.address.country === "Canada" ? "CA" : siteConfig.address.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: GEO_LAT,
      longitude: GEO_LNG,
    },
    openingHoursSpecification: [...openingHours(), ...appointmentOnlyHours()],
    sameAs: [siteConfig.social.instagram, siteConfig.social.facebook].filter(Boolean),
    areaServed: {
      "@type": "City",
      name: siteConfig.address.city,
    },
  };

  return (
    <script
      type="application/ld+json"
      // dangerouslySetInnerHTML lets Next ship the literal JSON without
      // React mangling quotes — required for valid JSON-LD.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
