import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePageMeta } from '../../worker/lib/page-meta';
import {
  PENDING_FOR_MS, REFRESH_AFTER_MS, RETRY_AFTER_MS, previewIsStale, readPreview, refreshPreview, remoteFrom, scheduleRefresh, type DestPreview,
} from '../../worker/lib/dest-preview';

describe('reading a page for its own title, description and image', () => {
  const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;

  it('prefers Open Graph tags, in either attribute order', () => {
    const meta = parsePageMeta(
      page(`<title>Plain title</title>
        <meta property="og:title" content="OG title">
        <meta content="OG description" property="og:description">
        <meta property="og:image" content="https://cdn.example.com/card.png">
        <meta property="og:site_name" content="Example Site">`),
      'https://example.com/post'
    );
    expect(meta).toEqual({ url: 'https://example.com/post', title: 'OG title', description: 'OG description', image: 'https://cdn.example.com/card.png', siteName: 'Example Site' });
  });

  it('falls back to Twitter tags, the description meta and the <title>', () => {
    expect(parsePageMeta(page('<meta name="twitter:title" content="Tw title"><meta name="twitter:image" content="/img/t.png">'), 'https://example.com/a/b')).toMatchObject({
      title: 'Tw title',
      image: 'https://example.com/img/t.png',
    });
    expect(parsePageMeta(page('<title>  Just   a title </title><meta name="description" content="Plain description">'), 'https://example.com/')).toMatchObject({
      title: 'Just a title',
      description: 'Plain description',
    });
  });

  it('decodes entities, makes relative images absolute and never uses a non-web image', () => {
    expect(parsePageMeta(page('<meta property="og:title" content="Tom &amp; Jerry&#39;s &quot;Best&quot;">'), 'https://example.com/').title).toBe('Tom & Jerry\'s "Best"');
    expect(parsePageMeta(page('<meta property="og:image" content="../cover.jpg">'), 'https://example.com/blog/post/').image).toBe('https://example.com/blog/cover.jpg');
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd']) {
      expect(parsePageMeta(page(`<meta property="og:image" content="${bad}">`), 'https://example.com/').image, bad).toBeNull();
    }
  });

  it('gives nothing for a page that says nothing', () => {
    expect(parsePageMeta(page(''), 'https://example.com/')).toEqual({ url: 'https://example.com/', title: null, description: null, image: null, siteName: null });
  });
});

describe('when to look at a destination again', () => {
  const now = 1_800_000_000_000;
  const at = (ago: number, state: DestPreview['state']): DestPreview => ({ state, at: now - ago });

  it.each([
    [null, true],
    [at(1000, 'ok'), false],
    [at(REFRESH_AFTER_MS - 1000, 'ok'), false],
    [at(REFRESH_AFTER_MS + 1000, 'ok'), true],
    [at(RETRY_AFTER_MS - 1000, 'failed'), false],
    [at(RETRY_AFTER_MS + 1000, 'failed'), true],
    [at(PENDING_FOR_MS - 1000, 'pending'), false],
    [at(PENDING_FOR_MS + 1000, 'pending'), true],
  ])('%j -> stale: %s', (preview, stale) => expect(previewIsStale(preview, now)).toBe(stale));

  it('reads stored JSON safely', () => {
    expect(readPreview('{"state":"ok","at":5,"title":"T"}')).toEqual({ state: 'ok', at: 5, title: 'T' });
    for (const bad of [null, undefined, '', 'nope', '{}', '[]', '{"state":"weird","at":5}', '{"state":"ok"}', '{"state":"ok","at":"x"}']) expect(readPreview(bad), String(bad)).toBeNull();
  });
});

describe('what the page and social tags may use', () => {
  it('uses the stored details, even from an earlier good fetch while a refresh runs or after a failure', () => {
    for (const state of ['ok', 'pending', 'failed'] as const) {
      expect(remoteFrom({ state, at: 1, title: 'T', description: 'D', image: 'https://e.com/i.png', siteName: 'S' })).toEqual({
        title: 'T', description: 'D', image: 'https://e.com/i.png', siteName: 'S',
      });
    }
  });
  it('has nothing to offer when nothing was found, and never offers a non-web image', () => {
    expect(remoteFrom(null)).toBeNull();
    expect(remoteFrom({ state: 'failed', at: 1 })).toBeNull();
    expect(remoteFrom({ state: 'ok', at: 1, title: 'T', image: 'javascript:alert(1)' })).toEqual({ title: 'T', description: null, image: null, siteName: null });
    expect(remoteFrom({ state: 'ok', at: 1, image: 'data:image/png;base64,AAAA' })).toBeNull();
  });
  it('keeps text to a sensible length', () => {
    const long = remoteFrom({ state: 'ok', at: 1, title: 'x'.repeat(500), description: 'y'.repeat(2000) });
    expect(long?.title?.length).toBe(200);
    expect(long?.description?.length).toBe(500);
  });
});

