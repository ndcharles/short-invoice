import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { NOT_CLOAKABLE, type CloakCheck } from '../../src/lib/links/cloak-check';
import { checkCloakable, knownSite } from './cloak-check';

/**
 * The cloak check as the API uses it: answers are kept in the Workers Cache API (free, no write quota,
 * like link-preview lookups), so turning the switch on and then saving asks the destination once, not twice.
 * Only real answers are kept; "could not tell" is tried again next time.
 */
const CACHE_TTL_S = 10 * 60;

export async function cloakCheckFor(c: Context<AppEnv>, dest: string, domain: string): Promise<CloakCheck> {
  let host = '';
  try {
    host = new URL(dest).hostname;
  } catch {
    /* checkCloakable reports an address it cannot read */
  }
  const listed = knownSite(host);
  if (listed) return listed;

  const key = new Request(`https://cloak-check.cache/${encodeURIComponent(`${domain}|${dest}`)}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as CloakCheck;

  // Looking at other sites is switched off together with the destination previews (DEST_PREVIEW_FETCH=off).
  const verdict = await checkCloakable(dest, domain, { fetch: c.env.DEST_PREVIEW_FETCH !== 'off' });
  if (verdict.status !== 'unknown') {
    c.executionCtx.waitUntil(cache.put(key, Response.json(verdict, { headers: { 'cache-control': `max-age=${CACHE_TTL_S}` } })));
  }
  return verdict;
}

/**
 * The error to send when a save would turn cloaking on (or point a cloaked link somewhere new) for a
 * destination that cannot be cloaked; null when it is fine, or when we could not tell.
 */
export async function cloakRefusal(c: Context<AppEnv>, dest: string, domain: string) {
  const verdict = await cloakCheckFor(c, dest, domain);
  if (verdict.status !== 'blocked') return null;
  return { error: NOT_CLOAKABLE, code: 'not_cloakable', detail: verdict.message };
}
