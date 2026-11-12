import { browserOf, deviceOf, osOf, refererHost } from './ua';

/**
 * Click counting for short links. A click never slows or blocks the redirect: everything here runs after the
 * response is sent. What it guards is the database, which on the free plan allows a fixed number of row writes
 * a day, shared with sign-in and every save in the app.
 *
 *  - A busy link is counted by sample (one click in SAMPLE_ONE_IN, weighted), so a viral link or a flood uses a
 *    tenth of the writes while totals and shares stay close to true.
 *  - A link keeps at most ROWS_PER_LINK_DAY breakdown rows a day; further new combinations go into one "Other"
 *    row, so made-up referrers cannot grow the table without limit. Totals stay exact.
 *  - Breakdown older than KEEP_DETAIL_DAYS is folded into one total per link per day (compactOldClicks).
 */

/** Breakdown rows one link may add in a day before new combinations are counted under "Other". */
export const ROWS_PER_LINK_DAY = 300;
/** A busy link records one click in this many, counted as this many. */
export const SAMPLE_ONE_IN = 10;
/** Analytics looks back 90 days plus the period before it; older rows keep only their daily totals. */
export const KEEP_DETAIL_DAYS = 180;
/** Days folded per daily run, oldest first, so one run never does a large amount of work. */
const COMPACT_DAYS_PER_RUN = 3;

/** The row that holds a link's clicks for a day once their breakdown is no longer kept. `device` marks it. */
export const OTHER = { country: 'XX', device: 'Other', browser: 'Other', os: 'Other', referer: 'Other' } as const;

/** Workers Rate Limiting binding (wrangler.jsonc `ratelimits`). Counts are approximate and per Cloudflare location. */
export interface ClickLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** True once a link is getting more clicks than the limiter allows. Without the binding, never. */
export async function linkIsBusy(limiter: ClickLimiter | undefined, linkId: string): Promise<boolean> {
  if (!limiter) return false;
  try {
    return !(await limiter.limit({ key: linkId })).success;
  } catch {
    return false; // counting exactly is the safe fallback
  }
}

/** How many clicks this one is recorded as: 1 normally; on a busy link, SAMPLE_ONE_IN for one in SAMPLE_ONE_IN and 0 otherwise. */
export function clickWeight(busy: boolean, roll = Math.random()): number {
  if (!busy) return 1;
  return roll < 1 / SAMPLE_ONE_IN ? SAMPLE_ONE_IN : 0;
}

export interface Click {
  linkId: string;
  now: number;
  /** ISO country code from Cloudflare; anything else is stored as unknown. */
  country: string;
  userAgent: string;
  referer: string | null;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The two writes for one counted click: the link's total, and its row in the daily breakdown. */
export function clickStatements(db: D1Database, click: Click, weight = 1): D1PreparedStatement[] {
  const country = /^[A-Z][A-Z0-9]$/.test(click.country) ? click.country : OTHER.country;
  return [
    db.prepare('UPDATE links SET clicks = clicks + ?1, last_clicked_at = ?2 WHERE id = ?3').bind(weight, click.now, click.linkId),
    // A combination the link already has today is always counted as itself. A new one is added only while the
    // link has fewer than ROWS_PER_LINK_DAY rows for the day (the OFFSET probe reads at most that many rows);
    // after that it is counted in the "Other" row.
    db
      .prepare(
        `INSERT INTO link_clicks_daily (link_id, day, country, device, browser, os, referer, clicks)
         SELECT ?1, ?2,
           CASE WHEN room.ok THEN ?3 ELSE '${OTHER.country}' END,
           CASE WHEN room.ok THEN ?4 ELSE '${OTHER.device}' END,
           CASE WHEN room.ok THEN ?5 ELSE '${OTHER.browser}' END,
           CASE WHEN room.ok THEN ?6 ELSE '${OTHER.os}' END,
           CASE WHEN room.ok THEN ?7 ELSE '${OTHER.referer}' END,
           ?8
         FROM (SELECT (
           EXISTS (SELECT 1 FROM link_clicks_daily
                   WHERE link_id = ?1 AND day = ?2 AND country = ?3 AND device = ?4 AND browser = ?5 AND os = ?6 AND referer = ?7)
           OR NOT EXISTS (SELECT 1 FROM link_clicks_daily WHERE link_id = ?1 AND day = ?2 LIMIT 1 OFFSET ?9)
         ) AS ok) AS room
         WHERE true
         ON CONFLICT DO UPDATE SET clicks = clicks + excluded.clicks`
      )
      .bind(
        click.linkId,
        dayOf(click.now),
        country,
        deviceOf(click.userAgent),
        browserOf(click.userAgent),
        osOf(click.userAgent),
        refererHost(click.referer),
        weight,
        ROWS_PER_LINK_DAY - 1
      ),
  ];
}

/**
 * Folds breakdown rows older than KEEP_DETAIL_DAYS into one total per link per day. Runs from the daily cron;
 * each run handles the few oldest days still holding detail, so it catches up gradually and stays cheap.
 * Returns the days it folded.
 */
export async function compactOldClicks(db: D1Database, now = Date.now()): Promise<string[]> {
  const cutoff = dayOf(now - KEEP_DETAIL_DAYS * 86_400_000);
  const { results } = await db
    .prepare(`SELECT DISTINCT day FROM link_clicks_daily WHERE day < ?1 AND device != '${OTHER.device}' ORDER BY day LIMIT ?2`)
    .bind(cutoff, COMPACT_DAYS_PER_RUN)
    .all<{ day: string }>();
  const days = results.map((r) => r.day);
  if (!days.length) return days;
  // One batch is one transaction, so a day's detail is only removed together with its total being written.
  await db.batch(
    days.flatMap((day) => [
      db
        .prepare(
          `INSERT INTO link_clicks_daily (link_id, day, country, device, browser, os, referer, clicks)
           SELECT link_id, day, '${OTHER.country}', '${OTHER.device}', '${OTHER.browser}', '${OTHER.os}', '${OTHER.referer}', SUM(clicks)
           FROM link_clicks_daily WHERE day = ?1 AND device != '${OTHER.device}'
           GROUP BY link_id, day
           ON CONFLICT DO UPDATE SET clicks = clicks + excluded.clicks`
        )
        .bind(day),
      db.prepare(`DELETE FROM link_clicks_daily WHERE day = ?1 AND device != '${OTHER.device}'`).bind(day),
    ])
  );
  return days;
}
