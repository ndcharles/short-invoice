import { parseHttpUrl } from '../../src/lib/validate';
import type { RemoteOg } from '../../src/lib/og';
import { fetchPageMeta } from './page-meta';

/**
 * Every link remembers what its destination says about itself: its own title, description and image.
 * A cloaked link shows them (unless the owner wrote their own) and the editor's preview starts from them.
 * The destination is not fetched on every click or every time the editor opens: what it said is kept on
 * the link (`links.dest_meta`), fetched in the background after a save or a visit, and refreshed from time to time.
 */

export interface DestPreview {
  /** ok: fetched fine. failed: the last try did not work. pending: a fetch is under way. */
  state: 'ok' | 'failed' | 'pending';
  /** When the last attempt started or finished. */
  at: number;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  siteName?: string | null;
}

const DAY = 86_400_000;
/** A good copy is used for a week before it is looked at again. */
export const REFRESH_AFTER_MS = 7 * DAY;
/** After a failure, try again no sooner than this (so a broken site is not hit on every click). */
export const RETRY_AFTER_MS = 60 * 60_000;
/** A fetch that never reported back (the Worker was cut off) is forgotten after this. */
export const PENDING_FOR_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;

const STATES = new Set(['ok', 'failed', 'pending']);

export function readPreview(raw: string | null | undefined): DestPreview | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as DestPreview;
    return value && STATES.has(value.state) && Number.isFinite(value.at) ? value : null;
  } catch {
    return null;
  }
}

/** Whether it is time to fetch again (or for the first time). */
export function previewIsStale(preview: DestPreview | null, now = Date.now()): boolean {
  if (!preview) return true;
  const age = now - preview.at;
  if (preview.state === 'pending') return age > PENDING_FOR_MS;
  return age > (preview.state === 'ok' ? REFRESH_AFTER_MS : RETRY_AFTER_MS);
}

const clip = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

/**
 * What the page and the social tags should treat as the destination's own details, or null when there
 * are none yet. Details from an earlier good fetch stay in use while a refresh runs or after a failed one.
 */
export function remoteFrom(preview: DestPreview | null): RemoteOg | null {
  if (!preview) return null;
  const image = preview.image ? parseHttpUrl(preview.image, 'Image') : null; // re-checked: only web images are ever used
  const remote: RemoteOg = {
    title: clip(preview.title, 200),
    description: clip(preview.description, 500),
    image: image?.ok ? image.value : null,
    siteName: clip(preview.siteName, 100),
  };
  return remote.title || remote.description || remote.image || remote.siteName ? remote : null;
}

/**
 * Fetches the destination's details and stores them on the link. Safe to call from many places at once:
 * the first caller claims the job by swapping the stored value (compare-and-swap), and everyone else
 * returns at once. The result is only saved if the link still points at the same destination.
 */
export async function refreshPreview(
  db: D1Database,
  link: { id: string; dest: string; dest_meta: string | null },
  now = Date.now(),
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<void> {
  const before = readPreview(link.dest_meta);
  const pending: DestPreview = { ...before, state: 'pending', at: now };
  const claim = await db
    .prepare('UPDATE links SET dest_meta = ?1 WHERE id = ?2 AND dest = ?3 AND dest_meta IS ?4')
    .bind(JSON.stringify(pending), link.id, link.dest, link.dest_meta)
    .run();
  if (!claim.meta.changes) return; // someone else is on it, or the link has changed

  let result: DestPreview;
  try {
    const found = await fetchPageMeta(new URL(link.dest), timeoutMs);
    result = found.ok
      ? {
          state: 'ok',
          at: Date.now(),
          title: clip(found.data.title, 200),
          description: clip(found.data.description, 500),
          image: found.data.image,
          siteName: clip(found.data.siteName, 100),
        }
      : { ...before, state: 'failed', at: Date.now() };
  } catch {
    result = { ...before, state: 'failed', at: Date.now() };
  }
  await db
    .prepare('UPDATE links SET dest_meta = ?1 WHERE id = ?2 AND dest = ?3')
    .bind(JSON.stringify(result), link.id, link.dest)
    .run();
}

/**
 * After a save, a visit or the editor opening the link: if its destination details are missing or out of
 * date, fetch them in the background (after the response has gone out). Does nothing while they are fresh,
 * and nothing when DEST_PREVIEW_FETCH is "off".
 */
export function scheduleRefresh(
  env: { DB: D1Database; DEST_PREVIEW_FETCH?: string },
  ctx: { waitUntil(promise: Promise<unknown>): void },
  link: { id: string; dest: string; dest_meta?: string | null }
): void {
  if (env.DEST_PREVIEW_FETCH === 'off') return;
  if (!previewIsStale(readPreview(link.dest_meta))) return;
  ctx.waitUntil(refreshPreview(env.DB, { id: link.id, dest: link.dest, dest_meta: link.dest_meta ?? null }).catch((err) => console.error('preview refresh failed', err)));
}

/** What the editor is given about the stored copy: only the destination's own details and how current they are. */
export interface PreviewSummary {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  state: DestPreview['state'];
  /** When this was last tried (epoch ms). */
  fetched_at: number;
}

export function summaryOf(preview: DestPreview | null): PreviewSummary | null {
  const remote = remoteFrom(preview);
  if (!preview || !remote) return null;
  return {
    title: remote.title ?? null,
    description: remote.description ?? null,
    image: remote.image ?? null,
    siteName: remote.siteName ?? null,
    state: preview.state,
    fetched_at: preview.at,
  };
}
