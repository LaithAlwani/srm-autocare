# SRM Auto Care

Premium car-detailing site built on Next.js 16 + Convex.

- **Design system**: Midnight Precision (dark luxury) — sourced from Stitch and applied via centralized CSS variables in `app/globals.css` + JS tokens in `config/theme.ts`.
- **Brand info**: centralized in `config/site.ts` (nav, contact, address, social). Editable site copy (hero, process steps) lives in Convex `siteContent` so the admin can change it without a redeploy.
- **Backend**: Convex 1.38 (schema, queries, mutations, file storage, HTTP routes).
- **Auth**: Convex Auth Email OTP via Resend — admin-only sign-in (`/admin/login`).
- **Booking**: Cal.com slot availability + Stripe Checkout deposit. Stripe webhook confirms the booking and creates the Cal.com booking only after payment.

## Getting started

```bash
# 1. Install
npm install

# 2. Sign in to Convex and create a deployment
npx convex login
npx convex dev   # leave this running in a separate terminal — it watches convex/ and pushes

# 3. Copy env template and fill in values from convex dashboard / Stripe / Cal.com / Resend
cp .env.local.example .env.local

# 4. Seed the database (services + reviews + sample siteContent)
npx convex run seed:run '{"ownerEmail":"you@example.com"}'

# 5. Run Next.js
npm run dev
```

## First admin sign-in

1. Visit `http://localhost:3000/admin/login`
2. Enter your email → receive 6-digit code → sign in
3. If your email matches the one passed to `seed:run`, you're already an owner. Otherwise:
   ```bash
   npx convex run seed:promoteOwner '{"email":"you@example.com"}'
   ```

## Cal.com webhook (sync reschedules / cancellations)

When a customer reschedules or cancels via the link in their Cal.com confirmation
email, the change needs to flow back into Convex. Configure once:

1. https://app.cal.com → **Settings → Developer → Webhooks → New**
2. **Subscriber URL**: `https://<convex-site-url>/calcom/webhook` (find your Convex site URL in the dashboard)
3. **Event Triggers**: check **`BOOKING_RESCHEDULED`** and **`BOOKING_CANCELLED`**
4. **Secret**: generate / paste any random string (e.g. `openssl rand -hex 32`)
5. Push that same secret to Convex:
   ```bash
   npx convex env set CALCOM_WEBHOOK_SECRET <the-secret>
   ```

After saving, every reschedule updates the booking row's `slotStart` / `slotEnd`
and swaps the Cal.com UID. Every cancellation flips the row's `status` to
`cancelled`. Both fire an owner notification email via Resend.

## Stripe webhook (dev)

The `/stripe/webhook` route runs on Convex (not Next.js). Forward Stripe events:

```bash
stripe listen --forward-to <CONVEX_SITE_URL>/stripe/webhook
# Copy the signing secret printed by `stripe listen` into STRIPE_WEBHOOK_SECRET in .env.local
```

`CONVEX_SITE_URL` is your Convex deployment's HTTP URL — find it via `npx convex dashboard`.

## Project structure

```
app/
  (public)/         ← marketing site (navbar + footer)
    page.tsx          home
    services/, gallery/, about/, contact/
    book/             multi-step booking flow + Stripe checkout
  admin/
    login/            OTP sign-in (no admin shell)
    (authed)/         protected: dashboard, services, gallery, bookings, reviews, settings
config/
  site.ts             static brand info — single source of truth
  theme.ts            JS color/font tokens (mirror of globals.css)
convex/
  schema.ts           all tables + authTables from @convex-dev/auth
  auth.ts             Resend Email OTP provider
  users.ts            requireAdmin() guard
  services/gallery/reviews/siteContent.ts   public + admin CRUD
  bookings.ts         booking lifecycle
  calcom.ts           slot listing + booking creation
  stripe.ts           Checkout session
  http.ts             Stripe webhook + auth routes
  seed.ts             bootstrap services + promote owner
proxy.ts            Next.js 16 proxy (was middleware) — gates /admin/*
.stitch/            (gitignored) Stitch design references — re-pull with scripts/pull-stitch.mjs
```

## Adding a new color or font

Edit **two** places:

1. `app/globals.css` — the `@theme {}` block (CSS custom property)
2. `config/theme.ts` — JS mirror (only if used in Framer Motion / canvas / chart libs)

Then reference the new token via Tailwind utilities (`bg-foo`, `text-foo`) — never hardcode hex codes in JSX.

## Verifying centralization

```bash
# No hex codes in JSX:
rg "#[0-9a-fA-F]{3,6}" app components --glob '!*.css' --glob '!config/theme.ts'

# No phone/email hardcoded in JSX:
rg "info@srm|\(\d{3}\) \d{3}" app components
```

Both should return zero matches.
