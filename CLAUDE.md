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
tests/      vitest: unit/ (pure libs), api/ (black-box against wrangler dev),
            e2e/ (real Chrome driving the built app)
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

The app is served only from its custom domain (`workers_dev` and
`preview_urls` are off in wrangler.jsonc). Sign-in is built in (see People,
roles and activity). Short links on a short
domain are always public; everything under `/api/*` needs a session.

## Commands

```bash
npm run db:migrate:local   # first run (and after new migrations): local D1 schema
npm run db:seed:local      # optional demo links/campaigns
npm run dev                # wrangler dev :8787 + next dev :3000 (proxies /api, /s)
npm run typecheck          # UI tsconfig + worker/tsconfig.json
npm run lint
npm test                   # unit + API tests (boots wrangler dev on :8791, fresh D1)
npm run test:e2e           # browser tests: needs Google Chrome; rebuilds the app, wrangler dev on :8792
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

## Security rules

Audited 2026-10-07 (external attackers, sign-in, member vs admin). Keep these:

- **Every outbound fetch goes through `worker/lib/ssrf.ts`.** `checkFetchUrl`
  allows only http(s) on ports 80/443 with no credentials in the URL, and
  `isBlockedHost` refuses localhost, private/link-local/CGNAT/reserved IPv4,
  IPv6 loopback/ULA/mapped/NAT64/6to4 and odd spellings (`2130706433`,
  `0x7f.1`). Redirects are followed by hand (max 4) and **each hop is
  re-checked**; bodies are read with `readLimited`, never `res.text()`.
  The link-preview endpoint is also limited to 60 requests / 10 min per user.
- **Public link pages (`worker/routes/redirect.ts`, `worker/lib/cloak.ts`).**
  - The password page needs `form-action 'self' http: https:` (its own CSP).
    Chrome applies `form-action` to the redirect that follows a form post, so
    `'self'` blocks the redirect to the destination and the right password
    leads nowhere. Pages with no form use `form-action 'none'`. Tested in real
    Chrome (`tests/e2e/public-links.test.ts`); API tests alone cannot catch this.
  - Password guesses are counted (`auth_limits` via `withinLimit`): 10 per
    visitor (IP) per 10 minutes and 300 per link per hour, answered with 429.
    Visitors holding a valid unlock cookie skip the check. Expiry beats the
    password prompt, so an expired link never asks for one.
  - Cloaked links: an https page cannot frame an http page (mixed content, a
    blank page). On https `cloakPage()` rewrites the frame to https and adds
    `upgrade-insecure-requests`.
- **Headers.** `worker/index.ts` adds nosniff, Referrer-Policy, COOP,
  `X-Frame-Options: DENY` and HSTS to every response; `public/_headers` does the
  same for static files. Worker-generated pages (password, cloak, expired) carry
  a locked-down CSP and load nothing from third parties (no web fonts). The
  app's own CSP still needs `'unsafe-inline'` scripts for Next's bootstrap.
- **Body limits.** 1 MB for every API write, 12 MB for `/api/invoices/:id/send`
  (PDF attachments). `readJsonObject` enforces it even without Content-Length.
- **The client IP is `cf-connecting-ip` only** (`clientIp`); never trust
  `x-forwarded-for`.
- **Members never see mail-server details.** `publicSettings(settings, isAdmin)`
  hides every `smtp_*` key from members and gives them `smtp_ready` instead;
  the UI's `emailReady` reads that. Folders and tags are admin-managed
  (members pick only; see People, roles and activity).
- **`smtp_password` is encrypted at rest** (`worker/lib/secrets.ts`, AES-GCM,
  key derived from `AUTH_PEPPER`, stored as `enc1:iv:cipher`). Rotating
  `AUTH_PEPPER` locks everyone out *and* makes the saved SMTP password
  unreadable (re-enter it). Decrypt only in the send/test routes.
- `login`/`setup` batches also prune expired sessions and old `auth_limits`
  rows (`cleanupStatements`), so those tables cannot grow without bound.
- Accepted, by design: `/api/auth/check` tells a *listed* email from an unlisted
  one (needed for the two-step sign-in; per-IP limited), and wrong guesses can
  lock a known account for 15 minutes. Members can email arbitrary recipients
  through the company SMTP (100/day, 10 recipients per message).

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
  `smtp_password_clear: 'true'` removes it. It is stored encrypted (see
  Security rules). Any new secret goes in `SECRET_KEYS`.
- The pure message builder lives in `worker/lib/mime.ts` (testable in Node);
  `smtp.ts` imports `cloudflare:sockets`, which only loads in the Worker.
- Every attempt is logged in `invoice_emails` (migration 0002) and shown on the
  invoice; the log also caps sends at 100 per 24 h. Sending requires a signed-in
  admin or member.
- `tests/api/email.test.ts` runs a fake SMTP server in the test process.

## People, roles and activity

- Sign-in is built into the Worker (`worker/lib/auth.ts`, `worker/routes/auth.ts`);
  no Cloudflare Access. Only people an admin adds in Settings → Team can sign
  in. Adding someone creates a one-time setup code (shown once, stored only as
  a hash, 7 days, burned after 5 wrong tries) that the admin hands over; the
  person uses it once with a name and password. Later sign-ins: email, then
  password. Forgotten password: remove and re-invite (no emails are sent).
- Unknown emails get `{ next: null }` from `/api/auth/check`, identical to a
  rate-limited answer, and the sign-in page simply stays still.
- Passwords: HMAC with the `AUTH_PEPPER` secret, then PBKDF2 (60k) with a
  per-user salt. 5 wrong passwords lock the account (15 min, doubling, max a
  day); per-IP limits on checks (30/15 min) and attempts (20/15 min) live in
  `auth_limits` (hashed keys, no raw IPs).
- Sessions: random 32-byte token in a `__Host-session` cookie (HttpOnly,
  Secure, SameSite=Strict, 365 days); only its SHA-256 is in `sessions`.
  Removing a person deletes all their sessions. `requireUser` guards every
  `/api/*` route except health and `/api/auth/*`.
- Three roles. **Owner**: the `ADMIN_EMAILS` secret (comma-separated); full
  access, and the only one who manages the team. **Admin**: a member the owner
  has switched on in Settings → Team (`PATCH /api/team/users/:email`, stored in
  `users.role`, applies on their next request, reset when they are removed).
  **Member**: everyone else. `CurrentUser.role` is `'admin'` for owners and
  admins alike (so `requireAdmin` and every `role === 'admin'` check cover both)
  and `CurrentUser.owner` marks the owner (`requireOwner`). The UI names them
  with `roleName()` / `ROLE_LABEL` in `src/lib/team.ts`.
  The first owner sign-in: `npm run setup-code -- you@x.com` (prints a setup
  code; `--local` for the local database). Dropping someone from
  `ADMIN_EMAILS` leaves them an admin until you switch it off in Team.
- Members create and edit links, UTMs and invoices, archive them, and pick from
  existing folders and tags. Admins also get settings, domains, creating and
  changing folders/tags, export, test email, the activity log and all deletes
  (`requireAdmin`, see `worker/index.ts`). Only the owner adds or removes
  people, issues codes and chooses admins (`requireOwner`), so an admin can
  never promote themselves. The Team page's "What each role can do" table
  (`ACCESS` in `src/app/settings/team/page.tsx`) is hand-written: change it
  with the rules above.
- **Members cannot invent folders or tags**, not even by typing a name into a
  record: `POST /api/collections` is admin-only and `unknownPick()`
  (`worker/lib/collections.ts`) rejects an unknown folder/tag from a member on
  link/UTM/invoice create and update (a value the record already carries is
  accepted). Link editors hide "Create tag" for members.
- The Team → Activity feed shows 20 rows a page (`GET /api/team/activity`),
  paged by a `(at, rowid)` cursor with Newer/Older buttons. Keep it that way:
  no OFFSET and no total count (both read every row, so cost would grow with the
  table); one extra row is fetched to know whether another page exists. The
  person filter and the unfiltered feed seek straight into an index; the type
  filter walks `idx_activity_at` and only gets slow for a rare type once the
  table is very large (add `(entity_type, at)` then; every index costs a write).
  Rows are about 100 bytes, so even 200 changes a day is ~7 MB a year against
  D1's 5 GB; there is no pruning. If you ever add one, make it a decision.
- Every write records `created_by`/`updated_by` (emails) and an `activity` row
  in the same batch (`worker/lib/activity.ts`). Invoice payments carry `by`,
  set on the server; emails carry `sent_by`.
- Locally you sign in like in production (`npm run setup-code -- you@x.com
  --local`). API tests run with `DEV_AUTH_BYPASS=1`, where a localhost request
  with `x-dev-user: someone@x` acts as that person; never set it in production.

## UI gotchas

- **Copy on create.** Creating a link or UTM copies its address and shows a toast
  (`copyText()` in `src/lib/clipboard.ts`, `showToast()` in
  `src/components/toast.tsx`, `<ToastHost />` is in the Shell). Pass `copyText` a
  *promise* for the text, started inside the click: Safari refuses clipboard
  writes made after the click handler has waited on the network.
- **Expiration dates** are typed or picked in the browser's own timezone and sent
  as epoch milliseconds; the server never guesses a zone. `src/lib/links/expiry.ts`
  is strict: unreadable text, numeric dates like 10/11/2026 (day-first or
  month-first?) and past times are refused instead of guessed.

- basecoat-css pins every `[data-popover]` to the left edge. A dropdown that
  should open to the left of its button needs `data-align="end"` as well as
  `right: 0`, or it runs off the screen.
- **Dialogs use `<Portal>`** (`src/components/portal.tsx`). The sidebar is its
  own stacking context, so a backdrop rendered inside it only dims the sidebar.
  Any new `.modal-backdrop` / `.popup-backdrop` must be wrapped in `<Portal>`.
- **Menus** use `usePopoverDismiss` (`src/lib/popover.ts`): it closes every
  other open menu and ignores clicks inside `[data-popover]`, `[data-row-menu]`
  and `.dropdown`. Closing on `mousedown` outside a menu item made every item
  dead in a real browser (synthetic `.click()` hid it), so test menus with real
  mouse clicks.
- **No flashing placeholders.** Pages render a neutral `.skeleton` until settings
  (and, on the sign-in page, the workspace brand) have loaded. Never default a
  workspace name, logo letter or "domain pending" before the data arrives.
- Use `useConfirm()` / `useNotice()` (`choice-modal.tsx`), never `window.confirm`
  or `alert`.
- No keyboard shortcuts for now (decided; do not add them back unasked).
- `MoneyInput` selects its text on focus; keep that, the editors rely on it.

## Testing

- `tests/unit`: pure functions. `worker-libs.test.ts` imports Worker code, so it
  is compiled by `worker/tsconfig.json` (and excluded from the root tsconfig).
- `tests/api`: black-box HTTP against `wrangler dev` with a fresh D1;
  `security.test.ts` covers auth, CSRF, roles, SSRF, headers and body limits.
- `tests/e2e`: Playwright (playwright-core) driving system Chrome against the
  **built** static app (`next build`) served by `wrangler dev`; never against
  `next dev` (its overlay and HMR hang headless Chrome). Uses its own matchers
  (`matchers.ts`) because vitest has no Playwright `expect`. When you add a
  button, menu or page, add a case there; it caught real bugs the API tests
  could not (dead menus, phone overflow, members' silent failures).

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

Re-measured later the same way: ~440 ms total per click from Nigeria, of which
the app and D1 are only 30-50 ms; the rest is the round trip to London (~130 ms
RTT, several of them). There is no app-side fix; do not cache redirects.

## Known gaps (next steps)

- Duplicating a link or UTM does not copy anything to the clipboard (only creating does).
- A cloaked link to a destination that only works over plain `http` cannot be shown
  from an https short link (browsers block it); nothing can fix that server-side.
