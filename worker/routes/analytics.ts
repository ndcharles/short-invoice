import { Hono } from 'hono';
import type { AppEnv } from '../env';

const analytics = new Hono<AppEnv>();

interface RollupRow {
  day: string;
  country: string;
  device: string;
  browser: string;
  os: string;
  referer: string;
  clicks: number;
}

const DAY_MS = 86_400_000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function relativeTime(ms: number | null): string {
  if (!ms) return 'No clicks yet';
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Sums `clicks` by one dimension, largest first. */
function tally(rows: RollupRow[], dim: keyof Omit<RollupRow, 'clicks'>): [string, number][] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row[dim], (totals.get(row[dim]) ?? 0) + row.clicks);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

const pct = (part: number, whole: number) => `${whole ? Math.round((part / whole) * 100) : 0}%`;

/**
 * Link analytics, read from the daily rollup. The whole range is fetched in a
 * single scan and broken down in memory, because D1 bills per row read and
 * one GROUP BY per dimension would read the same rows five times.
 */
analytics.get('/links', async (c) => {
  const days = c.req.query('range') === '7d' ? 7 : 30;
  const since = dayKey(Date.now() - (days - 1) * DAY_MS);
  const db = c.env.DB;

  const [summaryRes, rollupRes, topRes] = await db.batch([
    db.prepare(
      `SELECT COALESCE(SUM(clicks), 0) AS totalClicks, COUNT(*) AS activeLinks, MAX(last_clicked_at) AS lastClickedAt
       FROM links WHERE archived = 0`
    ),
    db
      .prepare(
        `SELECT day, country, device, browser, os, referer, SUM(clicks) AS clicks
         FROM link_clicks_daily WHERE day >= ?1
         GROUP BY day, country, device, browser, os, referer`
      )
      .bind(since),
    db.prepare('SELECT alias, dest, clicks, avatar, tag FROM links WHERE archived = 0 ORDER BY clicks DESC LIMIT 5'),
  ]);

  const summary = summaryRes.results[0] as { totalClicks: number; activeLinks: number; lastClickedAt: number | null };
  const rows = rollupRes.results as RollupRow[];
  const rangeClicks = rows.reduce((sum, r) => sum + r.clicks, 0);

  const byDay = new Map(tally(rows, 'day'));
  const timeSeries = [];
  for (let i = days - 1; i >= 0; i--) {
    const ms = Date.now() - i * DAY_MS;
    timeSeries.push({
      date: new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      clicks: byDay.get(dayKey(ms)) ?? 0,
    });
  }

  const countries = tally(rows, 'country');
  const topCountries = countries.slice(0, 4).map(([code, count]) => ({
    country: countryName(code),
    code,
    count,
    pct: pct(count, rangeClicks),
  }));
  const otherCountries = countries.slice(4).reduce((sum, [, n]) => sum + n, 0);
  if (otherCountries) {
    topCountries.push({ country: 'Others', code: 'OT', count: otherCountries, pct: pct(otherCountries, rangeClicks) });
  }

  const share = (dim: 'device' | 'browser' | 'os') =>
    tally(rows, dim).map(([name, n]) => ({ name, pct: pct(n, rangeClicks) }));

  return c.json({
    summary: {
      totalClicks: summary.totalClicks,
      // Approximation: there are no visitor ids, so distinct
      // day/country/device/browser/os combinations stand in for visitors.
      uniqueVisitors: new Set(rows.map((r) => `${r.day}|${r.country}|${r.device}|${r.browser}|${r.os}`)).size,
      activeLinks: summary.activeLinks,
      topReferrer: tally(rows, 'referer').find(([name]) => name !== 'Direct')?.[0] ?? 'Direct',
      lastClick: relativeTime(summary.lastClickedAt),
    },
    timeSeries,
    topLinks: topRes.results,
    topCountries,
    devices: share('device'),
    browsers: share('browser'),
    os: share('os'),
  });
});

export default analytics;
