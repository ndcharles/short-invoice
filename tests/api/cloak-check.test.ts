import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, inject } from 'vitest';
import { api, TEST_ADMIN, uniqueAlias } from './helpers';

/**
 * Cloaking a destination that cannot be shown in a frame is refused with "This link cannot be cloaked".
 * The tests use the sites that are known without being asked (a Worker in a test cannot look at the real
 * internet: DEST_PREVIEW_FETCH is "off"); how the headers of other sites are read is covered in
 * tests/unit/framing.test.ts, and against real Chrome in tests/e2e/framing-parity.test.ts.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sqlite = (sql: string) =>
  execFileSync(path.join(ROOT, 'node_modules/.bin/wrangler'), ['d1', 'execute', 'short-invoice', '--local', '--persist-to', inject('persistDir'), '--json', '--command', sql], {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
  });
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

const ZOOM = 'https://us02web.zoom.us/j/81234567890?pwd=abcDEF123';
const CLAUDE = 'https://claude.ai/artifact/AbCdEfGhIjKlMnOpQrStUv';
const FINE = 'https://example.com/about';
const REFUSED = { error: 'This link cannot be cloaked', code: 'not_cloakable' };

const stamp = Date.now();
const MEMBER = `cloak-member-${stamp}@cloak.example`;
const as = (email: string) => ({ 'x-dev-user': email });
const enc = encodeURIComponent;
const check = (url: string, domain?: string, who: Record<string, string> = {}) =>
  api('GET', `/api/links/cloak-check?url=${enc(url)}${domain ? `&domain=${enc(domain)}` : ''}`, undefined, who);
const stored = async (id: string) => (await api('GET', `/api/links/${id}`)).body.link;

async function create(dest: string, extra: Record<string, unknown> = {}, who: Record<string, string> = {}) {
  return api('POST', '/api/links', { dest, alias: uniqueAlias('cc'), ...extra }, who);
}
/** A link that is cloaked to a site that cannot be cloaked: what an earlier version of the app allowed (the API now refuses it). */
async function brokenCloaked(dest = ZOOM) {
  const link = (await create(FINE)).body.link;
  sqlite(`UPDATE links SET dest = ${quote(dest)}, cloak = 1 WHERE id = ${quote(link.id)}`);
  return link.id as string;
}

beforeAll(async () => {
  expect((await api('POST', '/api/team/invites', { email: MEMBER }, as(TEST_ADMIN))).status).toBe(201);
});

describe('GET /api/links/cloak-check', () => {
  it('says a Zoom link cannot be cloaked, and why', async () => {
    const res = await check(ZOOM);
    expect(res.status).toBe(200);
    expect(res.body.cloak).toMatchObject({ status: 'blocked', reason: 'known-site', host: 'us02web.zoom.us' });
    expect(res.body.cloak.message).toMatch(/Zoom/);
  });

  it('says a Claude artifact link cannot be cloaked', async () => {
    const res = await check(CLAUDE, 'trim.ng');
    expect(res.body.cloak).toEqual({
      status: 'blocked',
      reason: 'known-site',
      host: 'claude.ai',
      message: "claude.ai doesn't allow other sites to show its pages, so visitors would see a blank page.",
    });
  });

  it('does not guess about a site it was not able to look at', async () => {
    expect((await check(FINE)).body.cloak).toEqual({ status: 'unknown', why: 'not-checked' });
    expect((await check('http://127.0.0.1:8080/private')).body.cloak).toEqual({ status: 'unknown', why: 'not-checked' });
  });

  it('wants a readable address and a sensible domain', async () => {
    expect((await api('GET', '/api/links/cloak-check')).status).toBe(400);
    expect((await check('not a url')).status).toBe(400);
    expect((await check('javascript:alert(1)')).status).toBe(400);
    expect((await check(FINE, 'not a domain!')).status).toBe(400);
  });

  it('is for people who are signed in', async () => {
    expect((await check(ZOOM, undefined, { 'x-dev-user': '' })).status).toBe(401);
  });

  it('is open to members, not only admins', async () => {
    const res = await check(ZOOM, undefined, as(MEMBER));
    expect(res.status).toBe(200);
    expect(res.body.cloak.status).toBe('blocked');
  });

  it('is limited per person, because it looks at other sites for them', async () => {
    const who = as(`cloak-limit-${stamp}@cloak.example`);
    expect((await api('POST', '/api/team/invites', { email: `cloak-limit-${stamp}@cloak.example` }, as(TEST_ADMIN))).status).toBe(201);
    let refused = 0;
    for (let i = 0; i < 65; i += 1) if ((await check(`https://example.com/${i}`, undefined, who)).status === 429) refused += 1;
    expect(refused).toBe(5);
    expect((await check(ZOOM)).status).toBe(200); // someone else is unaffected
  });
});

