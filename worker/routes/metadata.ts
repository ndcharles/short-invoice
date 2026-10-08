import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { checkFetchUrl } from '../lib/ssrf';
import { fetchPageMeta, type LinkMetadata } from '../lib/page-meta';
import { withinLimit } from '../lib/auth';

/**
 * Fetches Open Graph metadata for a destination URL so the link preview can
 * show the real title / description / image instead of a blank placeholder.
 * Results are kept in the Workers Cache API (free, per data centre) rather
 * than in a store with a write quota.
 */

const CACHE_TTL_S = 10 * 60;
const PREVIEWS_PER_10_MIN = 60;

const metadata = new Hono<AppEnv>();

metadata.get('/', async (c) => {
  const raw = c.req.query('url');
  if (!raw) return c.json({ error: 'Missing url' }, 400);

  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return c.json({ error: 'Invalid url' }, 400);
  }
  const problem = checkFetchUrl(target);
  if (problem) return c.json({ error: problem }, 400);
  // This route fetches other sites for you, so it is limited per person.
  if (!(await withinLimit(c.env.DB, `preview:${c.var.user.email}`, PREVIEWS_PER_10_MIN, 10 * 60_000))) {
    return c.json({ error: 'Too many previews. Try again in a few minutes.' }, 429);
  }

  const key = target.toString();
  const cacheKey = new Request(`https://metadata.cache/${encodeURIComponent(key)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return c.json({ metadata: (await hit.json()) as LinkMetadata, cached: true });

  const result = await fetchPageMeta(target);
  if (!result.ok) return c.json({ error: result.error }, result.status);

  c.executionCtx.waitUntil(
    cache.put(cacheKey, Response.json(result.data, { headers: { 'cache-control': `max-age=${CACHE_TTL_S}` } }))
  );
  return c.json({ metadata: result.data });
});

export default metadata;
