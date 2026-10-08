/**
 * Link-preview (Open Graph) content resolution.
 * Custom overrides win, otherwise a sensible preview is derived from the
 * destination so the rail always shows a live preview while you type.
 */

export const OG_TITLE_MAX = 120;
export const OG_DESC_MAX = 240;

export interface OgContent {
  title: string;
  description: string;
  image: string | null;
  /** Domain line shown by social cards (destination domain, not the short link). */
  site?: string | null;
}

export interface OgSource {
  dest: string;
  alias: string;
  custom_preview?: number | boolean | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  /** Metadata fetched from the destination page, when available. */
  remote?: RemoteOg | null;
}

export interface RemoteOg {
  title?: string | null;
  description?: string | null;
  image?: string | null;
  siteName?: string | null;
}

function safeUrl(dest: string): URL | null {
  if (!dest) return null;
  try {
    return new URL(/^https?:\/\//i.test(dest) ? dest : `https://${dest}`);
  } catch {
    return null;
  }
}

/** `https://docs.google.com/document/d/abc` -> `docs.google.com/document/d/abc` */
export function prettyDest(dest: string): string {
  const url = safeUrl(dest);
  if (!url) return dest;
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.hostname.replace(/^www\./, '')}${path}`;
}

function titleCase(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Use the last readable path segment as a title when it looks like a real slug. */
function slugTitle(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean);
  const last = (segments[segments.length - 1] ?? '').replace(/\.[a-z0-9]{1,5}$/i, '');
  if (!last || last.length > 42) return null;
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(last)) return null;
  if (/^[0-9a-f]{16,}$/i.test(last)) return null;
  if (/^[A-Za-z0-9_-]{20,}$/.test(last)) return null;
  return titleCase(last);
}

export function defaultOg(dest: string, alias: string): OgContent {
  const url = safeUrl(dest);
  const host = url ? url.hostname.replace(/^www\./, '') : '';
  const title = (url && slugTitle(url)) || host || alias || 'Untitled link';
  const description = url
    ? `Shared from ${prettyDest(dest)}`
    : 'Add a destination URL to preview how this link will appear.';
  return { title, description, image: null, site: host || null };
}

/** Effective preview: custom overrides win, then destination metadata, then derived. */
export function resolveOg(source: OgSource): OgContent {
  const derived = defaultOg(source.dest, source.alias);
  const base: OgContent = source.remote
    ? {
        title: source.remote.title?.trim() || derived.title,
        description: source.remote.description?.trim() || derived.description,
        image: source.remote.image?.trim() || derived.image,
        site: source.remote.siteName?.trim() || derived.site,
      }
    : derived;

  if (!source.custom_preview) return base;

  return {
    title: source.og_title?.trim() || base.title,
    description: source.og_description?.trim() || base.description,
    image: source.og_image?.trim() || base.image,
    site: base.site,
  };
}

/** Ask our own API for the destination's Open Graph tags. */
export async function fetchOg(dest: string): Promise<RemoteOg | null> {
  const url = dest.trim();
  if (!url) return null;
  try {
    const res = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { metadata?: RemoteOg };
    return data.metadata ?? null;
  } catch {
    return null;
  }
}
