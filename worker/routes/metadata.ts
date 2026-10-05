import { Hono } from 'hono';
import type { AppEnv } from '../env';

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

/** Keep the fetcher from being pointed at the local network. */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  if (host === '::1' || host === '0.0.0.0') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

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
  if (image.startsWith('data:')) return null;
  try {
    return new URL(image, base).toString();
  } catch {
    return null;
  }
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
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return c.json({ error: 'Unsupported protocol' }, 400);
  }
  if (isBlockedHost(target.hostname)) return c.json({ error: 'Host not allowed' }, 400);

  const key = target.toString();
  const cacheKey = new Request(`https://metadata.cache/${encodeURIComponent(key)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return c.json({ metadata: (await hit.json()) as LinkMetadata, cached: true });

  try {
    const res = await fetch(key, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) return c.json({ error: `Upstream responded ${res.status}` }, 502);
    if (!(res.headers.get('content-type') || '').includes('html')) {
      return c.json({ error: 'Destination is not HTML' }, 415);
    }
    const length = Number(res.headers.get('content-length') || 0);
    if (length && length > MAX_BYTES) return c.json({ error: 'Destination page is too large' }, 413);

    const html = (await res.text()).slice(0, MAX_BYTES);
    const finalUrl = res.url || key;
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
