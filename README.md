# SRM Auto Care

Premium car-detailing site built on Next.js 16 + Convex.

- **Design system**: Midnight Precision (dark luxury) — sourced from Stitch and applied via centralized CSS variables in `app/globals.css` + JS tokens in `config/theme.ts`.
- **Brand info**: centralized in `config/site.ts` (nav, contact, address, social). Editable site copy (hero, process steps) lives in Convex `siteContent` so the admin can change it without a redeploy.
- **Backend**: Convex 1.38 (schema, queries, mutations, file storage, HTTP routes).
- **Auth**: Convex Auth Email OTP via Resend — admin-only sign-in (`/admin/login`).
- **Booking**: in-house scheduling (slot availability derived from business hours + existing bookings) + Square Web Payments SDK deposit. The booking is persisted as a draft when the customer reaches the Payment step, promoted to confirmed once Square approves the charge, then pushed to the owner's Google Calendar (optional, via OAuth).

## Getting started

```bash
# 1. Install
npm install

# 2. Sign in to Convex and create a deployment
npx convex login
npx convex dev   # leave this running in a separate terminal — it watches convex/ and pushes

# 3. Copy env template and fill in values from convex dashboard / Square / Resend
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

## Scheduling (in-house)

Slot availability is computed from a single `businessHours` row in the
`siteContent` table, plus the existing bookings already in the database.
No external calendar service.

Editable at `/admin/settings` → **Hours & availability**:

- Open / close time per weekday (Mon–Sun)
- Slot interval (e.g. 30 min)
- Earliest booking notice (e.g. 60 min — can't book inside the next hour)
- Booking window (how many days ahead customers can see)
- Blackout dates (closed days, holidays, vacation)

The slot generator lives at [convex/scheduling.ts](convex/scheduling.ts).
Pure compute against our own DB — to debug "why is this slot not showing
up?" just open the file and walk the filter chain.

## Google Calendar push (optional)

Wire the owner's Google Calendar so every booking, reschedule, and
cancellation pushes immediately. Push-only — the booking flow doesn't read
busy times from Google (use Blackout Dates for that).

### 1. Set up the OAuth client in Google Cloud Console

1. https://console.cloud.google.com → create a project (or pick existing).
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **OAuth consent screen** → External user type → app name "SRM Auto Care",
   add scope `.../auth/calendar.events`, add yourself as a test user.
4. **Credentials → Create credentials → OAuth client ID** → Web application.
   Authorized redirect URI: `https://<convex-site-url>/oauth/google/callback`.
5. Copy the Client ID + Client secret. Push to Convex:
   ```bash
   npx convex env set GOOGLE_OAUTH_CLIENT_ID <client-id>
   npx convex env set GOOGLE_OAUTH_CLIENT_SECRET <client-secret>
   npx convex env set GOOGLE_OAUTH_REDIRECT_URI https://<convex-site-url>/oauth/google/callback
   ```

### 2. Owner connects from /admin/settings

1. Open `/admin/settings` → **Google Calendar** card → **Connect Google Calendar**.
2. Walk through Google's consent screen.
3. You land back on settings with a "Connected" status. New bookings push
   in real time. To stop the integration: click **Disconnect**.

## Square Web Payments SDK setup

The booking flow uses **Square's Web Payments SDK** — Square's modern
embedded card form. Two pieces of setup, one required, one optional.

### 1. Create an application in the Square Developer Dashboard (required)

1. Sign in to https://developer.squareup.com/apps and click **Create app**.
2. Open the app's **Sandbox** tab (we test against this first).
3. Copy three values from the **Credentials** page:
   - **Application ID** (`sandbox-sq0idb-…`) — public, used by the SDK.
   - **Location ID** (`L…`) — public; also needed server-side. The default
     location works fine for testing.
   - **Access token** (`EAAAl…`) — server-side, secret. Never ship this to
     the browser.
4. Push to Convex:
   ```bash
   npx convex env set SQUARE_ACCESS_TOKEN <access-token>
   npx convex env set NEXT_PUBLIC_SQUARE_APPLICATION_ID <application-id>
   npx convex env set NEXT_PUBLIC_SQUARE_LOCATION_ID <location-id>
   npx convex env set NEXT_PUBLIC_SQUARE_ENVIRONMENT sandbox   # or 'production'
   ```
5. Set the same `NEXT_PUBLIC_*` values in `.env.local` so the browser also
   reads them at build time.

That's everything required for synchronous payments. The customer enters
card details, the SDK tokenizes them, the `confirmAndCharge` action charges
the card, and the booking flips to confirmed.

### 2. Webhook for refunds initiated in the Square Dashboard (optional)

The webhook only matters if you expect refunds to be initiated **outside**
the admin UI (i.e. directly from Square's web dashboard) — or you want
defense-in-depth against the rare tab-close case.

1. Square Developer Dashboard → your app → **Webhooks → Subscriptions** → **+ Add subscription**.
2. **URL**: `https://<convex-site-url>/square/webhook`
3. **Event types**: `payment.updated`, `refund.updated`.
4. Save, then copy the **Signature key** that Square shows on the subscription page.
5. Push both values to Convex:
   ```bash
   npx convex env set SQUARE_WEBHOOK_SIGNATURE_KEY <signature-key>
   npx convex env set SQUARE_WEBHOOK_NOTIFICATION_URL https://<convex-site-url>/square/webhook
   ```

`<convex-site-url>` is your Convex deployment's HTTP URL — find it via `npx convex dashboard`.

### Test cards

In sandbox mode (`NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox`):

| Card | Behavior |
|---|---|
| `4111 1111 1111 1111` | Visa, success |
| `5105 1051 0510 5100` | Mastercard, success |
| `4000 0000 0000 0002` | Decline |

Use any future expiry, any 3-digit CVV, postal `94103`.

## Project structure

```
app/
  (public)/         ← marketing site (navbar + footer)
    page.tsx          home
    services/, gallery/, about/, contact/
    book/             multi-step booking flow + Square Web Payments SDK
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
  scheduling.ts       in-house slot generator + business-hours admin
  googleCalendar.ts   push events to the connected Google Calendar
  googleOauth.ts      per-owner OAuth connect / disconnect
  emails.ts           Resend-backed booking lifecycle emails
  square.ts           Square preload + confirmAndCharge + refund actions
  http.ts             Square webhook + Google OAuth callback + auth routes
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
