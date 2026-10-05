import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Full JSON backup of the workspace. Reads every row once, so it is meant
 * for an occasional manual download, not for polling. Click rollups are left
 * out (they can be large and are derived data); per-link totals are included.
 */
const exporter = new Hono<AppEnv>();

exporter.get('/', async (c) => {
  const db = c.env.DB;
  const [links, utms, invoices, folders, tags, settings] = await db.batch([
    db.prepare('SELECT * FROM links ORDER BY created_at'),
    db.prepare('SELECT * FROM utms ORDER BY created_at'),
    db.prepare('SELECT * FROM invoices ORDER BY issued_at'),
    db.prepare('SELECT * FROM folders ORDER BY created_at'),
    db.prepare('SELECT * FROM tags ORDER BY created_at'),
    db.prepare("SELECT key, value FROM settings WHERE key != 'domain_verify_token' ORDER BY key"),
  ]);
  const body = {
    exported_at: new Date().toISOString(),
    links: (links.results as Record<string, unknown>[]).map(({ password_hash, ...rest }) => ({ ...rest, has_password: !!password_hash })),
    utms: utms.results,
    invoices: invoices.results,
    folders: folders.results,
    tags: tags.results,
    settings: Object.fromEntries((settings.results as { key: string; value: string }[]).map((r) => [r.key, r.value])),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="export.json"' },
  });
});

export default exporter;
