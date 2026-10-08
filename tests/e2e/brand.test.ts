import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { baseUrl, chromeAvailable, launch, openSession } from './helpers';

/** Everything the built site's own pages point to for icons and previews must really be served. */
const get = async (path: string) => {
  const res = await fetch(`${baseUrl()}${path}`);
  return { status: res.status, type: res.headers.get('content-type') ?? '', bytes: Buffer.from(await res.arrayBuffer()) };
};

const tags = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((m) => m[0]);
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

describe('icons and social tags on the built site', () => {
  for (const page of ['/login', '/links', '/invoices']) {
    it(`${page} declares the icons, the manifest and the social preview`, async () => {
      const html = await (await fetch(`${baseUrl()}${page}`)).text();
      const links = tags(html, /<link [^>]*>/g);
      const metas = tags(html, /<meta [^>]*>/g);
      const link = (rel: string) => links.filter((l) => attr(l, 'rel') === rel);
      const meta = (key: string) => metas.find((m) => attr(m, 'property') === key || attr(m, 'name') === key);

      expect(link('icon').map((l) => attr(l, 'href')?.split('?')[0]).sort()).toEqual(['/favicon-16x16.png', '/favicon-32x32.png', '/favicon.ico']);
      expect(link('apple-touch-icon').map((l) => attr(l, 'href')?.split('?')[0])).toEqual(['/apple-touch-icon.png']);
      expect(link('manifest').map((l) => attr(l, 'href'))).toEqual(['/site.webmanifest']);

      // Social crawlers need absolute addresses.
      expect(attr(meta('og:image')!, 'content')).toBe('https://app.4th-entity.com/og.png');
      expect(attr(meta('og:image:width')!, 'content')).toBe('1200');
      expect(attr(meta('og:image:height')!, 'content')).toBe('630');
      expect(attr(meta('og:image:alt')!, 'content')).toContain('May the 4th be with you!');
      expect(attr(meta('og:description')!, 'content')).toBe('May the 4th be with you!');
      expect(attr(meta('og:site_name')!, 'content')).toBe('4th Entity Technologies');
      expect(attr(meta('og:title')!, 'content')).toBe('4th Entity Technologies Workspace');
      expect(attr(meta('twitter:title')!, 'content')).toBe('4th Entity Technologies Workspace');
      expect(html).toContain('<title>4th Entity Technologies Workspace</title>');
      expect(attr(meta('twitter:card')!, 'content')).toBe('summary_large_image');
      expect(attr(meta('twitter:image')!, 'content')).toBe('https://app.4th-entity.com/og.png');
      expect(attr(meta('description')!, 'content')).toBe('May the 4th be with you!');
    });
  }

  it('serves every icon, the preview image and the manifest with the right type', async () => {
    const expected: [string, RegExp][] = [
      ['/favicon.ico', /image\/(x-icon|vnd\.microsoft\.icon)/],
      ['/favicon-16x16.png', /image\/png/],
      ['/favicon-32x32.png', /image\/png/],
      ['/apple-touch-icon.png', /image\/png/],
      ['/icon-192.png', /image\/png/],
      ['/icon-512.png', /image\/png/],
      ['/icon-maskable-512.png', /image\/png/],
      ['/og.png', /image\/png/],
      ['/site.webmanifest', /application\/(manifest\+)?json/],
    ];
    for (const [path, type] of expected) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.type, path).toMatch(type);
      expect(res.bytes.length, path).toBeGreaterThan(100);
    }
    // The manifest parses and every icon it lists is served.
    const manifest = JSON.parse((await get('/site.webmanifest')).bytes.toString());
    for (const icon of manifest.icons) expect((await get(icon.src)).status, icon.src).toBe(200);
  });

  it('is the same icon on a short domain (browsers ask for /favicon.ico on the password and expired pages)', async () => {
    const url = new URL(baseUrl());
    const res = await new Promise<{ status: number; type: string; length: number }>((resolve, reject) => {
      const req = http.request({ hostname: url.hostname, port: url.port, path: '/favicon.ico', headers: { host: 'trim.example' } }, (r) => {
        let length = 0;
        r.on('data', (chunk) => (length += chunk.length));
        r.on('end', () => resolve({ status: r.statusCode ?? 0, type: String(r.headers['content-type']), length }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/image\//);
    expect(res.length).toBe((await get('/favicon.ico')).bytes.length);
  });
});

const inChrome = chromeAvailable ? describe : describe.skip;

inChrome('in Chrome', () => {
  it('loads every icon the page declares without tripping the Content-Security-Policy, and accepts the manifest', async () => {
    const browser = await launch();
    try {
      const s = await openSession(browser, { user: null });
      const messages: string[] = [];
      s.page.on('console', (m) => messages.push(`${m.type()}: ${m.text()}`)); // raw, unlike the shared filter that ignores anything about favicons
      await s.page.goto('/login');
      const loaded = await s.page.evaluate(() =>
        Promise.all(
          [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map(
            (link) =>
              new Promise<[string, boolean]>((resolve) => {
                const href = (link as HTMLLinkElement).href;
                const img = new Image();
                img.onload = () => resolve([href, true]);
                img.onerror = () => resolve([href, false]);
                img.src = href;
              })
          )
        )
      );
      expect(loaded).toHaveLength(4); // the .ico, two PNGs and the touch icon
      expect(loaded.filter(([, ok]) => !ok)).toEqual([]);
      expect(messages.filter((m) => /content security policy|violates/i.test(m))).toEqual([]);

      // Chrome's own reading of the manifest: no errors, and it understood the name and the three icons.
      const client = await s.context.newCDPSession(s.page);
      const { errors, data } = await client.send('Page.getAppManifest');
      expect(errors).toEqual([]);
      const manifest = JSON.parse(data ?? '{}');
      expect(manifest.name).toBe('4th Entity Technologies Workspace');
      expect(manifest.icons).toHaveLength(3);
      await s.context.close();
    } finally {
      await browser.close();
    }
  });
});