/** Node's built-in SQLite behind the same prepare/bind/run shape as D1, so the real SQL runs. */
function d1(db: DatabaseSync) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
      }),
    }),
  } as unknown as D1Database;
}

describe('fetching and keeping a destination\'s details', () => {
  let db: DatabaseSync;
  const row = () => db.prepare('SELECT * FROM links WHERE id = ?').get('lnk_1') as { dest: string; dest_meta: string | null };
  const stored = () => JSON.parse(row().dest_meta ?? 'null') as DestPreview | null;
  const html = (title: string) => `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="About it"><meta property="og:image" content="/card.png"></head></html>`;
  const respond = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE links (id TEXT PRIMARY KEY, dest TEXT NOT NULL, dest_meta TEXT)');
    db.prepare('INSERT INTO links (id, dest) VALUES (?, ?)').run('lnk_1', 'https://example.com/blog-roll');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches once and stores the title, description and an absolute image address', async () => {
    const fetcher = vi.fn(async () => respond(html('Blog Roll')));
    vi.stubGlobal('fetch', fetcher);
    await refreshPreview(d1(db), { id: 'lnk_1', dest: 'https://example.com/blog-roll', dest_meta: null }, 1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ state: 'ok', title: 'Blog Roll', description: 'About it', image: 'https://example.com/card.png' });
  });

  it('lets only one of several simultaneous visitors fetch', async () => {
    const fetcher = vi.fn(async () => respond(html('Once')));
    vi.stubGlobal('fetch', fetcher);
    const link = { id: 'lnk_1', dest: 'https://example.com/blog-roll', dest_meta: null };
    await Promise.all([refreshPreview(d1(db), link), refreshPreview(d1(db), link), refreshPreview(d1(db), link)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stored()?.state).toBe('ok');
  });

  it('remembers a failure so a broken site is not hit on every click, and keeps what it knew before', async () => {
    const earlier: DestPreview = { state: 'ok', at: 5, title: 'Old title', description: 'Old description' };
    db.prepare('UPDATE links SET dest_meta = ? WHERE id = ?').run(JSON.stringify(earlier), 'lnk_1');
    vi.stubGlobal('fetch', vi.fn(async () => respond('nope', 500)));
    await refreshPreview(d1(db), { id: 'lnk_1', dest: 'https://example.com/blog-roll', dest_meta: JSON.stringify(earlier) }, 99_000);
    expect(stored()).toMatchObject({ state: 'failed', title: 'Old title', description: 'Old description' });
    expect(stored()!.at).toBeGreaterThan(5);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const again = row().dest_meta;
    db.prepare('UPDATE links SET dest_meta = ? WHERE id = ?').run(JSON.stringify({ ...stored(), at: 0 }), 'lnk_1');
    await refreshPreview(d1(db), { id: 'lnk_1', dest: 'https://example.com/blog-roll', dest_meta: row().dest_meta }, 99_000);
    expect(stored()?.state).toBe('failed');
    expect(again).not.toBeNull();
  });

  it('never refuses to refresh because of an old pending marker, and never fetches a private address', async () => {
    const fetcher = vi.fn(async () => respond(html('x')));
    vi.stubGlobal('fetch', fetcher);
    db.prepare('UPDATE links SET dest = ? WHERE id = ?').run('http://169.254.169.254/latest/meta-data', 'lnk_1');
    await refreshPreview(d1(db), { id: 'lnk_1', dest: 'http://169.254.169.254/latest/meta-data', dest_meta: null });
    expect(fetcher).not.toHaveBeenCalled();
    expect(stored()?.state).toBe('failed');
  });

  it('drops the result if the link was pointed somewhere else meanwhile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      // The owner saves a new destination while the old one is still being fetched (which also clears dest_meta).
      db.prepare('UPDATE links SET dest = ?, dest_meta = NULL WHERE id = ?').run('https://other.example/', 'lnk_1');
      return respond(html('Belongs to the OLD destination'));
    }));
    await refreshPreview(d1(db), { id: 'lnk_1', dest: 'https://example.com/blog-roll', dest_meta: null });
    expect(row().dest).toBe('https://other.example/');
    expect(row().dest_meta).toBeNull();
  });

  it('does nothing if the stored value changed since it was read (someone else got there first)', async () => {
    const fetcher = vi.fn(async () => respond(html('x')));
    vi.stubGlobal('fetch', fetcher);
    db.prepare('UPDATE links SET dest_meta = ? WHERE id = ?').run('{"state":"ok","at":1,"title":"Newer"}', 'lnk_1');
    await refreshPreview(d1(db), { id: 'lnk_1', dest: 'https://example.com/blog-roll', dest_meta: null }); // read as empty, but it is not
    expect(fetcher).not.toHaveBeenCalled();
    expect(stored()?.title).toBe('Newer');
  });
});

