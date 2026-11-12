import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  KEEP_DETAIL_DAYS, OTHER, ROWS_PER_LINK_DAY, SAMPLE_ONE_IN, clickStatements, clickWeight, compactOldClicks, linkIsBusy, type Click,
} from '../../worker/lib/click-log';
import { refererHost } from '../../worker/lib/ua';

/** Just enough of D1 over real SQLite to run the statements exactly as the Worker does. */
function d1(db: DatabaseSync) {
  const statement = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { sql: string; args: unknown[] }[]) => {
      db.exec('BEGIN');
      try {
        for (const s of list) db.prepare(s.sql).run(...(s.args as never[]));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return [];
    },
  } as unknown as D1Database;
}

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 9);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari';

let sqlite: DatabaseSync;
let db: D1Database;
const rows = (where = '1') => sqlite.prepare(`SELECT * FROM link_clicks_daily WHERE ${where} ORDER BY day, referer`).all() as Record<string, string | number>[];
const total = (linkId = 'lnk_1') => Number((sqlite.prepare('SELECT clicks FROM links WHERE id = ?').get(linkId) as { clicks: number }).clicks);
const rollupTotal = (where = '1') => Number((sqlite.prepare(`SELECT COALESCE(SUM(clicks), 0) AS n FROM link_clicks_daily WHERE ${where}`).get() as { n: number }).n);

async function click(over: Partial<Click> = {}, weight = 1) {
  await db.batch(clickStatements(db, { linkId: 'lnk_1', now: NOW, country: 'NG', userAgent: CHROME, referer: null, ...over }, weight));
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  // Same definition as migrations/0001_init.sql.
  sqlite.exec(`CREATE TABLE link_clicks_daily (
    link_id TEXT NOT NULL, day TEXT NOT NULL, country TEXT NOT NULL, device TEXT NOT NULL, browser TEXT NOT NULL,
    os TEXT NOT NULL, referer TEXT NOT NULL, clicks INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (link_id, day, country, device, browser, os, referer)
  ) WITHOUT ROWID`);
  sqlite.exec('CREATE INDEX idx_clicks_daily_day ON link_clicks_daily (day)');
  sqlite.exec('CREATE TABLE links (id TEXT PRIMARY KEY, clicks INTEGER NOT NULL DEFAULT 0, last_clicked_at INTEGER)');
  sqlite.exec("INSERT INTO links (id) VALUES ('lnk_1'), ('lnk_2')");
  db = d1(sqlite);
});

