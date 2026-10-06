import { Hono, type Context } from 'hono';
import type { AppEnv } from './env';
import links from './routes/links';
import utms from './routes/utms';
import invoices from './routes/invoices';
import collections from './routes/collections';
import settings from './routes/settings';
import metadata from './routes/metadata';
import analytics from './routes/analytics';
import domains, { VERIFY_PATH, verifyToken } from './routes/domains';
import exporter from './routes/export';
import publicInvoice from './routes/public-invoice';
import redirect, { notFoundPage, serveLink, suppliedPassword } from './routes/redirect';
import { isAppHost, readShortDomainConfig } from './lib/domains';
import { parseAlias, parseHttpUrl } from '../src/lib/validate';

/**
 * The Worker runs for /api/*, /s/* and / (see `run_worker_first` in
 * wrangler.jsonc), and for any path that matches no static file (for example
 * `4th.link/abc` on an attached short domain). Everything else is a static file
 * from the Next.js export, served by Workers Static Assets, which is free and
 * does not count against the daily request quota.
 */
const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (c.req.path.startsWith('/api/')) c.res.headers.set('Cache-Control', 'no-store');
});

/**
 * CSRF guard for state-changing API calls. Browsers send Sec-Fetch-Site on
 * every request; anything not same-origin is refused. JSON bodies are also
 * required, which a cross-site <form> cannot produce without a CORS preflight
 * (and the API never answers preflights).
 */
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return c.json({ error: 'Cross-site request blocked' }, 403);
  }
  const origin = c.req.header('origin');
  if (!site && origin && origin !== 'null' && new URL(origin).host !== new URL(c.req.url).host) {
    return c.json({ error: 'Cross-site request blocked' }, 403);
  }
  if (method !== 'DELETE' && !(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return c.json({ error: 'Content-Type must be application/json' }, 415);
  }
  return next();
});

app.route('/api/links', links);
app.route('/api/utms', utms);
app.route('/api/invoices', invoices);
app.route('/api/collections', collections);
app.route('/api/settings', settings);
app.route('/api/metadata', metadata);
app.route('/api/analytics', analytics);
app.route('/api/domains', domains);
app.route('/api/export', exporter);
// The public invoice view must be mounted before the /s/:alias redirect routes.
app.route('/s/i', publicInvoice);
app.route('/s', redirect);

app.get('/api/health', (c) => c.json({ ok: true }));
// Answered on every host, so Settings → Verify can prove a domain reaches this deployment.
app.get(VERIFY_PATH, async (c) => c.json({ app: 'short-invoice', token: await verifyToken(c.env.DB) }));
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.path} failed`, err);
  return c.json({ error: 'Internal error' }, 500);
});

/** The static export's own 404 page, with a real 404 status. */
async function appNotFound(c: Context<AppEnv>) {
  const page = await c.env.ASSETS.fetch(new Request(new URL('/404', c.req.url)));
  if (!page.ok) return c.text('Not found', 404);
  return new Response(page.body, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// Root of a short domain goes to the configured root redirect; root of the
// app host is the static app (whose _redirects sends `/` to `/links`).
app.get('/', async (c) => {
  const host = new URL(c.req.url).hostname.toLowerCase();
  if (isAppHost(host)) return c.env.ASSETS.fetch(c.req.raw);

  const config = await readShortDomainConfig(c.env.DB);
  if (!config.domains.includes(host)) return c.env.ASSETS.fetch(c.req.raw);

  const target = config.rootRedirect ? parseHttpUrl(config.rootRedirect) : null;
  if (target?.ok) return c.redirect(target.value, 302);
  return c.html(notFoundPage(host), 404);
});

// `/<alias>` on an attached short domain. On the app host this only runs for
// paths that are not static files, so it falls through to the app's 404 page.
app.on(['GET', 'HEAD', 'POST'], '/:alias', async (c) => {
  const url = new URL(c.req.url);
  const host = url.hostname.toLowerCase();
  const alias = parseAlias(decodeURIComponent(url.pathname.slice(1)));
  if (!alias.ok || isAppHost(host)) return appNotFound(c);

  const supplied = c.req.method === 'POST' ? await suppliedPassword(c) : null;
  const res = await serveLink(c, { kind: 'host', host }, alias.value, supplied);
  if (res) return res;

  const config = await readShortDomainConfig(c.env.DB);
  return config.domains.includes(host) ? c.html(notFoundPage(`${host}/${alias.value}`), 404) : appNotFound(c);
});

app.all('*', (c) => appNotFound(c));

export default app;
