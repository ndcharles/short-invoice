import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, inject } from 'vitest';
import { api, TEST_ADMIN, uniqueAlias } from './helpers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sqlite = (sql: string) =>
  execFileSync(path.join(ROOT, 'node_modules/.bin/wrangler'), ['d1', 'execute', 'short-invoice', '--local', '--persist-to', inject('persistDir'), '--json', '--command', sql], {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
  });

interface Row {
  id: string;
  at: number;
  actor: string;
  action: string;
  entity_type: string;
  label: string;
  seq?: unknown;
}
interface Page {
  activity: Row[];
  more: boolean;
  next: string | null;
}

const stamp = Date.now();
const as = (email: string) => ({ 'x-dev-user': email });
const enc = encodeURIComponent;

const page = async (query: string) => {
  const res = await api<Page>('GET', `/api/team/activity?${query}`, undefined, as(TEST_ADMIN));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

/** Everything for one person, page by page, until there is no next page. */
async function walk(actor: string, extra = '') {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const next: Page = await page(`actor=${enc(actor)}${extra}${cursor ? `&cursor=${enc(cursor)}` : ''}`);
    pages.push(next);
    cursor = next.next;
  } while (cursor && pages.length < 20);
  return pages;
}

/** Someone who can sign in and then make `count` changes, each of which is one activity row. */
async function personWithChanges(prefix: string, count: number) {
  const email = `${prefix}-${stamp}@activity.example`;
  expect((await api('POST', '/api/team/invites', { email }, as(TEST_ADMIN))).status).toBe(201);
  for (let i = 0; i < count; i += 1) {
    const res = await api('POST', '/api/links', { dest: `https://example.com/${i}`, alias: uniqueAlias('act') }, as(email));
    expect(res.status).toBe(201);
  }
  return email;
}

describe('the activity feed pages 20 at a time', () => {
  it('walks every row once, newest first, 20 per page', async () => {
    const who = await personWithChanges('many', 45);
    const pages = await walk(who);
    expect(pages.map((p) => p.activity.length)).toEqual([20, 20, 5]);
    expect(pages.map((p) => p.more)).toEqual([true, true, false]);
    expect(pages.map((p) => p.next !== null)).toEqual([true, true, false]);
    const all = pages.flatMap((p) => p.activity);
    expect(new Set(all.map((r) => r.id)).size).toBe(45);
    expect(all.every((r) => r.actor === who)).toBe(true);
    for (let i = 1; i < all.length; i += 1) expect(all[i].at).toBeLessThanOrEqual(all[i - 1].at);
  });

  it('knows exactly when there is nothing more, at 19, 20 and 21 rows', async () => {
    for (const [count, pages] of [[19, [19]], [20, [20]], [21, [20, 1]]] as const) {
      const who = await personWithChanges(`edge${count}`, count);
      const got = await walk(who);
      expect(got.map((p) => p.activity.length), `${count} rows`).toEqual(pages);
      expect(got[got.length - 1].more).toBe(false);
      expect(got[got.length - 1].next).toBeNull();
    }
  });

  it('never skips or repeats rows that share the same millisecond', async () => {
    const who = `ties-${stamp}@activity.example`;
    const at = Date.now() + 5_000_000; // all identical, and newer than everything else
    const values = Array.from({ length: 45 }, (_, i) => `('act_tie_${stamp}_${i}', ${at}, '${who}', 'created', 'link', 'x', 'tie ${i}', '')`).join(',');
    sqlite(`INSERT INTO activity (id, at, actor, action, entity_type, entity_id, label, detail) VALUES ${values}`);
    const all = (await walk(who)).flatMap((p) => p.activity);
    expect(all).toHaveLength(45);
    expect(new Set(all.map((r) => r.id)).size).toBe(45);
    // They are also the newest rows in the whole feed, so the unfiltered first page is made of them.
    expect((await page('')).activity.every((r) => r.at === at)).toBe(true);
  });

  it('combines with the person and type filters', async () => {
    const who = await personWithChanges('mixed', 25);
    await api('POST', '/api/collections', { kind: 'tags', name: `Mixed ${stamp}` }, as(TEST_ADMIN));
    const links = await walk(who, '&type=link');
    expect(links.flatMap((p) => p.activity)).toHaveLength(25);
    expect((await walk(who, '&type=invoice')).flatMap((p) => p.activity)).toHaveLength(0);
    const tags = await page('type=tag');
    expect(tags.activity.every((r) => r.entity_type === 'tag')).toBe(true);
    expect(tags.activity.length).toBeGreaterThan(0);
  });

  it('keeps its internal row number to itself', async () => {
    const first = await page('');
    expect(first.activity.length).toBeGreaterThan(0);
    for (const row of first.activity) expect(row.seq).toBeUndefined();
    expect(Object.keys(first.activity[0]).sort()).toEqual(['action', 'actor', 'at', 'detail', 'entity_id', 'entity_type', 'id', 'label']);
  });

  it('refuses a cursor that is not one of ours', async () => {
    for (const cursor of ['abc', '1:2:3', ':', '12', "1:2' OR '1'='1", '-1:5', '1e5:1', '99999999999999999:1']) {
      const res = await api('GET', `/api/team/activity?cursor=${enc(cursor)}`, undefined, as(TEST_ADMIN));
      expect(res.status, cursor).toBe(400);
    }
  });

  it('is still admins only', async () => {
    const member = `plain-${stamp}@activity.example`;
    await api('POST', '/api/team/invites', { email: member }, as(TEST_ADMIN));
    expect((await api('GET', '/api/team/activity', undefined, as(member))).status).toBe(403);
    expect((await api('GET', '/api/team/activity?cursor=1:1', undefined, as(member))).status).toBe(403);
  });
});
