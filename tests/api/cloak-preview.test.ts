import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, inject } from 'vitest';
import { api, baseUrl, raw, uniqueAlias } from './helpers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sqlite = (sql: string) =>
  execFileSync(path.join(ROOT, 'node_modules/.bin/wrangler'), ['d1', 'execute', 'short-invoice', '--local', '--persist-to', inject('persistDir'), '--json', '--command', sql], {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
  });
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** What the destination "said about itself", as the background fetch would have stored it. */
const DESTINATION = {
  title: 'Blog Roll | Charles',
  description: 'Posts I keep coming back to',
  image: 'https://cdn.example.com/cover.png',
  siteName: 'Charles',
};

/** A link that is not cloaked yet, given the destination's details, then cloaked (the background fetch is switched off in tests). */
async function cloaked(details: object | null = DESTINATION, extra: Record<string, unknown> = {}) {
  const alias = uniqueAlias('cp');
  const created = await api('POST', '/api/links', { dest: 'https://example.com/blog-roll', alias, ...extra });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.link.id as string;
  if (details) sqlite(`UPDATE links SET dest_meta = ${quote(JSON.stringify({ state: 'ok', at: Date.now(), ...details }))} WHERE id = ${quote(id)}`);
  expect((await api('PATCH', `/api/links/${id}`, { cloak: true })).status).toBe(200);
  return { alias, id };
}

const stored = (id: string) => (JSON.parse(sqlite(`SELECT dest_meta FROM links WHERE id = ${quote(id)}`))[0].results[0] as { dest_meta: string | null }).dest_meta;
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1] ?? null;
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;
const page = async (alias: string) => {
  const res = await raw(`/s/${alias}`);
  expect(res.status).toBe(200);
  return res.text();
};

describe('a cloaked link shows its destination\'s own title, description and image', () => {
  it('in the browser tab and in every social tag', async () => {
    const { alias } = await cloaked();
    const html = await page(alias);
    expect(titleOf(html)).toBe('Blog Roll | Charles');
    expect(meta(html, 'description')).toBe('Posts I keep coming back to');
    expect(meta(html, 'og:title')).toBe('Blog Roll | Charles');
    expect(meta(html, 'og:description')).toBe('Posts I keep coming back to');
    expect(meta(html, 'og:image')).toBe('https://cdn.example.com/cover.png');
    expect(meta(html, 'og:site_name')).toBe('Charles');
    expect(meta(html, 'og:url')).toBe(`${baseUrl()}/s/${alias}`);
    expect(meta(html, 'twitter:card')).toBe('summary_large_image');
    expect(meta(html, 'twitter:image')).toBe('https://cdn.example.com/cover.png');
    expect(html).toContain('<iframe src="https://example.com/blog-roll"');
  });

  it('with plain details worked out from the address (not the alias) while nothing has been fetched', async () => {
    for (const details of [null, { state: 'failed', at: Date.now() }]) {
      const { alias } = await cloaked(null);
      if (details) {
        const id = (await api('GET', `/api/links?search=${alias}`)).body.links[0].id;
        sqlite(`UPDATE links SET dest_meta = ${quote(JSON.stringify(details))} WHERE id = ${quote(id)}`);
      }
      const html = await page(alias);
      expect(titleOf(html)).toBe('Blog Roll');
      expect(meta(html, 'og:description')).toBe('Shared from example.com/blog-roll');
      expect(meta(html, 'og:image')).toBeNull();
      expect(meta(html, 'twitter:card')).toBe('summary');
    }
  });

  it('is served the same way on a short domain', async () => {
    const domain = `cp${Date.now().toString(36)}.example`;
    await api('POST', '/api/domains', { name: domain });
    const get = (p: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const url = new URL(baseUrl());
        const req = http.request({ hostname: url.hostname, port: url.port, path: p, headers: { host: domain } }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', reject);
        req.end();
      });
    await get('/.well-known/short-invoice?ping=1');
    const alias = uniqueAlias('cph');
    const created = await api('POST', '/api/links', { dest: 'https://example.com/blog-roll', alias, domain });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    sqlite(`UPDATE links SET dest_meta = ${quote(JSON.stringify({ state: 'ok', at: Date.now(), ...DESTINATION }))} WHERE id = ${quote(created.body.link.id)}`);
    await api('PATCH', `/api/links/${created.body.link.id}`, { cloak: true });
    const res = await get(`/${alias}`);
    expect(res.status).toBe(200);
    expect(titleOf(res.body)).toBe('Blog Roll | Charles');
    expect(meta(res.body, 'og:url')).toBe(`http://${domain}/${alias}`);
  });
});

