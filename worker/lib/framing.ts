/**
 * Whether a browser will show a page inside a frame on another site, worked out from the page's own
 * response headers. A cloaked link shows its destination in a frame, and a destination that forbids
 * being framed shows nothing (Chrome draws its "refused to connect" face) instead of the page.
 *
 * Two headers decide it, and a page may send either or both:
 * - `Content-Security-Policy: frame-ancestors <sources>` lists who may frame the page. This is the
 *   current one, and when it is present browsers follow it and ignore X-Frame-Options.
 * - `X-Frame-Options: DENY | SAMEORIGIN` is the older one: nobody, or only the page's own site.
 *   `ALLOW-FROM` is no longer understood by any browser and is ignored, like any other value.
 * `Content-Security-Policy-Report-Only` never blocks, and a `<meta>` CSP cannot carry frame-ancestors,
 * so neither counts. Pure functions only (no fetching), so they can be checked against a real browser.
 */

export interface Framing {
  allowed: boolean;
  /** The header that decided it, or null when the page sends neither. */
  by: 'frame-ancestors' | 'x-frame-options' | null;
}

const DEFAULT_PORT: Record<string, string> = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21' };

/** CSP scheme matching: http: also covers https (a page that allows http may be framed from its https version). */
const schemeMatches = (source: string, actual: string) => source === actual || (source === 'http:' && actual === 'https:');

function portMatches(sourcePort: string | undefined, ancestor: URL): boolean {
  if (sourcePort === '*') return true;
  const actual = ancestor.port || DEFAULT_PORT[ancestor.protocol] || '';
  // No port in the source means the scheme's usual port only, not "any port".
  return (sourcePort || DEFAULT_PORT[ancestor.protocol]) === actual;
}

function hostMatches(sourceHost: string, ancestor: URL): boolean {
  if (sourceHost === '*') return true;
  const host = ancestor.hostname;
  if (!sourceHost.startsWith('*.')) return host === sourceHost;
  const suffix = sourceHost.slice(1); // ".example.com": any subdomain, never example.com itself
  return host.endsWith(suffix) && host.length > suffix.length;
}

const HOST_SOURCE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9._-]+)(?::(\*|\d+))?$/;

/**
 * One entry of a frame-ancestors list, tested against the page that would hold the frame (`ancestor`).
 * `frame` is the framed page itself, which is what 'self' means. Entries browsers reject as invalid (a source
 * with a path, 'none' next to other sources, nonces, hashes) are ignored, so they match nothing.
 */
function ancestorMatches(entry: string, ancestor: URL, frame: URL): boolean {
  const source = entry.toLowerCase();
  if (source === '*') return ancestor.protocol in DEFAULT_PORT; // any web address, but not data: and the like
  if (source === "'self'") return ancestor.origin === frame.origin;
  if (source.startsWith("'")) return false;

  const schemeOnly = /^([a-z][a-z0-9+.-]*):$/.exec(source);
  if (schemeOnly) return schemeMatches(`${schemeOnly[1]}:`, ancestor.protocol);

  const match = HOST_SOURCE.exec(source);
  if (!match) return false;
  const [, scheme, host, port] = match;
  // Without a scheme the source means "the framed page's own scheme" (and its https upgrade).
  const schemeOk = scheme ? schemeMatches(`${scheme}:`, ancestor.protocol) : schemeMatches(frame.protocol, ancestor.protocol);
  return schemeOk && hostMatches(host, ancestor) && portMatches(port, ancestor);
}

/** The frame-ancestors source list of each enforced policy that has one (a header can carry several policies, comma separated). */
function ancestorLists(headers: Headers): string[][] {
  const lists: string[][] = [];
  for (const policy of (headers.get('content-security-policy') ?? '').split(',')) {
    for (const directive of policy.split(';')) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      if (name?.toLowerCase() === 'frame-ancestors') {
        lists.push(sources.filter(Boolean)); // only the first one in a policy counts
        break;
      }
    }
  }
  return lists;
}

/**
 * Would a browser show the page that sent `headers` (at address `frame`) inside a frame on `ancestor`?
 * `ancestor` is the cloaked link's own address, for example https://trim.ng.
 */
export function framingAllowed(headers: Headers, ancestor: URL, frame: URL): Framing {
  const lists = ancestorLists(headers);
  if (lists.length > 0) {
    // Every policy has to be satisfied; an empty list is the same as 'none'.
    const allowed = lists.every((sources) => sources.some((entry) => ancestorMatches(entry, ancestor, frame)));
    return { allowed, by: 'frame-ancestors' };
  }

  const options = (headers.get('x-frame-options') ?? '').toLowerCase().split(',').map((value) => value.trim());
  // Two different values ("DENY, SAMEORIGIN") are treated as DENY by browsers; DENY anywhere in the list wins here too.
  if (options.includes('deny')) return { allowed: false, by: 'x-frame-options' };
  if (options.includes('sameorigin') && ancestor.origin !== frame.origin) return { allowed: false, by: 'x-frame-options' };
  return { allowed: true, by: options.some((value) => value === 'sameorigin') ? 'x-frame-options' : null };
}
