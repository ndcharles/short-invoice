/**
 * Short-domain model and short-URL building, shared by the Worker and the UI.
 *
 * A link belongs to one domain. Once that domain is attached to the Worker
 * (Cloudflare custom domain) and verified, the link is served at
 * `https://<domain>/<alias>`. Until then, links on the default domain are
 * served by the app itself at `<app origin>/s/<alias>`.
 */

export type DomainStatus = 'pending' | 'active';

export interface ShortDomain {
  id: string;
  name: string;
  status: DomainStatus;
  /** Epoch ms. */
  added: number;
  verified_at?: number | null;
}

/** Reads the `shortener_domains` setting, tolerating the older stored shape. */
export function parseDomains(value: string | undefined | null): ShortDomain[] {
  let list: unknown;
  try {
    list = JSON.parse(value || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: ShortDomain[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim().toLowerCase() : '';
    if (!name || out.some((d) => d.name === name)) continue;
    out.push({
      id: typeof item.id === 'string' ? item.id : `dom_${name}`,
      name,
      status: String(item.status).toLowerCase() === 'active' ? 'active' : 'pending',
      added: typeof item.added === 'number' ? item.added : 0,
      verified_at: typeof item.verified_at === 'number' ? item.verified_at : null,
    });
  }
  return out;
}

/** Every domain a link may use: the configured list plus the default. */
export function knownDomainNames(settings: Record<string, string | undefined> | null | undefined): string[] {
  const names = parseDomains(settings?.shortener_domains).map((d) => d.name);
  const fallback = settings?.default_domain?.trim().toLowerCase();
  return fallback && !names.includes(fallback) ? [fallback, ...names] : names;
}

export interface ShortUrlContext {
  /** Origin the app is served from, e.g. https://short-invoice.example.workers.dev */
  origin: string;
  defaultDomain: string;
  activeDomains: string[];
}

export function shortUrlContext(settings: Record<string, string> | null | undefined, origin: string): ShortUrlContext {
  return {
    origin,
    defaultDomain: (settings?.default_domain ?? '4th.link').toLowerCase(),
    activeDomains: parseDomains(settings?.shortener_domains)
      .filter((d) => d.status === 'active')
      .map((d) => d.name),
  };
}

/**
 * The URL that actually resolves for a link right now, and whether it does.
 * `live` is false for a link on a non-default domain that is not active yet.
 */
export function shortUrlFor(link: { domain: string; alias: string }, ctx: ShortUrlContext): { url: string; label: string; live: boolean } {
  const domain = link.domain.toLowerCase();
  if (ctx.activeDomains.includes(domain)) {
    return { url: `https://${domain}/${link.alias}`, label: `${domain}/${link.alias}`, live: true };
  }
  const url = `${ctx.origin}/s/${link.alias}`;
  const label = url.replace(/^https?:\/\//, '');
  return { url, label, live: domain === ctx.defaultDomain };
}
