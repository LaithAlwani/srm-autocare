import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// Run with: `npx convex run seed:run --no-push '{"ownerEmail":"you@example.com"}'`
// (Use `seed:promoteOwner` separately if you've already signed in once and just
// need to elevate the existing user to "owner" role.)

const DEFAULT_SERVICES = [
  {
    name: "9H Ceramic Coating",
    slug: "ceramic-coating",
    description:
      "Ultimate hydrophobic protection and chemical resistance with a 5-year guarantee. Surgical multi-stage prep, machine polishing, and a layered ceramic coat that brings out the deepest gloss your paint will ever produce.",
    durationMinutes: 600,
    priceFromCents: 120000,
    icon: "verified",
    badge: "Flagship",
    order: 1,
    active: true,
  },
  {
    name: "Paint Correction",
    slug: "paint-correction",
    description:
      "Removing 95% of swirl marks, fine scratches, and oxidation to restore factory clarity. Multi-stage compounding and polishing under 5000K inspection lighting.",
    durationMinutes: 480,
    priceFromCents: 65000,
    icon: "auto_fix_high",
    badge: "Stage 2",
    order: 2,
    active: true,
  },
  {
    name: "Interior Surgery",
    slug: "interior-detailing",
    description:
      "Deep steam decontamination and conditioning of fine leathers, alcantara, and intricate plastics. Full carpet extraction, headliner cleaning, and odor neutralization.",
    durationMinutes: 240,
    priceFromCents: 32000,
    icon: "airline_seat_recline_extra",
    badge: "Steam Care",
    order: 3,
    active: true,
  },
  {
    name: "PPF Installation",
    slug: "ppf",
    description:
      "Self-healing invisible armor against rock chips and road debris. Computer-cut patterns for flawless edges on the high-impact zones — bumper, hood, mirrors, and door cups.",
    durationMinutes: 720,
    priceFromCents: 180000,
    icon: "shield",
    badge: "Premium",
    order: 4,
    active: true,
  },
  {
    name: "Showroom Wash & Wax",
    slug: "wash-and-wax",
    description:
      "Two-bucket hand wash, clay decontamination, paint sealant, and dressed exterior trim. The right level of care for a daily driver between full corrections.",
    durationMinutes: 180,
    priceFromCents: 18000,
    icon: "local_car_wash",
    order: 5,
    active: true,
  },
];

const DEFAULT_REVIEWS = [
  {
    author: "James D.",
    rating: 5,
    body: "The level of detail SRM provides is borderline obsessive. My 911 looks better than the day I picked it up from the dealership. The depth of the black paint is incredible.",
    source: "manual" as const,
    date: Date.now() - 1000 * 60 * 60 * 24 * 14,
    featured: true,
    vehicleInfo: "Porsche 911 GT3",
  },
  {
    author: "Marcus L.",
    rating: 5,
    body: "Booked the ceramic coating package after seeing their work on a friend's Audi. The hydrophobic finish is unreal — water just sheets off. Worth every penny.",
    source: "manual" as const,
    date: Date.now() - 1000 * 60 * 60 * 24 * 28,
    featured: true,
    vehicleInfo: "Audi RS6 Avant",
  },
  {
    author: "Priya R.",
    rating: 5,
    body: "Interior surgery on my Range Rover after a road trip with the dogs. They got every last hair out of the carpet and the leather looks brand new.",
    source: "manual" as const,
    date: Date.now() - 1000 * 60 * 60 * 24 * 7,
    featured: true,
    vehicleInfo: "Range Rover Sport",
  },
];

const DEFAULT_SITE_CONTENT: Array<{ key: string; value: unknown }> = [
  {
    key: "hero",
    value: {
      eyebrow: "Precision Engineering",
      headline: "PRECISION IN EVERY DETAIL",
      subhead:
        "Elevating automotive care to an exact science. Our bespoke detailing services deliver a mirror-like finish that defines true luxury.",
    },
  },
  {
    key: "process",
    value: {
      eyebrow: "Our Methodology",
      headline: "THE SRM PROTOCOL",
      steps: [
        { number: "01", title: "Decontamination", body: "Multi-stage citrus wash and iron removal to strip surface impurities." },
        { number: "02", title: "Inspection", body: "Microscopic analysis under 5000K high-intensity lighting arrays." },
        { number: "03", title: "Correction", body: "Surgical paint leveling using precision rotary and dual-action tools." },
        { number: "04", title: "Preservation", body: "Curing ceramic or graphene coatings for permanent luster." },
      ],
    },
  },
];

export const run = internalMutation({
  args: { ownerEmail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;
    for (const s of DEFAULT_SERVICES) {
      const existing = await ctx.db
        .query("services")
        .withIndex("by_slug", (q) => q.eq("slug", s.slug))
        .unique();
      if (existing) {
        skipped++;
        continue;
      }
      await ctx.db.insert("services", s);
      inserted++;
    }

    let reviewsInserted = 0;
    const existingReviews = await ctx.db.query("reviews").take(1);
    if (existingReviews.length === 0) {
      for (const r of DEFAULT_REVIEWS) {
        await ctx.db.insert("reviews", r);
        reviewsInserted++;
      }
    }

    let contentInserted = 0;
    for (const c of DEFAULT_SITE_CONTENT) {
      const existing = await ctx.db
        .query("siteContent")
        .withIndex("by_key", (q) => q.eq("key", c.key))
        .unique();
      if (existing) continue;
      await ctx.db.insert("siteContent", c);
      contentInserted++;
    }

    let ownerPromoted = false;
    if (args.ownerEmail) {
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", args.ownerEmail))
        .unique();
      if (user) {
        await ctx.db.patch(user._id, { role: "owner" });
        ownerPromoted = true;
      }
    }

    return {
      servicesInserted: inserted,
      servicesSkipped: skipped,
      reviewsInserted,
      siteContentInserted: contentInserted,
      ownerPromoted,
      ownerNote: ownerPromoted
        ? `User ${args.ownerEmail} promoted to owner.`
        : args.ownerEmail
          ? `No user with email ${args.ownerEmail} yet — sign in once via /admin/login then run seed:promoteOwner.`
          : "Pass --ownerEmail to promote your user.",
    };
  },
});

export const promoteOwner = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .unique();
    if (!user) throw new Error(`No user with email ${args.email}`);
    await ctx.db.patch(user._id, { role: "owner" });
    return { id: user._id, email: user.email, role: "owner" };
  },
});
