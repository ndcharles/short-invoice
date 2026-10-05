@AGENTS.md

# short-invoice — working notes

Internal multi-tool workspace: **URL shortener**, **UTM builder**, **invoice
generator** (+ settings). Next.js UI exported as static files, a Hono Worker
for the API and short-link redirects, and Cloudflare D1 for storage.

## Layout

```
src/        Next.js app (all pages are client components) -> static export in out/
worker/     Hono Worker: /api/* and /s/:alias. Entry worker/index.ts
migrations/ D1 schema (wrangler d1 migrations)
seed/       demo data for local dev only
design/     original HTML design handoff (reference, not shipped)
```

`src/lib/types.ts`, `src/lib/links/*` and `src/lib/invoices.ts` are shared by
both sides; keep them free of React/DOM/Workers imports.

## Commands

```bash
npm run db:migrate:local   # first run: create local D1 schema
npm run db:seed:local      # optional demo data
npm run dev                # wrangler dev :8787 + next dev :3000 (proxies /api, /s)
npm run typecheck          # UI tsconfig + worker/tsconfig.json
npm run lint
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
  not scrypt. Avoid heavy per-request work in the Worker.
- Multi-statement writes use `db.batch([...])` (one round trip, atomic).
- SQL uses bound placeholders (`?1`); never interpolate request input.
  Table names only from fixed maps (see `worker/lib/collections.ts`).

## Settings

`settings` stores overrides only; defaults live in
`worker/lib/settings-defaults.ts`. New settings keys need no migration.
Real business details (legal name, bank accounts, tax id) belong in D1 via the
Settings UI. **The repo is public; never commit them.**

## Deploying (first time)

```bash
npx wrangler d1 create short-invoice   # paste database_id into wrangler.jsonc
npm run db:migrate
npm run deploy
```

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
  of everything except `/s/*` before sharing the deployed URL.
- Short links resolve at `/s/:alias` on the app host; serving `4th.link/:alias`
  needs a custom domain route and host-based routing in the Worker.
- Parts of the analytics UI still render placeholder data.