describe('when a save or a visit starts a background fetch', () => {
  let db: DatabaseSync;
  const dest = 'https://example.com/blog-roll';
  const meta = () => (db.prepare('SELECT dest_meta FROM links WHERE id = ?').get('lnk_1') as { dest_meta: string | null }).dest_meta;
  /** Collects what would run after the response, so the test can wait for it. */
  const after = () => {
    const jobs: Promise<unknown>[] = [];
    return { jobs, ctx: { waitUntil: (p: Promise<unknown>) => void jobs.push(p) } };
  };
  const html = '<html><head><meta property="og:title" content="Fetched"></head></html>';

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE links (id TEXT PRIMARY KEY, dest TEXT NOT NULL, dest_meta TEXT)');
    db.prepare('INSERT INTO links (id, dest) VALUES (?, ?)').run('lnk_1', dest);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })));
  });
  afterEach(() => vi.unstubAllGlobals());

  const link = (over: Partial<{ cloak: number; dest_meta: string | null }> = {}) => ({ id: 'lnk_1', dest, cloak: 1, dest_meta: null, ...over });

  it('fetches for a cloaked link that has nothing yet, after the response has gone out', async () => {
    const { jobs, ctx } = after();
    scheduleRefresh({ DB: d1(db) }, ctx, link());
    expect(jobs).toHaveLength(1);
    await Promise.all(jobs);
    expect(JSON.parse(meta()!)).toMatchObject({ state: 'ok', title: 'Fetched' });
  });

  it('does nothing for a link that is not cloaked', async () => {
    const { jobs, ctx } = after();
    scheduleRefresh({ DB: d1(db) }, ctx, link({ cloak: 0 }));
    expect(jobs).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does nothing while what it knows is fresh, and again once it is a week old', async () => {
    const fresh = JSON.stringify({ state: 'ok', at: Date.now() - 1000, title: 'Known' });
    const { jobs, ctx } = after();
    scheduleRefresh({ DB: d1(db) }, ctx, link({ dest_meta: fresh }));
    expect(jobs).toHaveLength(0);
    const old = JSON.stringify({ state: 'ok', at: Date.now() - REFRESH_AFTER_MS - 1000, title: 'Known' });
    db.prepare('UPDATE links SET dest_meta = ? WHERE id = ?').run(old, 'lnk_1');
    scheduleRefresh({ DB: d1(db) }, ctx, link({ dest_meta: old }));
    expect(jobs).toHaveLength(1);
    await Promise.all(jobs);
    expect(JSON.parse(meta()!).title).toBe('Fetched');
  });

  it('does nothing at all when switched off', () => {
    const { jobs, ctx } = after();
    scheduleRefresh({ DB: d1(db), DEST_PREVIEW_FETCH: 'off' }, ctx, link());
    expect(jobs).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(meta()).toBeNull();
  });

  it('never lets a failed fetch break the page that scheduled it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    const { jobs, ctx } = after();
    scheduleRefresh({ DB: d1(db) }, ctx, link());
    await expect(Promise.all(jobs)).resolves.toBeDefined();
    expect(JSON.parse(meta()!).state).toBe('failed');
  });
});
