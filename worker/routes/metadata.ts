import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { checkFetchUrl, readLimited } from '../lib/ssrf';
import { withinLimit } from '../lib/auth';

/**
 * Fetches Open Graph metadata for a destination URL so the link preview can
 * show the real title / description / image instead of a blank placeholder.
 * Results are kept in the Workers Cache API (free, per data centre) rather
 * than in a store with a write quota.
 */

export interface LinkMetadata {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const CACHE_TTL_S = 10 * 60;
const MAX_BYTES = 600_000;
const TIMEOUT_MS = 6000;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
    '#x27': "'",
    '#x2F': '/',
  };
  return value
    .replace(/&([a-zA-Z#0-9x]+);/g, (match, code: string) => named[code] ?? match)
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reads a <meta> value by property or name, in either attribute order. */
function metaValue(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const value = decodeEntities(match[1]);
        if (value) return value;
      }
    }
  }
  return null;
}

function resolveImage(image: string | null, base: string): string | null {
  if (!image) return null;
  try {
    const url = new URL(image, base);
    // Only web images: never javascript:, data: or file: addresses from someone else's page.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const MAX_REDIRECTS = 4;
const PREVIEWS_PER_10_MIN = 60;

/** Follows redirects by hand so every hop is checked, not just the first address. */
async function fetchPage(start: URL): Promise<{ res: Response; finalUrl: string } | { error: string; status: 400 | 502 }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const problem = checkFetchUrl(url);
    if (problem) return { error: problem, status: 400 };
    const res = await fetch(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      try {
        url = new URL(location, url);
      } catch {
        return { error: 'Bad redirect', status: 502 };
      }
      continue;
    }
    return { res, finalUrl: url.toString() };
  }
  return { error: 'Too many redirects', status: 502 };
}

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

  try {
    const page = await fetchPage(target);
    if ('error' in page) return c.json({ error: page.error }, page.status);
    const { res } = page;

    if (!res.ok) return c.json({ error: `Upstream responded ${res.status}` }, 502);
    if (!(res.headers.get('content-type') || '').includes('html')) {
      return c.json({ error: 'Destination is not HTML' }, 415);
    }
    const length = Number(res.headers.get('content-length') || 0);
    if (length && length > MAX_BYTES) return c.json({ error: 'Destination page is too large' }, 413);

    // Stop downloading at the cap, even if the server never says how big the page is.
    const html = await readLimited(res, MAX_BYTES);
    const finalUrl = page.finalUrl || key;
    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

    const data: LinkMetadata = {
      url: finalUrl,
      title: metaValue(html, ['og:title', 'twitter:title']) ?? (titleTag?.[1] ? decodeEntities(titleTag[1]) : null),
      description: metaValue(html, ['og:description', 'twitter:description', 'description']),
      image: resolveImage(metaValue(html, ['og:image', 'og:image:url', 'twitter:image']), finalUrl),
      siteName: metaValue(html, ['og:site_name']),
    };

    c.executionCtx.waitUntil(
      cache.put(cacheKey, Response.json(data, { headers: { 'cache-control': `max-age=${CACHE_TTL_S}` } }))
    );
    return c.json({ metadata: data });
  } catch (err) {
    const message = err instanceof Error && err.name === 'TimeoutError' ? 'Timed out' : 'Could not fetch destination';
    return c.json({ error: message }, 502);
  }
});

export default metadata;
