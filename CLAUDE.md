@AGENTS.md

# short-invoice — working notes

Internal multi-tool workspace: **URL shortener**, **UTM builder**, **invoice
generator** (+ settings). Next.js UI exported as static files, a Hono Worker
for the API and short-link redirects, and Cloudflare D1 for storage.

## Layout

```
src/        Next.js app (all pages are client components) -> static export in out/
worker/     Hono Worker. Entry worker/index.ts
migrations/ D1 schema (wrangler d1 migrations)
seed/       demo data for local dev only
tests/      vitest: unit/ (pure libs) and api/ (black-box against wrangler dev)
design/     original HTML design handoff (reference, not shipped)
```

Shared by the Worker and the UI, so free of React/DOM/Workers imports:
`src/lib/types.ts`, `validate.ts`, `invoices.ts`, `short-url.ts`, `links/*`.

## Routing

The Worker runs for `/api/*`, `/s/*` and `/` (`run_worker_first`), and for any
path with no static file (`not_found_handling: "none"`). It handles:

- `/s/:alias`: short link on the default domain (any host).
- `/<alias>` on a verified custom domain: same link lookup, keyed by the host.
- `/` on a short domain: the root redirect setting. On the app host: the app.
- `/.well-known/short-invoice`: token used by Settings → Verify for domains.
- Anything else: the static app's 404 page.

Cloudflare Access belongs on the **app host only**, with `/s/*` bypassed.
Short domains (e.g. 4th.link) should not be behind Access at all.

## Commands

```bash
npm run db:migrate:local   # first run (and after new migrations): local D1 schema
npm run db:seed:local      # optional demo links/campaigns
npm run dev                # wrangler dev :8787 + next dev :3000 (proxies /api, /s)
npm run typecheck          # UI tsconfig + worker/tsconfig.json
npm run lint
npm test                   # unit + API tests (boots wrangler dev on :8791, fresh D1)
npm run preview            # static build served by the Worker on :8787
npm run deploy             # next build && wrangler deploy
npm run db:migrate         # apply migrations to remote D1
```

Open http://localhost:3000 in dev.

## Invariants: Cloudflare free tier first

The app must keep fitting the Workers Free plan. Binding limits:
100k Worker requests/day, 10 ms CPU per request, 3 MiB compressed Worker,
D1 5M rows read / 100k rows written per day, 5 GB storage.

- **No KV, ever.** KV's free tier is 1,000 writes/day. State lives in D1;
  caching uses the Workers Cache API (`caches.default`). No Durable Objects,
  Queues or paid add-ons without an explicit decision.
- **The UI stays a static export.** Static asset requests are free and don't
  count toward the request quota; only `/api/*` and `/s/*` run the Worker
  (`run_worker_first` in wrangler.jsonc). No server components that need a
  runtime, no route handlers, no dynamic `[param]` segments: use `?id=`
  query params and `useSearchParams` inside `<Suspense>`.
  Don't move to OpenNext/SSR without revisiting this.
- **Clicks are rolled up, not logged per row.** `link_clicks_daily` is keyed
  by link/day/country/device/browser/os/referrer host; a click is one upsert
  plus one `links.clicks` increment, in `waitUntil`. Bots are skipped.
  Analytics read the rollup in a single scan and aggregate in memory, since
  every extra GROUP BY over the same rows is billed again.
- **Every index costs writes.** Only add an index that backs a real query.
- **CPU budget.** Link passwords use PBKDF2 via WebCrypto (`worker/lib/password.ts`),
  not scrypt. After one correct entry the visitor gets a 12 h HMAC-signed
  per-link cookie (`worker/lib/unlock.ts`, keyed by the `LINK_COOKIE_SECRET`
  secret), so PBKDF2 runs once per visitor. Avoid heavy per-request work in the Worker.
- Multi-statement writes use `db.batch([...])` (one round trip, atomic).
- SQL uses bound placeholders (`?1`); never interpolate request input.
  Table names only from fixed maps (see `worker/lib/collections.ts`).
- **Validate every input on the server** with `src/lib/validate.ts`
  (`parseHttpUrl` for anything that ends up in a redirect, href, src or
  iframe). Worker-rendered HTML escapes every value. API writes require JSON
  and a same-origin `Sec-Fetch-Site` (CSRF guard in `worker/index.ts`).

## Settings

`settings` stores overrides only; defaults live in
`worker/lib/settings-defaults.ts`. New settings keys need no migration.
Real business details (legal name, bank accounts, tax id) belong in D1 via the
Settings UI. **The repo is public; never commit them.**

