// Hero media asset registry. Each page that has a hero references one of
// these constants instead of hardcoding `/some-image.jpg` inline. Swap the
// path here once and every page that uses it picks up the new asset.
//
// TODO (per-page hero art): replace the shared `defaultHero` placeholder on
// services / gallery / about / contact / book with their own dedicated
// images once we have them. Edit the corresponding constant below.

export const heroMedia = {
  // Marquee video on the homepage hero (above the fold).
  homeHeroVideo: "/hero-dt.mp4",
  // Background video on the homepage "Restore the gloss" CTA banner.
  homeCtaVideo: "/autocar-desktop.mp4",
  // Optional: a short additional clip we have on hand. Currently unused —
  // available if you want to swap one of the above or use it elsewhere.
  // Note the URL-encoded space — the file on disk is "washing mirrors.mp4".
  miscDetailingVideo: "/washing%20mirrors.mp4",

  // Shared placeholder for every other page's hero until per-page art lands.
  defaultHero: "/vecteezy_car-polish-detailing_2099569.jpg",

  // Per-page slots. Currently all point at `defaultHero` — when you upload
  // dedicated art, change the right side without touching any pages.
  servicesHero: "/vecteezy_car-polish-detailing_2099569.jpg", // TODO: dedicated services hero
  galleryHero: "/carwash01.JPG", // TODO: dedicated gallery hero
  aboutHero: "/seats.JPG", // TODO: dedicated about hero
  aboutPortrait: "/engine.jpg", // TODO: shop / team photo for the "Our Story" block
  contactHero: "/headlights.jpg", // TODO: dedicated contact hero
  bookHero: "/steertingwheel.jpg", // TODO: dedicated book hero
} as const;
