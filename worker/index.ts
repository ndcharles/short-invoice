import { Hono } from 'hono';
import type { AppEnv } from './env';
import links from './routes/links';
import utms from './routes/utms';
import invoices from './routes/invoices';
import collections from './routes/collections';
import settings from './routes/settings';
import metadata from './routes/metadata';
import analytics from './routes/analytics';
import redirect from './routes/redirect';

/**
 * Only /api/* and /s/* reach this Worker (see `run_worker_first` in
 * wrangler.jsonc). Every other path is a static file from the Next.js export,
 * served by Workers Static Assets, which is free and does not count
 * against the daily request quota.
 */
const app = new Hono<AppEnv>();

app.route('/api/links', links);
app.route('/api/utms', utms);
app.route('/api/invoices', invoices);
app.route('/api/collections', collections);
app.route('/api/settings', settings);
app.route('/api/metadata', metadata);
app.route('/api/analytics', analytics);
app.route('/s', redirect);

app.get('/api/health', (c) => c.json({ ok: true }));
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.path} failed`, err);
  return c.json({ error: 'Internal error' }, 500);
});

// Anything else that reaches the Worker is handed back to static assets.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