## Invoices

- Keep the existing invoice UI (canvas, right rail, footer bar, modals,
  `src/app/shared.css`). Change behaviour inside those components; do not add
  a new editor or layout.
- Maths and status rules live in `src/lib/invoices.ts`, shared by the Worker
  and the UI: subtotal − discount + additional charges, then tax; every row is
  rounded to kobo. The Worker recomputes `subtotal`/`total` and the status on
  every write, so the client never sends them.
- Status: Draft and Cancelled are set by hand. Paid / Partially paid follow the
  logged payments. Sent becomes Overdue the day after the due date (one UPDATE
  before each invoice read, `markOverdue` in `worker/routes/invoices.ts`).
- Currency: NGN is the base. `exchange_rate` is naira per one unit of the other
  currency (₦1,550 = $1); 0 means no equivalent is shown. A naira invoice
  shows its USD equivalent; a foreign-currency invoice shows its naira one.
  `equivalent_amount` > 0 overrides the converted figure (an agreed price).
- Switching an invoice between NGN and USD offers to convert every price at
  the rate and always removes the equivalent line, so a USD invoice for a
  foreign client shows no naira unless one is added back.
- With payments logged the canvas shows the receipt; `documentView: 'invoice'`
  shows the original invoice as issued (no payments, stamp or balance).
- New invoices take every default from Settings → Invoice (currency, tax rate,
  payment terms → due date, terms note, default method, folder, tag, USD rate).
- Invoice input is validated by `worker/lib/invoice-input.ts`.
- Demo data: `seed/demo-invoices.sql` (ids `inv_demo_*`, numbers `DEMO-*`),
  loaded by `npm run db:seed:local`. It is generated so every stored total
  matches `invoiceTotals`; the API test `demo seed` checks that.
- Download PDF is the browser's print dialog; `@media print` in `shared.css`
  prints only the invoice.

## Email (SMTP)

- Send emails invoices/receipts through the SMTP server in Settings → Invoice
  (`worker/lib/smtp.ts`, Workers TCP sockets: 465 SSL/TLS or 587 STARTTLS;
  Cloudflare blocks port 25). Plain connections may only log in to localhost.
- Attachments are PDFs rendered in the browser from the canvas
  (`src/lib/invoice-pdf.ts`: html2canvas-pro + pdf-lib, lazy-loaded; the
  `.is-capturing` rules mirror `@media print`). The Worker only checks they are
  PDFs and passes them through, which keeps it inside the 10 ms CPU budget.
- `smtp_password` is write-only: `publicSettings()` strips it from every API
  response (the UI sees `smtp_password_set`), the export skips it, and
  `smtp_password_clear: 'true'` removes it. Any new secret goes in `SECRET_KEYS`.
- Every attempt is logged in `invoice_emails` (migration 0002) and shown on the
  invoice; the log also caps sends at 100 per 24 h. There is no login yet, so
  put Cloudflare Access in front of the app before saving real SMTP details.
- `tests/api/email.test.ts` runs a fake SMTP server in the test process.

## UI gotchas

- basecoat-css pins every `[data-popover]` to the left edge. A dropdown that
  should open to the left of its button needs `data-align="end"` as well as
  `right: 0`, or it runs off the screen.

## Deploying (first time)

```bash
npx wrangler d1 create short-invoice   # paste database_id into wrangler.jsonc
npm run db:migrate
npx wrangler secret put LINK_COOKIE_SECRET   # e.g. `openssl rand -base64 32`
npm run deploy
```

Run `npm run db:migrate` **before** `npm run deploy` whenever `migrations/`
has a new file.

Locally, copy `.dev.vars.example` to `.dev.vars`. Without the secret, password
links still work but ask for the password on every click.

From CI or a cloud session, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Latency notes (measured 2026-10-06, after first deploy)

From Nigeria, the free plan routes traffic to the London colo (LHR), next to
the D1 primary (WEUR). A redirect that reads D1 measured ~398 ms TTFB vs
~383 ms for an endpoint with no DB call: D1 adds ~15 ms. Nearly all latency
is the network path and TLS handshake to London. A per-colo cache would
save about 15 ms, so it is not worth the complexity yet. KV was rejected: its
changes take up to 60 s to propagate and links must update instantly.

## Known gaps (next steps)

- **No authentication.** Put Cloudflare Access (free up to 50 users) in front
  of the app host, bypassing `/s/*`, before sharing the deployed URL.
- Password-protected links have no attempt limit.