describe('creating a link', () => {
  it('refuses to cloak a site that cannot be cloaked, and creates nothing', async () => {
    const alias = uniqueAlias('cc');
    const res = await api('POST', '/api/links', { dest: ZOOM, alias, cloak: true });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject(REFUSED);
    expect(res.body.detail).toMatch(/Zoom/);
    expect((await api('GET', `/api/links?search=${alias}`)).body.links).toHaveLength(0);
    expect((await create(CLAUDE, { cloak: true })).body).toMatchObject(REFUSED);
  });

  it('still creates it as an ordinary redirect', async () => {
    const res = await create(ZOOM, { cloak: false });
    expect(res.status).toBe(201);
    expect(res.body.link.cloak).toBe(0);
  });

  it('cloaks a site it could not look at', async () => {
    const res = await create(FINE, { cloak: true });
    expect(res.status).toBe(201);
    expect(res.body.link.cloak).toBe(1);
  });

  it('holds members to the same rule', async () => {
    const res = await create(ZOOM, { cloak: true }, as(MEMBER));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject(REFUSED);
  });
});

describe('changing a link', () => {
  it('refuses to turn cloaking on for a site that cannot be cloaked, and changes nothing', async () => {
    const link = (await create(ZOOM)).body.link;
    const res = await api('PATCH', `/api/links/${link.id}`, { cloak: true, comments: 'should not be saved either' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject(REFUSED);
    expect(await stored(link.id)).toMatchObject({ cloak: 0, comments: '' });
  });

  it('refuses to point a cloaked link at a site that cannot be cloaked', async () => {
    const link = (await create(FINE, { cloak: true })).body.link;
    const res = await api('PATCH', `/api/links/${link.id}`, { dest: CLAUDE });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject(REFUSED);
    expect(await stored(link.id)).toMatchObject({ dest: FINE, cloak: 1 });
    // Pointing it at a site that is fine, or turning cloaking off at the same time, works.
    expect((await api('PATCH', `/api/links/${link.id}`, { dest: 'https://example.org/next' })).status).toBe(200);
    expect((await api('PATCH', `/api/links/${link.id}`, { dest: CLAUDE, cloak: false })).status).toBe(200);
    expect(await stored(link.id)).toMatchObject({ dest: CLAUDE, cloak: 0 });
  });

  it('lets a link that is already cloaked keep saving other changes, so its owner is never stuck', async () => {
    const id = await brokenCloaked();
    // The editor sends every field each time, including the unchanged destination and the cloak switch.
    const everything = await api('PATCH', `/api/links/${id}`, { dest: ZOOM, cloak: true, comments: 'still editable' });
    expect(everything.status).toBe(200);
    expect(await stored(id)).toMatchObject({ dest: ZOOM, cloak: 1, comments: 'still editable' });
    expect((await api('PATCH', `/api/links/${id}`, { archived: true })).status).toBe(200);
    expect((await api('PATCH', `/api/links/${id}`, { archived: false })).status).toBe(200);
    // Turning cloaking off is always allowed; turning it back on is refused.
    expect((await api('PATCH', `/api/links/${id}`, { cloak: false })).status).toBe(200);
    expect(await stored(id)).toMatchObject({ cloak: 0 });
    expect((await api('PATCH', `/api/links/${id}`, { cloak: true })).body).toMatchObject(REFUSED);
  });

  it('holds members to the same rule', async () => {
    const link = (await create(ZOOM)).body.link;
    const res = await api('PATCH', `/api/links/${link.id}`, { cloak: true }, as(MEMBER));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject(REFUSED);
  });
});
