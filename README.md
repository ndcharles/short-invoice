# short-invoice

An internal multi-tool workspace for a small team:

- **URL shortener**: short links with folders, tags, UTM params, passwords,
  expiry, cloaking, custom link previews, QR codes and click analytics
- **UTM builder**: tagged campaign URLs with presets and QR codes
- **Invoice generator**: Draft → Sent → Overdue → Partially paid → Paid →
  Cancelled, payment logging, receipts, PDF export and analytics
- **Settings** for all three modules

Built to run on the **Cloudflare Workers free plan**.

## Architecture

| Piece | Tech | Notes |
| --- | --- | --- |
| UI | Next.js 16, static export (`out/`) | Served by Workers Static Assets: free, and not counted against request quotas |
| API + redirects | Hono Worker (`worker/`) | Only `/api/*` and `/s/:alias` invoke the Worker |
| Storage | Cloudflare D1 | No KV. Clicks are stored as daily rollups to stay well inside D1's free write/read limits |

See [CLAUDE.md](CLAUDE.md) for the free-tier rules this codebase follows.

## Getting started

```bash
npm install
npm run db:migrate:local
npm run db:seed:local   # optional demo data
npm run dev             # http://localhost:3000
```

## Deploying

```bash
npx wrangler d1 create short-invoice   # put the database_id in wrangler.jsonc
npm run db:migrate
npm run deploy
```

Put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
in front of the app (everything except `/s/*`) before sharing it. The app
has no login of its own yet.

## Design reference

`design/` holds the original HTML/CSS design handoff and its spec
([design/README.md](design/README.md)). It is reference only and is not shipped.
