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

const CRAWLERS: Record<string, string> = {
  Facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  X: 'Twitterbot/1.0',
  LinkedIn: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  Slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  Discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  Telegram: 'TelegramBot (like TwitterBot)',
  WhatsApp: 'WhatsApp/2.23.20.0 A',
  iMessage: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.2 Safari/605.1.15 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
};
const PERSON = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const INSTAGRAM_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20A362 Instagram 250.0.0.17.109 (iPhone14,5; iOS 16_0; en_US; en; scale=3.00)';

const DEST = 'https://example.com/private/page';
const DESTINATION_SAYS = { title: 'Destination title', description: 'Destination description', image: 'https://cdn.example.com/destination.png', siteName: 'Destination Site' };
const MINE = { og_title: 'My own title', og_description: 'My own words', og_image: 'https://mine.example.com/card.png' };

const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1] ?? null;
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;
const visit = (alias: string, userAgent: string, method = 'GET') => raw(`/s/${alias}`, { method, headers: { 'user-agent': userAgent } });

/** A link (not cloaked unless asked), optionally with the destination's own details stored. */
async function link(extra: Record<string, unknown> = {}, destination: object | null = DESTINATION_SAYS) {
  const alias = uniqueAlias('share');
  const created = await api('POST', '/api/links', { dest: DEST, alias, ...extra });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.link.id as string;
  if (destination) sqlite(`UPDATE links SET dest_meta = ${quote(JSON.stringify({ state: 'ok', at: Date.now(), ...destination }))} WHERE id = ${quote(id)}`);
  return { alias, id };
}
const clicksOf = async (id: string) => (await api('GET', `/api/links/${id}`)).body.link.clicks as number;

