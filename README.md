# SRM Auto Care

Premium car-detailing site built on Next.js 16 + Convex.

- **Design system**: Midnight Precision (dark luxury) — sourced from Stitch and applied via centralized CSS variables in `app/globals.css` + JS tokens in `config/theme.ts`.
- **Brand info**: centralized in `config/site.ts` (nav, contact, address, social). Editable site copy (hero, process steps) lives in Convex `siteContent` so the admin can change it without a redeploy.
- **Backend**: Convex 1.38 (schema, queries, mutations, file storage, HTTP routes).
- **Auth**: Convex Auth Email OTP via Resend — admin-only sign-in (`/admin/login`).
- **Booking**: Cal.com slot availability + Moneris Checkout deposit. The booking is persisted as a draft on preload, promoted to confirmed once Moneris's receipt verifies the payment server-side, then pushed to Cal.com.

## Getting started

```bash
# 1. Install
npm install

# 2. Sign in to Convex and create a deployment
npx convex login
npx convex dev   # leave this running in a separate terminal — it watches convex/ and pushes

# 3. Copy env template and fill in values from convex dashboard / Moneris / Cal.com / Resend
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

## Moneris Checkout setup

The booking flow uses **Moneris Checkout** — Moneris's modern embedded-iframe
product. Two pieces of setup, one required, one optional.

### 1. Create a Checkout profile in MRC (required)

1. Sign in to https://www3.moneris.com (or the test gateway equivalent).
2. **Admin → Checkout** → **New Checkout** (or open an existing one).
3. Configure styling, payment methods, etc. — most defaults are fine.
4. Copy the **Checkout ID** that MRC assigns it.
5. Push to Convex (test or prod, see env table in `.env.local.example`):
   ```bash
   npx convex env set MONERIS_STORE_ID <store_id>     # 'store5' for test
   npx convex env set MONERIS_API_TOKEN <api_token>   # 'yesguy' for test
   npx convex env set MONERIS_CHECKOUT_ID <checkout_id>
   npx convex env set NEXT_PUBLIC_MONERIS_ENVIRONMENT qa   # or 'prod'
   ```

The synchronous flow (preload → iframe → verify) works with just the above.

### 2. Async notifications webhook (optional, recommended for prod)

Catches refunds initiated inside MRC + the rare case where a customer closes
the tab between Moneris approving and our verifyAndConfirm call returning.

1. **Admin → Asynchronous Notifications** → enable
2. **Subscriber URL**: `https://<convex-site-url>/moneris/notification`
3. **Secret**: generate one with `openssl rand -hex 32`
4. Push to Convex:
   ```bash
   npx convex env set MONERIS_HMAC_KEY <the-secret>
   ```

`<convex-site-url>` is your Convex deployment's HTTP URL — find it via `npx convex dashboard`.

### Test cards

In test mode (`NEXT_PUBLIC_MONERIS_ENVIRONMENT=qa` + test store/token):

| Card | Behavior |
|---|---|
| `4242 4242 4242 4242` | Visa, success |
| `5454 5454 5454 5454` | Mastercard, success |
| `4000 0000 0000 0002` | Decline |

Use any future expiry, any 3-digit CVD.

## Project structure

```
app/
  (public)/         ← marketing site (navbar + footer)
    page.tsx          home
    services/, gallery/, about/, contact/
    book/             multi-step booking flow + Moneris Checkout
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
  bookings.ts         booking lifecycle (draft → confirmed → cancelled / completed)
  calcom.ts           slot listing + booking creation
  moneris.ts          Moneris Checkout preload + verify + refund actions
  http.ts             Moneris notification + Cal.com webhook + auth routes
  crons.ts            sweeps abandoned booking drafts every 15 min
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
