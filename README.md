# short-invoice

An internal multi-tool workspace for a small team:

- **URL shortener**: short links on your own domain (or `/s/` on the app),
  folders, tags, UTM params, passwords, expiry, cloaking, custom link
  previews, QR codes and click analytics
- **UTM builder**: tagged campaign URLs with presets and QR codes
- **Invoice generator**: Draft → Sent → Overdue → Partially paid → Paid →
  Cancelled, payment logging, receipts, PDF export and analytics
- **Settings** for all three modules

Built to run on the **Cloudflare Workers free plan**.

## Architecture

| Piece | Tech | Notes |
| --- | --- | --- |
| UI | Next.js 16, static export (`out/`) | Served by Workers Static Assets: free, and not counted against request quotas |
| API + redirects | Hono Worker (`worker/`) | Runs for `/api/*`, `/s/*`, `/` and unknown paths (short-domain aliases) |
| Storage | Cloudflare D1 | No KV. Clicks are stored as daily rollups to stay well inside D1's free write/read limits |

See [CLAUDE.md](CLAUDE.md) for the free-tier rules this codebase follows.

## Getting started

```bash
npm install
npm run db:migrate:local
npm run db:seed:local            # optional demo links and campaigns
npm run dev                      # http://localhost:3000
npm test                         # unit + API tests
```

## Deploying

```bash
npx wrangler d1 create short-invoice   # put the database_id in wrangler.jsonc
npm run db:migrate
npx wrangler secret put LINK_COOKIE_SECRET   # signs password-link unlock cookies
npm run deploy
```

Put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
in front of the app host (bypass `/s/*`, which serves short links) before
sharing it. The app has no login of its own yet.

To serve short links on your own domain, attach it to the Worker in the
Cloudflare dashboard (Workers & Pages → short-invoice → Settings → Domains &
Routes → Custom domain), add it in Settings → URL Shortener and press Verify.

## Design reference

`design/` holds the original HTML/CSS design handoff and its spec
([design/README.md](design/README.md)). It is reference only and is not shipped.