describe('where a click came from', () => {
  it.each([
    [null, 'Direct'],
    ['', 'Direct'],
    ['not a url', 'Direct'],
    ['https://news.example.org/item?id=1', 'news.example.org'],
    ['https://WWW.Example.COM/a', 'example.com'],
    ['https://l.instagram.com/', 'l.instagram.com'],
    ['http://203.0.113.7/page', '203.0.113.7'],
    ['android-app://com.example.app/', 'com.example.app'],
    ['https://localhost/x', 'Other'],
    ['https://[2001:db8::1]/x', 'Other'],
    [`https://${'a'.repeat(64)}.example/`, 'Other'],
    [`https://${Array.from({ length: 30 }, () => 'abcd').join('.')}.example/`, 'Other'],
    ['https://xn--bcher-kva.example/', 'xn--bcher-kva.example'],
  ])('%j is recorded as %s', (referer, host) => expect(refererHost(referer)).toBe(host));

  it('never stores more than 100 characters', () => {
    for (const n of [10, 60, 300, 4000]) {
      const label = 'a'.repeat(Math.min(n, 63));
      const host = refererHost(`https://${Array.from({ length: Math.ceil(n / 64) }, () => label).join('.')}.example/`);
      expect(host.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('counting a click', () => {
  it('adds to the link total and to one breakdown row per combination', async () => {
    await click({ referer: 'https://news.example.org/a' });
    await click({ referer: 'https://news.example.org/b' });
    await click({ userAgent: IPHONE });
    expect(total()).toBe(3);
    expect(rows()).toEqual([
      expect.objectContaining({ day: '2026-11-12', country: 'NG', device: 'Mobile', browser: 'Safari', os: 'iOS', referer: 'Direct', clicks: 1 }),
      expect.objectContaining({ device: 'Desktop', browser: 'Chrome', os: 'Windows', referer: 'news.example.org', clicks: 2 }),
    ]);
  });

  it('stores an unknown or odd country as unknown', async () => {
    for (const country of ['', 'Nigeria', 'ng', "N'G", 'T1']) await click({ country });
    expect(rows().map((r) => [r.country, r.clicks])).toEqual([['T1', 1], ['XX', 4]]);
  });

  it('a link keeps a bounded number of breakdown rows a day, with every click still counted', async () => {
    const flood = ROWS_PER_LINK_DAY + 50;
    for (let i = 0; i < flood; i++) await click({ referer: `https://site-${i}.example/` });
    // A combination seen before the limit keeps counting as itself; a new one after it goes to "Other".
    await click({ referer: 'https://site-0.example/' });
    await click({ referer: 'https://brand-new.example/' });

    const mine = rows("link_id = 'lnk_1'");
    expect(mine.length).toBe(ROWS_PER_LINK_DAY + 1);
    expect(mine.find((r) => r.referer === 'site-0.example')?.clicks).toBe(2);
    expect(mine.find((r) => r.device === OTHER.device)).toMatchObject({ ...OTHER, clicks: 51 });
    expect(total()).toBe(flood + 2);
    expect(rollupTotal("link_id = 'lnk_1'")).toBe(flood + 2);
  });

  it('the limit is per link and per day', async () => {
    for (let i = 0; i < ROWS_PER_LINK_DAY; i++) await click({ referer: `https://site-${i}.example/` });
    await click({ linkId: 'lnk_2', referer: 'https://other-link.example/' });
    await click({ now: NOW + DAY_MS, referer: 'https://next-day.example/' });
    expect(rows("link_id = 'lnk_2'").map((r) => r.referer)).toEqual(['other-link.example']);
    expect(rows("day = '2026-11-13'").map((r) => r.referer)).toEqual(['next-day.example']);
  });
});

describe('busy links are counted by sample', () => {
  it('counts every click on a quiet link and one in ten, as ten, on a busy one', () => {
    expect(clickWeight(false, 0.99)).toBe(1);
    expect(clickWeight(true, 0.05)).toBe(SAMPLE_ONE_IN);
    expect(clickWeight(true, 0.5)).toBe(0);
  });

  it('keeps the total close to the truth over many clicks', () => {
    let counted = 0;
    let seed = 42;
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
    for (let i = 0; i < 20_000; i++) counted += clickWeight(true, random());
    expect(counted).toBeGreaterThan(19_000);
    expect(counted).toBeLessThan(21_000);
  });

  it('a sampled click adds its whole weight to the total and the breakdown', async () => {
    await click({}, SAMPLE_ONE_IN);
    expect(total()).toBe(SAMPLE_ONE_IN);
    expect(rows()[0].clicks).toBe(SAMPLE_ONE_IN);
  });

  it('a link is busy only when the limiter says so; without one, or if it fails, clicks are counted exactly', async () => {
    const seen: string[] = [];
    const limiter = (success: boolean) => ({ limit: async ({ key }: { key: string }) => (seen.push(key), { success }) });
    expect(await linkIsBusy(limiter(true), 'lnk_1')).toBe(false);
    expect(await linkIsBusy(limiter(false), 'lnk_1')).toBe(true);
    expect(seen).toEqual(['lnk_1', 'lnk_1']); // keyed by link, never by visitor
    expect(await linkIsBusy(undefined, 'lnk_1')).toBe(false);
    expect(await linkIsBusy({ limit: async () => Promise.reject(new Error('down')) }, 'lnk_1')).toBe(false);
  });
});

describe('old breakdown is folded into daily totals', () => {
  const daysAgo = (n: number) => NOW - n * DAY_MS;

  it('keeps recent detail, folds old days into one row per link, and loses no clicks', async () => {
    const old = KEEP_DETAIL_DAYS + 5;
    await click({ now: daysAgo(old), referer: 'https://a.example/' });
    await click({ now: daysAgo(old), referer: 'https://b.example/' });
    await click({ now: daysAgo(old), userAgent: IPHONE });
    await click({ now: daysAgo(old), linkId: 'lnk_2', referer: 'https://a.example/' });
    await click({ now: daysAgo(10), referer: 'https://recent.example/' });
    const before = rollupTotal();

    const folded = await compactOldClicks(db, NOW);
    expect(folded).toHaveLength(1);
    expect(rows(`day = '${folded[0]}'`)).toEqual([
      expect.objectContaining({ link_id: 'lnk_1', ...OTHER, clicks: 3 }),
      expect.objectContaining({ link_id: 'lnk_2', ...OTHER, clicks: 1 }),
    ]);
    expect(rows("referer = 'recent.example'")).toHaveLength(1);
    expect(rollupTotal()).toBe(before);
    expect(total()).toBe(4); // link totals are untouched

    // Nothing left to do: running again changes nothing.
    expect(await compactOldClicks(db, NOW)).toEqual([]);
    expect(rollupTotal()).toBe(before);
  });

  it('works through a backlog a few days at a time, oldest first', async () => {
    for (let d = 1; d <= 5; d++) await click({ now: daysAgo(KEEP_DETAIL_DAYS + d), referer: 'https://a.example/' });
    const first = await compactOldClicks(db, NOW);
    const second = await compactOldClicks(db, NOW);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(2);
    expect([...first, ...second]).toEqual([...first, ...second].slice().sort());
    expect(await compactOldClicks(db, NOW)).toEqual([]);
    expect(rollupTotal()).toBe(5);
  });

  it('adds to a day total that already exists (the over-limit "Other" row)', async () => {
    const old = daysAgo(KEEP_DETAIL_DAYS + 2);
    for (let i = 0; i < ROWS_PER_LINK_DAY + 2; i++) await click({ now: old, referer: `https://site-${i}.example/` });
    await compactOldClicks(db, NOW);
    expect(rows("link_id = 'lnk_1'")).toEqual([expect.objectContaining({ ...OTHER, clicks: ROWS_PER_LINK_DAY + 2 })]);
  });
});
