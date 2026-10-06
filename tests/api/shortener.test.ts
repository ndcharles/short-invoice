import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { api, baseUrl, raw, uniqueAlias } from './helpers';

const create = async (body: Record<string, unknown>) => {
  const res = await api('POST', '/api/links', { alias: uniqueAlias(), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.link as { id: string; alias: string; domain: string; clicks: number };
};

/** Clicks are written in waitUntil after the response, so poll briefly. */
async function clicksOf(id: string, expected: number) {
  for (let i = 0; i < 40; i++) {
    const res = await api('GET', `/api/links/${id}`);
    if (res.body.link.clicks >= expected) return res.body.link.clicks as number;
    await new Promise((r) => setTimeout(r, 100));
  }
  return (await api('GET', `/api/links/${id}`)).body.link.clicks as number;
}

/** Request with an explicit Host header (fetch does not allow overriding it). */
function requestWithHost(host: string, path: string, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = new URL(baseUrl());
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path, method, headers: { host } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('shorten and redirect', () => {
  it('creates a link with a random alias and redirects to it', async () => {
    const res = await api('POST', '/api/links', { dest: 'https://example.com/landing' });
    expect(res.status).toBe(201);
    const link = res.body.link;
    expect(link.alias).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(link.domain).toBe('4th.link');

    const go = await raw(`/s/${link.alias}`);
    expect(go.status).toBe(302);
    expect(go.headers.get('location')).toBe('https://example.com/landing');
  });

  it('honours a custom alias and refuses duplicates', async () => {
    const alias = uniqueAlias('custom');
    await create({ dest: 'https://example.com', alias });
    const dup = await api('POST', '/api/links', { dest: 'https://example.org', alias });
    expect(dup.status).toBe(409);
  });

  it('appends UTM parameters at redirect time', async () => {
    const link = await create({
      dest: 'https://example.com/page?ref=1',
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'spring sale',
    });
    const go = await raw(`/s/${link.alias}`);
    const location = new URL(go.headers.get('location')!);
    expect(location.searchParams.get('ref')).toBe('1');
    expect(location.searchParams.get('utm_source')).toBe('newsletter');
    expect(location.searchParams.get('utm_medium')).toBe('email');
    expect(location.searchParams.get('utm_campaign')).toBe('spring sale');
  });

  it('counts human clicks and skips bots', async () => {
    const link = await create({ dest: 'https://example.com' });
    await raw(`/s/${link.alias}`, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari' } });
    await raw(`/s/${link.alias}`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36' } });
    await raw(`/s/${link.alias}`, { headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } });
    expect(await clicksOf(link.id, 2)).toBe(2);

    const stats = await api('GET', '/api/analytics/links?range=7d');
    expect(stats.status).toBe(200);
    expect(stats.body.summary.totalClicks).toBeGreaterThanOrEqual(2);
    expect(stats.body.devices.map((d: { name: string }) => d.name)).toEqual(expect.arrayContaining(['Mobile', 'Desktop']));
  });

  it('reports referrers, countries and the previous period in analytics', async () => {
    const link = await create({ dest: 'https://example.com' });
    await raw(`/s/${link.alias}`, {
      headers: { 'user-agent': 'Mozilla/5.0 Firefox/120', referer: 'https://news.example.org/item?id=1', 'cf-ipcountry': 'NG' },
    });
    await clicksOf(link.id, 1);
    for (const range of ['7d', '30d', '90d']) {
      const stats = await api('GET', `/api/analytics/links?range=${range}`);
      expect(stats.status).toBe(200);
      expect(stats.body.range).toBe(range);
      expect(stats.body.timeSeries).toHaveLength(Number(range.replace('d', '')));
      expect(stats.body.referrers.map((r: { name: string }) => r.name)).toContain('news.example.org');
      expect(typeof stats.body.summary.previousClicks).toBe('number');
      expect(stats.body.topLinks[0]).toHaveProperty('domain');
    }
  });

  it('returns a 404 page for unknown aliases', async () => {
    const res = await raw('/s/does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Link not found');
  });
});

describe('cloaked links', () => {
  it('serves the destination in a full-page iframe', async () => {
    const link = await create({ dest: 'https://example.com/cloaked', cloak: true });
    const res = await raw(`/s/${link.alias}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<iframe src="https://example.com/cloaked"');
    expect(html).toContain('noindex');
  });
});

describe('password-protected links', () => {
  it('asks for the password, rejects a wrong one and remembers a right one', async () => {
    const link = await create({ dest: 'https://example.com/secret', password: 'hunter2' });

    const gate = await raw(`/s/${link.alias}`);
    expect(gate.status).toBe(401);
    expect(await gate.text()).toContain('password protected');

    const wrong = await raw(`/s/${link.alias}`, { method: 'POST', body: new URLSearchParams({ pw: 'nope' }) });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain('Incorrect password');
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const right = await raw(`/s/${link.alias}`, { method: 'POST', body: new URLSearchParams({ pw: 'hunter2' }) });
    expect(right.status).toBe(303);
    expect(right.headers.get('location')).toBe('https://example.com/secret');
    const cookie = right.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(new RegExp(`Path=/s/${link.alias}`));

    const again = await raw(`/s/${link.alias}`, { headers: { cookie: cookie.split(';')[0] } });
    expect(again.status).toBe(302);

    // Changing the password invalidates the cookie.
    await api('PATCH', `/api/links/${link.id}`, { password: 'new-password' });
    const stale = await raw(`/s/${link.alias}`, { headers: { cookie: cookie.split(';')[0] } });
    expect(stale.status).toBe(401);

    // Removing the password opens the link.
    await api('PATCH', `/api/links/${link.id}`, { password: null });
    expect((await raw(`/s/${link.alias}`)).status).toBe(302);
  });

  it('rejects forged cookies', async () => {
    const link = await create({ dest: 'https://example.com', password: 'pw-123' });
    const name = `unlock_${link.id}`;
    for (const value of ['x', `${Date.now() + 1e9}.AAAA`, `${Date.now() + 1e9}.`]) {
      const res = await raw(`/s/${link.alias}`, { headers: { cookie: `${name}=${value}` } });
      expect(res.status).toBe(401);
    }
  });
});

describe('expiring links', () => {
  it('shows an expired page after the expiry time', async () => {
    const link = await create({ dest: 'https://example.com', expires_at: Date.now() - 1000 });
    const res = await raw(`/s/${link.alias}`);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain('expired');
  });

  it('redirects to the expired-link URL when set', async () => {
    const link = await create({ dest: 'https://example.com', expires_at: Date.now() - 1000, expires_url: 'https://example.com/expired' });
    const res = await raw(`/s/${link.alias}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/expired');
  });

  it('works normally before the expiry time and accepts ISO dates', async () => {
    const link = await create({ dest: 'https://example.com', expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await raw(`/s/${link.alias}`)).status).toBe(302);
  });

  it('can have its expiry cleared', async () => {
    const link = await create({ dest: 'https://example.com', expires_at: Date.now() - 1000 });
    await api('PATCH', `/api/links/${link.id}`, { expires_at: null });
    expect((await raw(`/s/${link.alias}`)).status).toBe(302);
  });
});

describe('editing, archiving and deleting', () => {
  it('moves a link to a new alias and destination', async () => {
    const link = await create({ dest: 'https://example.com/old' });
    const alias = uniqueAlias('renamed');
    const res = await api('PATCH', `/api/links/${link.id}`, { alias, dest: 'https://example.com/new' });
    expect(res.status).toBe(200);
    expect((await raw(`/s/${link.alias}`)).status).toBe(404);
    const go = await raw(`/s/${alias}`);
    expect(go.headers.get('location')).toBe('https://example.com/new');
  });

  it('refuses an alias that another link uses', async () => {
    const a = await create({ dest: 'https://example.com/a' });
    const b = await create({ dest: 'https://example.com/b' });
    const res = await api('PATCH', `/api/links/${b.id}`, { alias: a.alias });
    expect(res.status).toBe(409);
  });

  it('stops redirecting archived links and lists them separately', async () => {
    const link = await create({ dest: 'https://example.com' });
    await api('PATCH', `/api/links/${link.id}`, { archived: true });
    expect((await raw(`/s/${link.alias}`)).status).toBe(404);
    const archived = await api('GET', `/api/links?archived=1&search=${link.alias}`);
    expect(archived.body.links).toHaveLength(1);
    await api('PATCH', `/api/links/${link.id}`, { archived: false });
    expect((await raw(`/s/${link.alias}`)).status).toBe(302);
  });

  it('deletes a link and its click history', async () => {
    const link = await create({ dest: 'https://example.com' });
    await raw(`/s/${link.alias}`, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/120' } });
    expect((await api('DELETE', `/api/links/${link.id}`)).status).toBe(200);
    expect((await api('GET', `/api/links/${link.id}`)).status).toBe(404);
    expect((await raw(`/s/${link.alias}`)).status).toBe(404);
  });

  it('keeps tags and folders on links in step with renames', async () => {
    const folder = await api('POST', '/api/collections', { kind: 'folders', name: uniqueAlias('Folder') });
    const tag = await api('POST', '/api/collections', { kind: 'tags', name: uniqueAlias('Tag') });
    const link = await create({ dest: 'https://example.com', folder: folder.body.item.name, tag: tag.body.item.name });

    const newFolder = uniqueAlias('Renamed');
    await api('PATCH', `/api/collections/${folder.body.item.id}`, { kind: 'folders', name: newFolder });
    await api('DELETE', `/api/collections/${tag.body.item.id}?kind=tags`);

    const after = (await api('GET', `/api/links/${link.id}`)).body.link;
    expect(after.folder).toBe(newFolder);
    expect(after.tag).toBeNull();
  });

  it('protects built-in folders', async () => {
    const list = await api('GET', '/api/collections?kind=folders');
    const invoices = list.body.items.find((f: { name: string }) => f.name === 'Invoices');
    expect((await api('DELETE', `/api/collections/${invoices.id}?kind=folders`)).status).toBe(409);
    expect((await api('PATCH', `/api/collections/${invoices.id}`, { kind: 'folders', name: 'Bills' })).status).toBe(409);
  });
});

describe('custom short domains', () => {
  const domain = `go${Date.now().toString(36)}.example`;

  it('adds, verifies and serves links on a custom domain', async () => {
    const added = await api('POST', '/api/domains', { name: `https://${domain.toUpperCase()}/` });
    expect(added.status).toBe(201);
    const entry = added.body.domains.find((d: { name: string }) => d.name === domain);
    expect(entry.status).toBe('pending');

    // The test Worker answers the verification request for any domain.
    const verified = await api('POST', `/api/domains/${domain}/verify`);
    expect(verified.status).toBe(200);
    expect(verified.body.verified).toBe(true);
    expect(verified.body.domains.find((d: { name: string }) => d.name === domain).status).toBe('active');

    const link = await create({ dest: 'https://example.com/on-custom-domain', domain });
    expect(link.domain).toBe(domain);

    const go = await requestWithHost(domain, `/${link.alias}`);
    expect(go.status).toBe(302);
    expect(go.headers.location).toBe('https://example.com/on-custom-domain');

    // A different domain's alias space is separate.
    const other = await requestWithHost('unknown.example', `/${link.alias}`);
    expect(other.status).toBe(404);

    const missing = await requestWithHost(domain, '/no-such-alias');
    expect(missing.status).toBe(404);
    expect(missing.body).toContain('Link not found');
  });

  it('applies the root redirect on a short domain only', async () => {
    await api('PATCH', '/api/settings', { root_redirect: 'https://example.com/home' });
    const root = await requestWithHost(domain, '/');
    expect(root.status).toBe(302);
    expect(root.headers.location).toBe('https://example.com/home');

    const appRoot = await raw('/');
    expect(appRoot.status).toBeLessThan(400);
    expect(appRoot.headers.get('location') ?? '').not.toBe('https://example.com/home');
    await api('PATCH', '/api/settings', { root_redirect: '' });
  });

  it('refuses duplicates, invalid names and the app host', async () => {
    expect((await api('POST', '/api/domains', { name: domain })).status).toBe(409);
    expect((await api('POST', '/api/domains', { name: 'not a domain' })).status).toBe(400);
    expect((await api('POST', '/api/domains', { name: 'evil.example/path?x' })).status).toBe(400);
    expect((await api('POST', '/api/domains', { name: 'x.workers.dev' })).status).toBe(400);
  });

  it('makes a domain the default and protects domains in use', async () => {
    const res = await api('POST', `/api/domains/${domain}/default`);
    expect(res.body.default_domain).toBe(domain);
    // The default cannot be removed; neither can a domain with links.
    expect((await api('DELETE', `/api/domains/${domain}`)).status).toBe(409);
    await api('POST', '/api/domains/4th.link/default');
    expect((await api('DELETE', `/api/domains/${domain}`)).status).toBe(409);
  });

  it('removes an unused pending domain', async () => {
    const spare = `spare${Date.now().toString(36)}.example`;
    await api('POST', '/api/domains', { name: spare });
    const res = await api('DELETE', `/api/domains/${spare}`);
    expect(res.status).toBe(200);
    expect(res.body.domains.map((d: { name: string }) => d.name)).not.toContain(spare);
  });

  it('falls back to the app 404 page for unknown paths on the app host', async () => {
    const res = await raw('/definitely-not-a-page');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('serves the static app at the root and sets security headers on it', async () => {
    const res = await raw('/');
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