describe('unless the owner changes it', () => {
  it('each of the three is replaced on its own, and the rest keeps following the destination', async () => {
    const { alias, id } = await cloaked();
    await api('PATCH', `/api/links/${id}`, { custom_preview: 1, og_title: 'My own title' });
    let html = await page(alias);
    expect([titleOf(html), meta(html, 'og:title'), meta(html, 'twitter:title')]).toEqual(['My own title', 'My own title', 'My own title']);
    expect(meta(html, 'og:description')).toBe('Posts I keep coming back to');
    expect(meta(html, 'og:image')).toBe('https://cdn.example.com/cover.png');

    await api('PATCH', `/api/links/${id}`, { og_description: 'My own description' });
    html = await page(alias);
    expect([meta(html, 'og:description'), meta(html, 'description'), meta(html, 'twitter:description')]).toEqual(['My own description', 'My own description', 'My own description']);
    expect(meta(html, 'og:image')).toBe('https://cdn.example.com/cover.png');

    await api('PATCH', `/api/links/${id}`, { og_image: 'https://mine.example.com/pic.png' });
    html = await page(alias);
    expect([meta(html, 'og:image'), meta(html, 'twitter:image')]).toEqual(['https://mine.example.com/pic.png', 'https://mine.example.com/pic.png']);
    expect(titleOf(html)).toBe('My own title');
    expect(meta(html, 'og:site_name')).toBe('Charles'); // the site name has no override
  });

  it('an empty override means "follow the destination" (how the editor saves the parts you did not touch)', async () => {
    const { alias, id } = await cloaked();
    await api('PATCH', `/api/links/${id}`, { custom_preview: 1, og_title: '', og_description: '', og_image: '' });
    const html = await page(alias);
    expect(titleOf(html)).toBe('Blog Roll | Charles');
    expect(meta(html, 'og:description')).toBe('Posts I keep coming back to');
    expect(meta(html, 'og:image')).toBe('https://cdn.example.com/cover.png');
  });

  it('turning the custom preview off brings back the destination\'s own, and "reset" clears the wording', async () => {
    const { alias, id } = await cloaked();
    await api('PATCH', `/api/links/${id}`, { custom_preview: 1, og_title: 'Mine', og_description: 'Mine too', og_image: 'https://mine.example.com/p.png' });
    expect(titleOf(await page(alias))).toBe('Mine');
    await api('PATCH', `/api/links/${id}`, { custom_preview: 0 });
    let html = await page(alias);
    expect(titleOf(html)).toBe('Blog Roll | Charles');
    expect(meta(html, 'og:image')).toBe('https://cdn.example.com/cover.png');
    await api('PATCH', `/api/links/${id}`, { custom_preview: 1, og_title: '', og_description: '', og_image: '' });
    html = await page(alias);
    expect(titleOf(html)).toBe('Blog Roll | Charles');
  });

  it('a custom title works even before the destination has told us anything', async () => {
    const { alias, id } = await cloaked(null);
    await api('PATCH', `/api/links/${id}`, { custom_preview: 1, og_title: 'Just mine' });
    const html = await page(alias);
    expect(titleOf(html)).toBe('Just mine');
    expect(meta(html, 'og:description')).toBe('Shared from example.com/blog-roll');
  });

  it('refuses an image that is not a web address', async () => {
    const { id } = await cloaked();
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url']) {
      expect((await api('PATCH', `/api/links/${id}`, { custom_preview: 1, og_image: bad })).status, bad).toBe(400);
    }
  });
});

describe('when the destination changes', () => {
  it('forgets what the old one said, so the new one is never shown under the old one\'s title', async () => {
    const { alias, id } = await cloaked();
    expect(stored(id)).not.toBeNull();
    expect((await api('PATCH', `/api/links/${id}`, { dest: 'https://example.com/other-page' })).status).toBe(200);
    expect(stored(id)).toBeNull();
    const html = await page(alias);
    expect(titleOf(html)).toBe('Other Page');
    expect(html).not.toContain('Blog Roll');
    expect(html).toContain('<iframe src="https://example.com/other-page"');
  });

  it('keeps it for every other kind of change', async () => {
    const { id } = await cloaked();
    const before = stored(id);
    await api('PATCH', `/api/links/${id}`, { comments: 'a note', tag: null, dest: 'https://example.com/blog-roll' });
    expect(stored(id)).toBe(before);
  });
});

