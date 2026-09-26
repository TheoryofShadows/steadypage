# SteadyPage

Dead-simple **uptime monitoring + public status pages** for indie apps.

Completely separate from MCPX and The-Book. Free tier: 1 HTTPS monitor. Pro: $8/mo, up to 20 monitors. Checks run in-process every 60 seconds. SQLite storage.

## Features (MVP)

- Landing page (honest — no fake social proof)
- Email + password auth (JWT cookie, bcrypt)
- SQLite via `better-sqlite3` with volume-friendly `DB_PATH`
- Free: 1 monitor (HTTPS GET, status + latency)
- Public status page at `/s/:slug`
- Stripe Checkout for Pro ($8/mo) + webhook to unlock Pro
- Dashboard to add/remove monitors
- `GET /health`

## Requirements

- Node.js **18+**
- A Stripe account (for Pro billing)
- Railway (or any host with a persistent volume for SQLite)

## Quick start (local)

```bash
cp .env.example .env
# set JWT_SECRET at minimum; Stripe optional for local
npm install
npm start
# open http://localhost:3000
```

```bash
npm test
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | Default `3000` |
| `APP_URL` | yes (prod) | Public base URL, no trailing slash (e.g. `https://steadypage.up.railway.app`) |
| `JWT_SECRET` | yes | Long random string for signing auth cookies |
| `DB_PATH` | recommended | Absolute path to SQLite file on a volume (e.g. `/data/steadypage.db`) |
| `STRIPE_SECRET_KEY` | for Pro | Stripe secret key |
| `STRIPE_PRICE_PRO` | fallback | Used only if price `price_1UJkAcCJ8WGcNSoK6Hsdx8Bg` ($8/mo) is missing |
| `STRIPE_WEBHOOK_SECRET` | for Pro | Webhook signing secret |
| `CHECK_INTERVAL_MS` | no | Default `60000` |
| `NODE_ENV` | no | Set `production` on Railway |

## Create Stripe Product / Price (Dashboard)

If you are not creating prices via API:

1. Open [Stripe Dashboard → Products](https://dashboard.stripe.com/products).
2. **Add product** → name `SteadyPage Pro`, description optional.
3. Pricing: **Recurring**, **$8.00 USD / month**. Checkout uses the price id in `src/routes.js`. `STRIPE_PRICE_PRO` is only a fallback.
4. Save and copy the **Price ID** (`price_...`) into `STRIPE_PRICE_PRO`.
5. Developers → **Webhooks** → Add endpoint:
   - URL: `https://YOUR_APP_URL/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
6. Copy the webhook **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
7. Put your secret key into `STRIPE_SECRET_KEY` (test or live).

Use **test mode** until you are ready to charge real cards. This app never creates charges outside Checkout; do not paste live secrets into logs.

## Deploy on Railway

1. Create a new Railway project → **Deploy from GitHub** → select `TheoryofShadows/steadypage`.
2. Add a **Volume** mounted at `/data` (or similar).
3. Set variables (Railway → Variables):

   ```
   APP_URL=https://YOUR_RAILWAY_DOMAIN
   JWT_SECRET=<long random>
   DB_PATH=/data/steadypage.db
   NODE_ENV=production
   STRIPE_SECRET_KEY=sk_...
   STRIPE_PRICE_PRO=price_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

4. Ensure the start command is `npm start` (default from `package.json`).
5. Generate a public domain under Settings → Networking.
6. Point the Stripe webhook at `https://YOUR_DOMAIN/webhooks/stripe`.
7. Smoke-check: `GET https://YOUR_DOMAIN/health` → `{"ok":true,...}`.

Railway runs one process; the in-process checker is fine for MVP. For multiple replicas you would need a shared worker — out of scope for this MVP.

## API / routes (overview)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Landing |
| GET/POST | `/signup`, `/login` | Auth forms |
| POST | `/logout` | Clear cookie |
| GET | `/dashboard` | Monitors UI |
| POST | `/monitors` | Add monitor |
| POST | `/monitors/:id/delete` | Remove |
| GET | `/s/:slug` | Public status |
| POST | `/billing/checkout` | Stripe Checkout |
| POST | `/webhooks/stripe` | Stripe webhooks |
| GET | `/health` | Health check |
| POST | `/api/signup`, `/api/login` | JSON helpers |

## License

ISC
