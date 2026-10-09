import { checkFetchUrl, readLimited } from './ssrf';

/**
 * Reads another site's own title, description and image (Open Graph tags, falling back to
 * Twitter tags and the plain <title>). Used by the link-preview lookup in the editor and by
 * cloaked links, which show the destination's details. Every fetch goes through the SSRF guard.
 */

export interface LinkMetadata {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const MAX_BYTES = 600_000;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
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

/** The details a page's own HTML gives about itself. `finalUrl` is where the page really lives (after redirects). */
export function parsePageMeta(html: string, finalUrl: string): LinkMetadata {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    url: finalUrl,
    title: metaValue(html, ['og:title', 'twitter:title']) ?? (titleTag?.[1] ? decodeEntities(titleTag[1]) || null : null),
    description: metaValue(html, ['og:description', 'twitter:description', 'description']),
    image: resolveImage(metaValue(html, ['og:image', 'og:image:url', 'twitter:image']), finalUrl),
    siteName: metaValue(html, ['og:site_name']),
  };
}

/** Follows redirects by hand so every hop is checked, not just the first address. */
export async function fetchPage(start: URL, timeoutMs: number): Promise<{ res: Response; finalUrl: string } | { error: string; status: 400 | 502 }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const problem = checkFetchUrl(url);
    if (problem) return { error: problem, status: 400 };
    const res = await fetch(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
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

export type PageMetaResult = { ok: true; data: LinkMetadata } | { ok: false; error: string; status: 400 | 413 | 415 | 502 };

/** Fetches a page and reads its details. Never throws; the reason for a failure comes back with an HTTP-style status. */
export async function fetchPageMeta(target: URL, timeoutMs = TIMEOUT_MS): Promise<PageMetaResult> {
  try {
    const page = await fetchPage(target, timeoutMs);
    if ('error' in page) return { ok: false, error: page.error, status: page.status };
    const { res } = page;

    if (!res.ok) return { ok: false, error: `Upstream responded ${res.status}`, status: 502 };
    if (!(res.headers.get('content-type') || '').includes('html')) return { ok: false, error: 'Destination is not HTML', status: 415 };
    const length = Number(res.headers.get('content-length') || 0);
    if (length && length > MAX_BYTES) return { ok: false, error: 'Destination page is too large', status: 413 };

    // Stop downloading at the cap, even if the server never says how big the page is.
    const html = await readLimited(res, MAX_BYTES);
    return { ok: true, data: parsePageMeta(html, page.finalUrl || target.toString()) };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === 'TimeoutError' ? 'Timed out' : 'Could not fetch destination', status: 502 };
  }
}
