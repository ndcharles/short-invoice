import type { CloakCheck } from '../../src/lib/links/cloak-check';
import { framingAllowed } from './framing';
import { fetchPage } from './page-meta';

/**
 * Can this destination be shown inside a cloaked link? A cloaked link shows the destination in a frame on
 * the short link's own address; a site that forbids being framed gives visitors a blank page instead.
 *
 * Two ways to know:
 * 1. Ask the site. Its response headers say whether it may be framed (see framing.ts), and that is what the
 *    browser will go by. Sites that sit behind a bot challenge turn this check away, and then we can only say
 *    "could not tell" (cloaking is allowed, as it always was).
 * 2. A short list of sites known not to work, for the cases headers cannot tell us about.
 */

const withoutWww = (host: string) => host.replace(/^www\./, '');
const unknown = (why: 'not-checked' | 'unreachable' | 'turned-away'): CloakCheck => ({ status: 'unknown', why });

const NO_FRAMES = (host: string) => `${host} doesn't allow other sites to show its pages, so visitors would see a blank page.`;
const MEETING = "Zoom meetings need your camera and microphone, which a cloaked page doesn't pass on, so visitors couldn't join.";

/**
 * Sites that cannot be cloaked even where their headers do not say so, or where a bot challenge hides the headers.
 * Add a site only when you have seen it fail in a real browser. A host here covers its subdomains too.
 * - Zoom: the meeting page itself loads in a frame (Chrome shows it), but a call needs the camera and microphone and
 *   the cloak page's frame is given neither (and we do not hand them to other sites). Zoom sends no frame rule in
 *   its headers, so nothing else would catch it. zoomgov.com is its government cloud, the same pages; it answers
 *   bots with a challenge, so it could not be looked at directly.
 * - Claude: its pages forbid framing (frame-ancestors 'self'), but the home page answers our check with a bot challenge.
 */
const KNOWN_SITES: { host: string; why?: string }[] = [
  { host: 'zoom.us', why: MEETING },
  { host: 'zoomgov.com', why: MEETING },
  { host: 'claude.ai' },
];

/** A verdict from the list alone (no request), or null when the site is not on it. */
export function knownSite(hostname: string): CloakCheck | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const found = KNOWN_SITES.find((site) => host === site.host || host.endsWith(`.${site.host}`));
  if (!found) return null;
  return { status: 'blocked', host: withoutWww(host), reason: 'known-site', message: found.why ?? NO_FRAMES(withoutWww(host)) };
}

const CHECK_TIMEOUT_MS = 4000;

/**
 * Works out whether `dest` can be cloaked on the short domain `parentHost`.
 * Never throws. `fetch: false` skips asking the site (only the known-sites list is used).
 */
export async function checkCloakable(
  dest: string,
  parentHost: string,
  opts: { fetch: boolean; timeoutMs?: number }
): Promise<CloakCheck> {
  let target: URL;
  let ancestor: URL;
  try {
    target = new URL(dest);
    ancestor = new URL(`https://${parentHost}`);
  } catch {
    return unknown('not-checked');
  }
  const listed = knownSite(target.hostname);
  if (listed) return listed;
  if (!opts.fetch) return unknown('not-checked');

  // What the frame really loads: on https, the cloak page asks for the https version of an http address (see cloak.ts).
  if (target.protocol === 'http:') target.protocol = 'https:';

  try {
    const page = await fetchPage(target, opts.timeoutMs ?? CHECK_TIMEOUT_MS);
    if ('error' in page) return unknown(page.status === 400 ? 'not-checked' : 'unreachable');
    const { res, finalUrl } = page;
    await res.body?.cancel().catch(() => undefined); // only the headers matter

    // A refusal or a challenge describes the check, not the page a visitor would get; its headers prove nothing.
    if (res.headers.has('cf-mitigated') || res.status === 401 || res.status === 403 || res.status === 429) return unknown('turned-away');
    if (!res.ok) return unknown('unreachable');

    const final = new URL(finalUrl);
    // The address may be a shortener or a redirect that ends somewhere on the list.
    const landed = knownSite(final.hostname);
    if (landed) return landed;

    const framing = framingAllowed(res.headers, ancestor, final);
    if (framing.allowed) return { status: 'ok' };
    const host = withoutWww(target.hostname);
    return { status: 'blocked', host, reason: framing.by === 'frame-ancestors' ? 'frame-ancestors' : 'frame-options', message: NO_FRAMES(host) };
  } catch {
    return unknown('unreachable');
  }
}
