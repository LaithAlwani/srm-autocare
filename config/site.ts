// Single source of truth for static brand info, navigation, and contact details.
// Anything an admin needs to edit at runtime (services, pricing, gallery, hero
// copy, business hours that change seasonally, etc.) lives in Convex `siteContent`
// instead — this file is for fixed brand assets that ship with the code.

export const siteConfig = {
  name: "SRM Auto Care",
  shortName: "SRM",
  tagline: "Precision Detailing. Showroom Finish.",
  description:
    "Premium automotive detailing — ceramic coatings, paint correction, PPF, and bespoke interior care for the discerning owner.",
  url: "https://srm-autocare.com",

  contact: {
    email: "info@srm-autocare.com",
    phone: "+1 (613) 741-0080",
    phoneHref: "tel:+16137410080",
  },

  address: {
    street: "1645 Comstock Rd",
    city: "Gloucester",
    state: "ON",
    zip: "K1B 4X2",
    country: "Canada",
    mapsUrl: "https://www.google.com/maps/place/SRM+Collision+Centre/data=!4m2!3m1!1s0x0:0xaed2aed477d2637f?sa=X&ved=1t:2428&ictx=111",
  },

  // Default hours — admin can override via Convex siteContent["hours"] when
  // they need to change seasonally without a redeploy.
  defaultHours: [
    { day: "Mon", open: "09:00", close: "18:00" },
    { day: "Tue", open: "09:00", close: "18:00" },
    { day: "Wed", open: "09:00", close: "18:00" },
    { day: "Thu", open: "09:00", close: "18:00" },
    { day: "Fri", open: "09:00", close: "18:00" },
    { day: "Sat", open: null, close: null },
    { day: "Sun", open: null, close: null },
  ],

  social: {
    instagram: "https://instagram.com/srm_autocare",
    facebook: "https://facebook.com/srmautocare",
  },

  nav: [
    { label: "Services", href: "/services" },
    { label: "Gallery", href: "/gallery" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
  ],

  footerNav: {
    navigation: [
      { label: "Services", href: "/services" },
      { label: "Gallery", href: "/gallery" },
      { label: "About", href: "/about" },
      { label: "Booking", href: "/book" },
    ],
    legal: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Contact", href: "/contact" },
    ],
  },

  ownerEmail: "laithalwani@gmail.com",

  legal: {
    copyrightHolder: "SRM Auto Care",
    copyrightLine: "Engineered Radiance.",
  },
} as const;

export type SiteConfig = typeof siteConfig;
