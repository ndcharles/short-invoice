import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getSettings } from '../lib/settings';
import { activity } from '../lib/activity';
import { isAppHost, parseDomains } from '../lib/domains';
import { readJsonObject } from '../lib/request';
import { parseHostname } from '../../src/lib/validate';
import type { ShortDomain } from '../../src/lib/short-url';

/**
 * Short-link domains. The list lives in the `shortener_domains` setting and is
 * only changed through these endpoints (the generic settings PATCH ignores it),
 * so a stale settings form can never overwrite a verification result.
 *
 * Attaching a domain to the Worker happens in the Cloudflare dashboard. Proof
 * that it reaches this deployment: any request for
 * `https://<domain>/.well-known/short-invoice` that arrives here through that
 * domain marks it verified (`markVerifiedByHost`); the Settings page triggers
 * one from the browser. A Worker cannot fetch its own custom domain (Cloudflare
 * sends such loops to the origin, which a Worker domain lacks: HTTP 523), so
 * the server-side fetch below only helps for domains served elsewhere and in tests.
 */
const domains = new Hono<AppEnv>();

export const VERIFY_PATH = '/.well-known/short-invoice';
const TOKEN_KEY = 'domain_verify_token';

async function writeDomains(db: D1Database, list: ShortDomain[]) {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('shortener_domains', ?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(JSON.stringify(list), Date.now())
    .run();
}

async function state(db: D1Database) {
  const settings = await getSettings(db);
  const list = parseDomains(settings.shortener_domains);
  const counts = await db
    .prepare('SELECT domain, COUNT(*) AS links FROM links GROUP BY domain')
    .all<{ domain: string; links: number }>();
  const linkCount = new Map(counts.results.map((r) => [r.domain, r.links]));
  return {
    settings,
    list,
    body: {
      domains: list.map((d) => ({ ...d, links: linkCount.get(d.name) ?? 0, is_default: d.name === settings.default_domain })),
      default_domain: settings.default_domain,
      verify_path: VERIFY_PATH,
    },
  };
}

/** Returns this install's token, creating it on first use. */
export async function verifyToken(db: D1Database): Promise<string> {
  const fresh = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO NOTHING`)
    .bind(TOKEN_KEY, fresh, Date.now())
    .run();
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(TOKEN_KEY).first<{ value: string }>();
  return row?.value ?? fresh;
}

/** Marks a pending domain verified when a request reached this Worker through it. */
export async function markVerifiedByHost(db: D1Database, host: string): Promise<boolean> {
  const { list } = await state(db);
  const domain = list.find((d) => d.name === host);
  if (!domain || domain.status === 'active') return false;
  domain.status = 'active';
  domain.verified_at = Date.now();
  await writeDomains(db, list);
  return true;
}

domains.get('/', async (c) => c.json((await state(c.env.DB)).body));

domains.post('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const name = parseHostname(body.name);
  if (!name.ok) return c.json({ error: name.error }, 400);
  if (isAppHost(name.value)) return c.json({ error: 'That is the app host, not a short-link domain.' }, 400);

  const { list } = await state(c.env.DB);
  if (list.some((d) => d.name === name.value)) return c.json({ error: `${name.value} is already added` }, 409);
  if (list.length >= 20) return c.json({ error: 'You can add up to 20 domains' }, 400);

  list.push({ id: `dom_${crypto.randomUUID().slice(0, 8)}`, name: name.value, status: 'pending', added: Date.now(), verified_at: null });
  await writeDomains(c.env.DB, list);
  await activity(c.env.DB, c.var.user, { action: 'added', type: 'domain', label: name.value }).run();
  return c.json((await state(c.env.DB)).body, 201);
});

domains.post('/:name/verify', async (c) => {
  const db = c.env.DB;
  const { list } = await state(db);
  const domain = list.find((d) => d.name === c.req.param('name'));
  if (!domain) return c.json({ error: 'Domain not found' }, 404);
  // Already proven by a request that came in through the domain itself.
  const alreadyActive = domain.status === 'active' && typeof domain.verified_at === 'number';

  const token = await verifyToken(db);
  // Tests point this at the local Worker; production always uses https://<domain>.
  const origin = c.env.DOMAIN_CHECK_ORIGIN || `https://${domain.name}`;
  let verified = false;
  let reason = '';
  try {
    const res = await fetch(`${origin}${VERIFY_PATH}`, {
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    const data = res.ok ? ((await res.json().catch(() => null)) as { token?: string } | null) : null;
    verified = data?.token === token;
    if (!verified) {
      reason = res.ok
        ? `${domain.name} answers, but not from this app. Attach it to this Worker under Settings → Domains & Routes.`
        : `${domain.name} is not answering for this app yet. Attach it under Workers → short-invoice → Settings → Domains & Routes; new domains can take a few minutes to start working.`;
    }
  } catch {
    reason = `Could not reach ${domain.name} yet. Attach it under Workers → short-invoice → Settings → Domains & Routes; new domains can take a few minutes to start working.`;
  }
  verified = verified || alreadyActive;

  domain.status = verified ? 'active' : 'pending';
  domain.verified_at = verified ? domain.verified_at ?? Date.now() : null;
  await writeDomains(db, list);
  await activity(db, c.var.user, { action: verified ? 'verified' : 'verify failed', type: 'domain', label: domain.name }).run();
  const body = (await state(db)).body;
  // A failed check is a normal outcome, not an error: 200 with verified: false.
  return c.json({ ...body, verified, reason: verified ? null : reason });
});

domains.post('/:name/default', async (c) => {
  const db = c.env.DB;
  const { list } = await state(db);
  const domain = list.find((d) => d.name === c.req.param('name'));
  if (!domain) return c.json({ error: 'Domain not found' }, 404);
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('default_domain', ?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(domain.name, Date.now())
    .run();
  await activity(db, c.var.user, { action: 'made default', type: 'domain', label: domain.name }).run();
  return c.json((await state(db)).body);
});

domains.delete('/:name', async (c) => {
  const db = c.env.DB;
  const { list, settings, body } = await state(db);
  const name = c.req.param('name');
  const domain = body.domains.find((d) => d.name === name);
  if (!domain) return c.json({ error: 'Domain not found' }, 404);
  if (name === settings.default_domain) {
    return c.json({ error: 'This is the default domain. Make another domain the default first.' }, 409);
  }
  if (domain.links > 0) {
    return c.json({ error: `${domain.links} link(s) still use ${name}. Move or delete them first.` }, 409);
  }
  await writeDomains(db, list.filter((d) => d.name !== name));
  await activity(db, c.var.user, { action: 'removed', type: 'domain', label: name }).run();
  return c.json((await state(db)).body);
});

export default domains;