describe('a shared link with a custom preview shows it', () => {
  it.each(Object.entries(CRAWLERS))('%s is given the owner\'s preview', async (_name, ua) => {
    const { alias } = await link({ custom_preview: 1, ...MINE });
    const res = await visit(alias, ua);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(titleOf(html)).toBe('My own title');
    expect(meta(html, 'og:title')).toBe('My own title');
    expect(meta(html, 'og:description')).toBe('My own words');
    expect(meta(html, 'og:image')).toBe('https://mine.example.com/card.png');
    expect(meta(html, 'og:url')).toBe(`${baseUrl()}/s/${alias}`);
    expect(meta(html, 'twitter:card')).toBe('summary_large_image');
    expect(meta(html, 'twitter:title')).toBe('My own title');
    expect(meta(html, 'twitter:image')).toBe('https://mine.example.com/card.png');
    expect(html).toContain(`<a href="${DEST}">`);
    expect(html).not.toMatch(/http-equiv|<script/i); // it must not send the crawler on to the destination's own card
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('vary')).toMatch(/user-agent/i);
  });

  it('while people clicking the same link are still redirected at once', async () => {
    const { alias } = await link({ custom_preview: 1, ...MINE });
    for (const ua of [PERSON, INSTAGRAM_APP]) {
      const res = await visit(alias, ua);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(DEST);
      expect(res.headers.get('vary')).toMatch(/user-agent/i); // so a shared cache never mixes the two up
      expect(await res.text()).toBe('');
    }
  });

  it('a crawler asking with HEAD (some do first) is answered the same way', async () => {
    const { alias } = await link({ custom_preview: 1, ...MINE });
    const res = await visit(alias, CRAWLERS.Slack, 'HEAD');
    expect(res.status).toBe(200);
  });

  it('only the parts the owner wrote are replaced; the rest is the destination\'s own', async () => {
    const { alias } = await link({ custom_preview: 1, og_title: 'My own title' });
    const html = await (await visit(alias, CRAWLERS.Facebook)).text();
    expect(meta(html, 'og:title')).toBe('My own title');
    expect(meta(html, 'og:description')).toBe('Destination description');
    expect(meta(html, 'og:image')).toBe('https://cdn.example.com/destination.png');
    expect(meta(html, 'og:site_name')).toBe('Destination Site');
  });

  it('with nothing known yet about the destination, the unwritten parts are plain fallbacks (never empty)', async () => {
    const { alias } = await link({ custom_preview: 1, og_title: 'My own title' }, null);
    const html = await (await visit(alias, CRAWLERS.X)).text();
    expect(meta(html, 'og:title')).toBe('My own title');
    expect(meta(html, 'og:description')).toBe('Shared from example.com/private/page');
    expect(meta(html, 'og:image')).toBeNull();
    expect(meta(html, 'twitter:card')).toBe('summary');
  });

  it('the site default image and wording come out exactly as chosen', async () => {
    const { alias } = await link({
      custom_preview: 1,
      og_title: '4th Entity Technologies',
      og_description: 'AI, Data And Technology Training, Consulting, & Solutions.',
      og_image: `${baseUrl()}/site-default.png`,
    });
    const html = await (await visit(alias, CRAWLERS.WhatsApp)).text();
    expect(meta(html, 'og:title')).toBe('4th Entity Technologies');
    expect(meta(html, 'og:description')).toBe('AI, Data And Technology Training, Consulting, &amp; Solutions.');
    expect(meta(html, 'og:image')).toBe(`${baseUrl()}/site-default.png`);
  });

  it('whatever the owner wrote is escaped', async () => {
    const { alias } = await link({ custom_preview: 1, og_title: '"><script>alert(1)</script>', og_description: '<img src=x onerror=alert(1)> & more' });
    const html = await (await visit(alias, CRAWLERS.Slack)).text();
    expect(html).not.toMatch(/<script>alert|<img src=x/);
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('without a custom preview, crawlers are redirected and read the destination\'s own card', () => {
  it.each([
    ['no custom preview at all', {}],
    ['switched off, even though text is saved', { custom_preview: 0, ...MINE }],
    ['switched on, but nothing written', { custom_preview: 1 }],
    ['switched on, with only blanks', { custom_preview: 1, og_title: '   ', og_description: '' }],
  ])('%s', async (_name, extra) => {
    const { alias } = await link(extra as Record<string, unknown>);
    for (const ua of Object.values(CRAWLERS)) {
      const res = await visit(alias, ua);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(DEST);
    }
  });
});

describe('a shared link is not a click', () => {
  it('crawlers are not counted; a person is', async () => {
    const { alias, id } = await link({ custom_preview: 1, ...MINE });
    for (const ua of Object.values(CRAWLERS)) await visit(alias, ua);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await clicksOf(id)).toBe(0);
    await visit(alias, PERSON);
    for (let i = 0; i < 30 && (await clicksOf(id)) < 1; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await clicksOf(id)).toBe(1);
  });
});

describe('the gates still come first', () => {
  it('a password-protected link gives crawlers only what the owner wrote, and nothing about where it goes', async () => {
    const { alias } = await link({ custom_preview: 1, og_title: 'Members only', password: 'the right password' });
    const res = await visit(alias, CRAWLERS.Facebook);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(meta(html, 'og:title')).toBe('Members only');
    expect(meta(html, 'og:description')).toBe('Enter the password to open this link.');
    expect(meta(html, 'og:image')).toBeNull();
    // Not the address, not the destination's title, description or image.
    expect(html).not.toMatch(/example\.com|private|Destination|destination\.png|<a /);
    // People still meet the password page.
    const person = await visit(alias, PERSON);
    expect(person.status).toBe(401);
    expect(await person.text()).toContain('password protected');
  });

  it('a password-protected link with only an image written still gets a plain title for the card', async () => {
    const { alias } = await link({ custom_preview: 1, og_image: 'https://mine.example.com/lock.png', password: 'the right password' });
    const html = await (await visit(alias, CRAWLERS.Slack)).text();
    expect(meta(html, 'og:title')).toBe('Password protected link');
    expect(meta(html, 'og:image')).toBe('https://mine.example.com/lock.png');
  });

  it('a password-protected link with no custom preview meets crawlers with the password page, as before', async () => {
    const { alias } = await link({ password: 'the right password' });
    const res = await visit(alias, CRAWLERS.Facebook);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toMatch(/og:title|Destination/);
  });

  it('an expired link shows crawlers the expired page, not a card', async () => {
    const { alias } = await link({ custom_preview: 1, ...MINE, expires_at: Date.now() - 60_000 });
    const res = await visit(alias, CRAWLERS.Facebook);
    expect(res.status).toBe(410);
    expect(await res.text()).not.toMatch(/My own title|og:title|example\.com\/private/);
  });
});

describe('cloaked links', () => {
  it('give a crawler the same tags as anyone (the cloaked page already carries them)', async () => {
    const { alias } = await link({ custom_preview: 1, og_title: 'My own title', cloak: true });
    const asCrawler = await (await visit(alias, CRAWLERS.Facebook)).text();
    const asPerson = await (await visit(alias, PERSON)).text();
    expect(meta(asCrawler, 'og:title')).toBe('My own title');
    expect(meta(asCrawler, 'og:description')).toBe('Destination description');
    expect(meta(asPerson, 'og:title')).toBe('My own title');
    expect(asCrawler).toContain('<iframe');
  });
});

describe('on a short domain (like trim.ng)', () => {
  it('works the same way, with the card pointing at the short domain', async () => {
    const domain = `sh${Date.now().toString(36)}.example`;
    await api('POST', '/api/domains', { name: domain });
    const asHost = (p: string, ua: string) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
        const url = new URL(baseUrl());
        const req = http.request({ hostname: url.hostname, port: url.port, path: p, headers: { host: domain, 'user-agent': ua } }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
      });
    await asHost('/.well-known/short-invoice?ping=1', PERSON);
    const alias = uniqueAlias('shh');
    const created = await api('POST', '/api/links', { dest: DEST, alias, domain, custom_preview: 1, ...MINE });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const crawler = await asHost(`/${alias}`, CRAWLERS.Telegram);
    expect(crawler.status).toBe(200);
    expect(meta(crawler.body, 'og:title')).toBe('My own title');
    expect(meta(crawler.body, 'og:url')).toBe(`http://${domain}/${alias}`);
    const person = await asHost(`/${alias}`, PERSON);
    expect(person.status).toBe(302);
    expect(person.headers.location).toBe(DEST);
  });
});
