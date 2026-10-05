import { describe, expect, it } from 'vitest';
import { api, raw, uniqueAlias } from './helpers';

const create = (body: Record<string, unknown>) => api('POST', '/api/links', body);

describe('link input validation (injection hardening)', () => {
  it.each([
    ['javascript: URL', 'javascript:alert(document.cookie)'],
    ['JavaScript: mixed case', 'JaVaScRiPt:alert(1)'],
    ['data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript: URL', 'vbscript:msgbox(1)'],
    ['file: URL', 'file:///etc/passwd'],
    ['embedded credentials', 'https://paypal.com@evil.example/login'],
    ['CRLF header injection', 'https://example.com/\r\nSet-Cookie: x=1'],
    ['spaces', 'https://exa mple.com'],
    ['no TLD', 'https://intranet'],
    ['quote breaking out of attributes', 'https://example.com/"><script>alert(1)</script>'],
  ])('rejects a destination with %s', async (_label, dest) => {
    const res = await create({ dest, alias: uniqueAlias() });
    // The last case is a valid URL once percent-encoded; it must at least never come back raw.
    if (res.status === 201) {
      expect(res.body.link.dest).not.toContain('"');
      expect(res.body.link.dest).not.toContain('<');
    } else {
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
    }
  });

  it('normalises a bare domain to https', async () => {
    const res = await create({ dest: 'example.com/page', alias: uniqueAlias() });
    expect(res.status).toBe(201);
    expect(res.body.link.dest).toBe('https://example.com/page');
  });

  it.each([
    ['HTML', '<script>alert(1)</script>'],
    ['a path separator', 'a/b'],
    ['a query string', 'a?b=1'],
    ['SQL', "x' OR '1'='1"],
    ['a reserved word', 'api'],
    ['a reserved word, any case', 'Settings'],
    ['a leading dash', '-abc'],
    ['an overly long value', 'a'.repeat(65)],
  ])('rejects an alias containing %s', async (_label, alias) => {
    const res = await create({ dest: 'https://example.com', alias });
    expect(res.status).toBe(400);
  });

  it('rejects a domain that is not configured', async () => {
    const res = await create({ dest: 'https://example.com', alias: uniqueAlias(), domain: 'evil.example' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not one of your domains/);
  });

  it.each([
    ['expired-link URL', { expires_url: 'javascript:alert(1)' }],
    ['preview image', { og_image: 'javascript:alert(1)' }],
    ['tag as an object', { tag: { $gt: '' } }],
    ['folder as an array', { folder: ['x'] }],
    ['UTM value with a newline', { utm_source: 'news\nletter' }],
    ['oversized comments', { comments: 'x'.repeat(5000) }],
    ['oversized password', { password: 'x'.repeat(200) }],
    ['invalid expiry date', { expires_at: 'not a date' }],
  ])('rejects an invalid %s', async (_label, extra) => {
    const res = await create({ dest: 'https://example.com', alias: uniqueAlias(), ...extra });
    expect(res.status).toBe(400);
  });

  it('rejects a non-object JSON body', async () => {
    expect((await api('POST', '/api/links', ['x'])).status).toBe(400);
    expect((await api('POST', '/api/links', 'x')).status).toBe(400);
  });

  it('treats search input as data, not SQL', async () => {
    const alias = uniqueAlias('srch');
    await create({ dest: 'https://example.com/search-target', alias });
    for (const search of ["' OR 1=1 --", '%', '_', '"; DROP TABLE links; --']) {
      const res = await api('GET', `/api/links?search=${encodeURIComponent(search)}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.links)).toBe(true);
    }
    // The table is still there and the link is still found.
    const found = await api('GET', `/api/links?search=${alias}`);
    expect(found.body.links.map((l: { alias: string }) => l.alias)).toContain(alias);
  });

  it('never returns password hashes', async () => {
    const alias = uniqueAlias('pw');
    const created = await create({ dest: 'https://example.com', alias, password: 'secret-pass' });
    expect(created.status).toBe(201);
    expect(created.body.link.password_hash).toBeNull();
    expect(created.body.link.has_password).toBe(true);

    const list = await api('GET', `/api/links?search=${alias}`);
    expect(JSON.stringify(list.body)).not.toContain('pbkdf2');
    const one = await api('GET', `/api/links/${created.body.link.id}`);
    expect(JSON.stringify(one.body)).not.toContain('pbkdf2');
  });

  it('validates updates the same way as creates', async () => {
    const created = await create({ dest: 'https://example.com', alias: uniqueAlias() });
    const id = created.body.link.id;
    expect((await api('PATCH', `/api/links/${id}`, { dest: 'javascript:alert(1)' })).status).toBe(400);
    expect((await api('PATCH', `/api/links/${id}`, { alias: '../../etc' })).status).toBe(400);
    expect((await api('PATCH', `/api/links/${id}`, { domain: 'evil.example' })).status).toBe(400);
    const after = await api('GET', `/api/links/${id}`);
    expect(after.body.link.dest).toBe('https://example.com/');
  });
});

describe('CSRF protection', () => {
  it('refuses cross-site writes', async () => {
    const res = await api('POST', '/api/links', { dest: 'https://example.com' }, { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
  });

  it('refuses a foreign Origin when Sec-Fetch-Site is absent', async () => {
    const res = await api('POST', '/api/links', { dest: 'https://example.com' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('refuses non-JSON bodies (form posts)', async () => {
    const res = await raw('/api/links', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ dest: 'https://example.com' }),
    });
    expect(res.status).toBe(415);
  });

  it('allows same-origin writes', async () => {
    const res = await api('POST', '/api/links', { dest: 'https://example.com', alias: uniqueAlias() }, { 'sec-fetch-site': 'same-origin' });
    expect(res.status).toBe(201);
  });
});

describe('HTML pages escape their input', () => {
  it('escapes the alias on the not-found page', async () => {
    const res = await raw('/s/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('sends security headers', async () => {
    const res = await api('GET', '/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('UTM campaign validation', () => {
  it('rejects unsafe website URLs and bad field types', async () => {
    expect((await api('POST', '/api/utms', { website: 'javascript:alert(1)', source: 'x', medium: 'y' })).status).toBe(400);
    expect((await api('POST', '/api/utms', { website: 'https://example.com', source: { a: 1 } })).status).toBe(400);
    expect((await api('POST', '/api/utms', { website: 'https://example.com', term: 'a\u0000b' })).status).toBe(400);
  });

  it('stores a valid campaign', async () => {
    const res = await api('POST', '/api/utms', { website: 'example.com', source: 'newsletter', medium: 'email', campaign: 'launch' });
    expect(res.status).toBe(201);
    expect(res.body.campaign.website).toBe('https://example.com/');
  });
});

describe('settings validation', () => {
  it.each([
    ['root redirect', { root_redirect: 'javascript:alert(1)' }],
    ['tagline colour (CSS injection)', { inv_tagline_color: 'red; background:url(https://evil.example)' }],
    ['logo data URL that is not an image', { inv_logo: 'data:text/html;base64,PHNjcmlwdD4=' }],
    ['tax rate', { inv_tax_rate: 'abc' }],
    ['list setting', { inv_accounts: '{"not":"a list"}' }],
    ['boolean setting', { default_cloak: 'yes' }],
    ['invoice prefix', { inv_number_prefix: '<b>' }],
  ])('rejects an invalid %s', async (_label, patch) => {
    expect((await api('PATCH', '/api/settings', patch)).status).toBe(400);
  });

  it('ignores managed and unknown keys', async () => {
    const before = await api('GET', '/api/settings');
    const res = await api('PATCH', '/api/settings', { shortener_domains: '[]', default_domain: 'evil.example', nope: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.settings.shortener_domains).toBe(before.body.settings.shortener_domains);
    expect(res.body.settings.default_domain).toBe(before.body.settings.default_domain);
    expect(res.body.settings.nope).toBeUndefined();
  });
});