describe('safe with whatever a destination says', () => {
  it('cannot break out of the page, and never offers a non-web image', async () => {
    const { alias } = await cloaked({
      title: '"><script>alert(1)</script>',
      description: '<img src=x onerror=alert(1)> & "quotes"',
      image: 'javascript:alert(1)',
      siteName: '</title><b>bold</b>',
    });
    const html = await page(alias);
    expect(html).not.toMatch(/<script>alert|<img src=x|<b>bold|<\/title><b>/);
    expect(html).toContain('&lt;script&gt;');
    expect(meta(html, 'og:image')).toBeNull();
    expect(meta(html, 'twitter:card')).toBe('summary');
    expect((html.match(/<title>/g) ?? []).length).toBe(1);
  });

  it('keeps very long text to a sensible size', async () => {
    const { alias } = await cloaked({ title: 'T'.repeat(5000), description: 'D'.repeat(9000) });
    const html = await page(alias);
    expect(meta(html, 'og:title')!.length).toBeLessThanOrEqual(200);
    expect(meta(html, 'og:description')!.length).toBeLessThanOrEqual(500);
  });
});

describe('the gates come first', () => {
  const secret = { title: 'SECRET DESTINATION TITLE', description: 'SECRET DESTINATION TEXT', image: 'https://cdn.example.com/secret.png' };

  it('a password prompt says nothing about the destination, and the cloaked page appears once unlocked', async () => {
    const { alias } = await cloaked(secret, { password: 'the right password' });
    const prompt = await raw(`/s/${alias}`);
    expect(prompt.status).toBe(401);
    const promptHtml = await prompt.text();
    expect(promptHtml).not.toMatch(/SECRET|example\.com|og:/);

    const unlock = await raw(`/s/${alias}`, { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.150' }, body: new URLSearchParams({ pw: 'the right password' }) });
    expect(unlock.status).toBe(200); // a cloaked link answers the form with the cloaked page itself
    const html = await unlock.text();
    expect(titleOf(html)).toBe('SECRET DESTINATION TITLE');
    const again = await raw(`/s/${alias}`, { headers: { cookie: unlock.headers.get('set-cookie')!.split(';')[0] } });
    expect(titleOf(await again.text())).toBe('SECRET DESTINATION TITLE');
  });

  it('an expired link says nothing about the destination either', async () => {
    const { alias } = await cloaked(secret, { expires_at: Date.now() - 60_000 });
    const res = await raw(`/s/${alias}`);
    expect(res.status).toBe(410);
    expect(await res.text()).not.toMatch(/SECRET|example\.com\/blog-roll|og:/);
  });
});

describe('links that are not cloaked are untouched', () => {
  it('still redirect, and what is known about the destination is not used', async () => {
    const alias = uniqueAlias('plain');
    const created = await api('POST', '/api/links', { dest: 'https://example.com/blog-roll', alias });
    sqlite(`UPDATE links SET dest_meta = ${quote(JSON.stringify({ state: 'ok', at: Date.now(), ...DESTINATION }))} WHERE id = ${quote(created.body.link.id)}`);
    const res = await raw(`/s/${alias}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/blog-roll');
    expect(await res.text()).toBe('');
  });
});

describe('the raw stored copy stays on the server', () => {
  it('is in no API response and not in the export (the editor gets a cleaned-up preview on a single link instead)', async () => {
    const { alias, id } = await cloaked();
    const everything = JSON.stringify([
      (await api('GET', `/api/links/${id}`)).body,
      (await api('GET', `/api/links?search=${alias}`)).body,
      (await api('PATCH', `/api/links/${id}`, { comments: 'x' })).body,
      (await api('GET', '/api/export')).body,
    ]);
    expect(everything).not.toContain('dest_meta');
    expect((await api('GET', '/api/export')).body.links.some((l: Record<string, unknown>) => 'preview' in l)).toBe(false);
  });
});

describe('every link keeps what its destination says, cloaked or not, and the editor gets it', () => {
  /** A link that is NOT cloaked, with its destination's details already stored. */
  async function plain(details: object | null = DESTINATION) {
    const alias = uniqueAlias('pv');
    const created = await api('POST', '/api/links', { dest: 'https://example.com/blog-roll', alias });
    expect(created.status).toBe(201);
    const id = created.body.link.id as string;
    if (details) sqlite(`UPDATE links SET dest_meta = ${quote(JSON.stringify({ state: 'ok', at: 1_800_000_000_000, ...details }))} WHERE id = ${quote(id)}`);
    return { alias, id, created: created.body.link };
  }

  it('a single link carries a cleaned-up preview: the destination\'s details and when they were last fetched', async () => {
    const { id } = await plain();
    const link = (await api('GET', `/api/links/${id}`)).body.link;
    expect(link.preview).toEqual({ ...DESTINATION, state: 'ok', fetched_at: 1_800_000_000_000 });
    expect(link).not.toHaveProperty('dest_meta');
    // Saving returns it too, so the editor never has to ask again.
    const saved = (await api('PATCH', `/api/links/${id}`, { comments: 'a note' })).body.link;
    expect(saved.preview).toMatchObject({ title: 'Blog Roll | Charles' });
  });

  it('is empty (null) for a link nothing is known about yet, such as one just created', async () => {
    const { id, created } = await plain(null);
    expect(created.preview).toBeNull();
    expect((await api('GET', `/api/links/${id}`)).body.link.preview).toBeNull();
  });

  it('is left out of lists, which only need the links themselves', async () => {
    const { alias } = await plain();
    const list = (await api('GET', `/api/links?search=${alias}`)).body.links;
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('preview');
    expect(list[0]).not.toHaveProperty('dest_meta');
  });

  it('never offers a non-web image, and is empty when nothing usable was found', async () => {
    const hostile = await plain({ title: 'Fine', image: 'javascript:alert(1)' });
    expect((await api('GET', `/api/links/${hostile.id}`)).body.link.preview).toMatchObject({ title: 'Fine', image: null });
    const nothing = await plain({ title: null, description: null, image: 'data:image/png;base64,AAAA', siteName: null });
    expect((await api('GET', `/api/links/${nothing.id}`)).body.link.preview).toBeNull();
  });

  it('is dropped when the destination changes, so the editor never shows the old site under the new address', async () => {
    const { id } = await plain();
    const moved = (await api('PATCH', `/api/links/${id}`, { dest: 'https://example.com/other-page' })).body.link;
    expect(moved.preview).toBeNull();
    expect((await api('GET', `/api/links/${id}`)).body.link.preview).toBeNull();
  });

  it('keeps a custom preview on a link that is not cloaked, and the destination\'s own details alongside it', async () => {
    const { id } = await plain();
    await api('PATCH', `/api/links/${id}`, { custom_preview: 1, og_title: 'My own title', og_description: 'My own words', og_image: 'https://mine.example.com/p.png' });
    const link = (await api('GET', `/api/links/${id}`)).body.link;
    expect(link).toMatchObject({ cloak: 0, custom_preview: 1, og_title: 'My own title', og_description: 'My own words', og_image: 'https://mine.example.com/p.png' });
    expect(link.preview).toMatchObject({ title: 'Blog Roll | Charles' }); // still there, so the editor can offer "reset to destination"
  });
});

describe('the site default preview', () => {
  const SITE_TITLE = '4th Entity Technologies';
  const SITE_TEXT = 'AI, Data And Technology Training, Consulting, & Solutions.';

  it('can be saved as a custom preview and is what a cloaked link then shows (title, description and image)', async () => {
    const { alias, id } = await cloaked();
    const image = `${baseUrl()}/site-default.png`;
    const saved = await api('PATCH', `/api/links/${id}`, { custom_preview: 1, og_title: SITE_TITLE, og_description: SITE_TEXT, og_image: image });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const html = await page(alias);
    expect(titleOf(html)).toBe(SITE_TITLE);
    expect(meta(html, 'og:title')).toBe(SITE_TITLE);
    expect(meta(html, 'og:description')).toBe(SITE_TEXT.replace('&', '&amp;'));
    expect(meta(html, 'og:image')).toBe(image);
    expect(meta(html, 'twitter:card')).toBe('summary_large_image');
  });
});
