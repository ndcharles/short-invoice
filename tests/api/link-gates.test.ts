import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { api, baseUrl, raw, uniqueAlias } from './helpers';

/** A request with its own Host header (fetch will not let a test set one) and, optionally, a form body. */
function asHost(host: string, path: string, init: { method?: string; form?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const url = new URL(baseUrl());
  const body = init.form ? new URLSearchParams(init.form).toString() : undefined;
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method: init.method ?? 'GET',
        headers: { host, ...(body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}), ...init.headers },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

const submit = (alias: string, pw: string, ip: string) =>
  raw(`/s/${alias}`, { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: new URLSearchParams({ pw }) });

async function passwordLink(password = 'the right password') {
  const alias = uniqueAlias('gate');
  const res = await api('POST', '/api/links', { dest: 'https://example.com/private', alias, password });
  expect(res.status).toBe(201);
  return { alias, id: res.body.link.id as string, password };
}

describe('the password page', () => {
  it('lets the visitor be sent on to any website once the password is right (Chrome applies form-action to that redirect)', async () => {
    const { alias } = await passwordLink();
    const csp = (await raw(`/s/${alias}`)).headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/form-action 'self' http: https:(;|$)/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Wrong-password and rate-limited pages carry the same policy.
    const wrong = await submit(alias, 'nope', '203.0.113.201');
    expect(wrong.headers.get('content-security-policy') ?? '').toMatch(/form-action 'self' http: https:/);
  });

  it('pages without a form refuse every form submission', async () => {
    const missing = await raw('/s/definitely-not-a-link');
    expect(missing.headers.get('content-security-policy') ?? '').toContain("form-action 'none'");
    const expired = await api('POST', '/api/links', { dest: 'https://example.com', alias: uniqueAlias('exp'), expires_at: Date.now() - 1000 });
    const page = await raw(`/s/${expired.body.link.alias}`);
    expect(page.headers.get('content-security-policy') ?? '').toContain("form-action 'none'");
  });
});

describe('guessing a link password is slow', () => {
  it('allows 10 tries per visitor in 10 minutes, then refuses even the right password', async () => {
    const { alias, password } = await passwordLink();
    const ip = '203.0.113.50';
    for (let i = 0; i < 10; i += 1) expect((await submit(alias, `wrong ${i}`, ip)).status, `try ${i + 1}`).toBe(401);

    const blocked = await submit(alias, password, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('600');
    expect(blocked.headers.get('cache-control')).toBe('no-store');
    expect(blocked.headers.get('set-cookie')).toBeNull();
    expect(await blocked.text()).toContain('Too many attempts');
    expect((await submit(alias, password, ip)).status).toBe(429);
  });

  it('is per visitor: someone else can still unlock, and the first visitor stays blocked', async () => {
    const { alias, password } = await passwordLink();
    for (let i = 0; i < 10; i += 1) await submit(alias, `wrong ${i}`, '203.0.113.60');
    expect((await submit(alias, password, '203.0.113.60')).status).toBe(429);
    const other = await submit(alias, password, '203.0.113.61');
    expect(other.status).toBe(303);
    expect(other.headers.get('location')).toBe('https://example.com/private');
  });

  it('is per link: the same visitor has a separate allowance on another link', async () => {
    const first = await passwordLink();
    const second = await passwordLink();
    for (let i = 0; i < 10; i += 1) await submit(first.alias, `wrong ${i}`, '203.0.113.70');
    expect((await submit(first.alias, first.password, '203.0.113.70')).status).toBe(429);
    expect((await submit(second.alias, second.password, '203.0.113.70')).status).toBe(303);
  });

  it('never slows down a visitor who is already unlocked', async () => {
    const { alias, password } = await passwordLink();
    const ip = '203.0.113.80';
    const unlocked = await submit(alias, password, ip);
    expect(unlocked.status).toBe(303);
    const cookie = unlocked.headers.get('set-cookie')!.split(';')[0];
    for (let i = 0; i < 12; i += 1) await submit(alias, `wrong ${i}`, ip);
    expect((await submit(alias, password, ip)).status).toBe(429);
    const stillIn = await raw(`/s/${alias}`, { headers: { cookie, 'cf-connecting-ip': ip } });
    expect(stillIn.status).toBe(302);
  });

  it('caps guessing across everyone, so spreading guesses over many addresses does not help', async () => {
    const { alias, password } = await passwordLink();
    // 300 wrong tries an hour for the whole link, each from a different address.
    for (let start = 0; start < 300; start += 30) {
      const batch = await Promise.all(Array.from({ length: 30 }, (_, i) => submit(alias, `guess ${start + i}`, `198.51.${Math.floor((start + i) / 250)}.${((start + i) % 250) + 1}`)));
      for (const res of batch) expect(res.status).toBe(401);
    }
    const next = await submit(alias, password, '192.0.2.250');
    expect(next.status).toBe(429);
  }, 60_000);
});

describe('on a short domain (like trim.ng)', () => {
  it('asks for the password, sets the unlock cookie on the right one, and remembers the visitor', async () => {
    const domain = `gate${Date.now().toString(36)}.example`;
    await api('POST', '/api/domains', { name: domain });
    await asHost(domain, '/.well-known/short-invoice?ping=1'); // a request through the domain verifies it
    const alias = uniqueAlias('onhost');
    const created = await api('POST', '/api/links', { dest: 'https://example.com/on-domain', alias, domain, password: 'domain password' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const gate = await asHost(domain, `/${alias}`);
    expect(gate.status).toBe(401);
    expect(gate.headers['content-security-policy']).toMatch(/form-action 'self' http: https:/);
    expect(gate.body).toContain(`action="/${alias}"`);

    const wrong = await asHost(domain, `/${alias}`, { method: 'POST', form: { pw: 'wrong' } });
    expect(wrong.status).toBe(401);
    const right = await asHost(domain, `/${alias}`, { method: 'POST', form: { pw: 'domain password' } });
    expect(right.status).toBe(303);
    expect(right.headers.location).toBe('https://example.com/on-domain');
    const cookie = String(right.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`Path=/${alias}`));

    const again = await asHost(domain, `/${alias}`, { headers: { cookie: cookie.split(';')[0] } });
    expect(again.status).toBe(302);
  });
});

describe('expiration', () => {
  it('an expired link is gone even if it also has a password: no prompt, no destination', async () => {
    const alias = uniqueAlias('expgate');
    await api('POST', '/api/links', { dest: 'https://example.com/hidden', alias, password: 'whatever it is', expires_at: Date.now() - 1000 });
    const res = await raw(`/s/${alias}`);
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain('expired');
    expect(html).not.toContain('password');
    expect(html).not.toContain('example.com/hidden');
    expect((await submit(alias, 'whatever it is', '203.0.113.90')).status).toBe(410);
  });

  it('is not counted as a click once expired, and works up to the last moment', async () => {
    const alias = uniqueAlias('edge');
    const created = await api('POST', '/api/links', { dest: 'https://example.com/limited', alias, expires_at: Date.now() + 2500 });
    expect((await raw(`/s/${alias}`, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' } })).status).toBe(302);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect((await raw(`/s/${alias}`, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' } })).status).toBe(410);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await api('GET', `/api/links/${created.body.link.id}`)).body.link.clicks).toBe(1);
  });

  it('refuses a date it cannot read instead of quietly clearing the expiry', async () => {
    const alias = uniqueAlias('badexp');
    const created = await api('POST', '/api/links', { dest: 'https://example.com/x', alias, expires_at: Date.now() + 86_400_000 });
    const id = created.body.link.id as string;
    const before = created.body.link.expires_at as number;
    for (const bad of ['next tuesday-ish', 'banana', '2026-13-45']) {
      const res = await api('PATCH', `/api/links/${id}`, { expires_at: bad });
      expect(res.status, bad).toBe(400);
    }
    expect((await api('GET', `/api/links/${id}`)).body.link.expires_at).toBe(before);
  });

  it('refuses a fallback address that is not a web address', async () => {
    for (const bad of ['javascript:alert(1)', 'ftp://example.com/x', 'not a url']) {
      const res = await api('POST', '/api/links', { dest: 'https://example.com/x', alias: uniqueAlias('badurl'), expires_at: Date.now() - 1000, expires_url: bad });
      expect(res.status, bad).toBe(400);
    }
  });
});

describe('where an expired link sends visitors', () => {
  const home = 'https://example.com/company-home';
  const past = () => Date.now() - 60_000;

  /** Runs with the Settings → URL Shortener "Redirect URL" set, and always puts it back. */
  async function withRedirectUrl(url: string, run: () => Promise<void>) {
    expect((await api('PATCH', '/api/settings', { root_redirect: url })).status).toBe(200);
    try {
      await run();
    } finally {
      await api('PATCH', '/api/settings', { root_redirect: '' });
    }
  }

  it('to the link\'s own expiration URL when it has one, even when Settings has a Redirect URL', async () => {
    const alias = uniqueAlias('own');
    await api('POST', '/api/links', { dest: 'https://example.com/x', alias, expires_at: past(), expires_url: 'https://example.com/own-fallback' });
    await withRedirectUrl(home, async () => {
      const res = await raw(`/s/${alias}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://example.com/own-fallback');
    });
  });

  it('otherwise to the Redirect URL from Settings, the same place a missing link goes', async () => {
    const alias = uniqueAlias('settings');
    await api('POST', '/api/links', { dest: 'https://example.com/x', alias, expires_at: past() });
    await withRedirectUrl(home, async () => {
      const expired = await raw(`/s/${alias}`);
      expect(expired.status).toBe(302);
      expect(expired.headers.get('location')).toBe(home);
      const missing = await raw('/s/this-alias-does-not-exist');
      expect(missing.headers.get('location')).toBe(home);
    });
  });

  it('otherwise the plain expired page (HTTP 410)', async () => {
    const alias = uniqueAlias('plain');
    await api('POST', '/api/links', { dest: 'https://example.com/x', alias, expires_at: past() });
    const res = await raw(`/s/${alias}`);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain('This link has expired');
  });

  it('is not used by links that have not expired, and stops being used once the Settings URL is cleared', async () => {
    const live = uniqueAlias('live');
    const gone = uniqueAlias('gone');
    await api('POST', '/api/links', { dest: 'https://example.com/still-works', alias: live, expires_at: Date.now() + 3_600_000 });
    await api('POST', '/api/links', { dest: 'https://example.com/x', alias: gone, expires_at: past() });
    await withRedirectUrl(home, async () => {
      expect((await raw(`/s/${live}`)).headers.get('location')).toBe('https://example.com/still-works');
      expect((await raw(`/s/${gone}`)).headers.get('location')).toBe(home);
    });
    expect((await raw(`/s/${gone}`)).status).toBe(410);
  });

  it('skips the password prompt, and a form posted just as it expired still ends up there', async () => {
    const alias = uniqueAlias('pwexp');
    await api('POST', '/api/links', { dest: 'https://example.com/hidden', alias, password: 'a password here', expires_at: past() });
    await withRedirectUrl(home, async () => {
      const visit = await raw(`/s/${alias}`);
      expect(visit.status).toBe(302);
      expect(visit.headers.get('location')).toBe(home);
      const post = await submit(alias, 'a password here', '203.0.113.99');
      expect(post.status).toBe(303); // 303 so the browser follows with a GET
      expect(post.headers.get('location')).toBe(home);
      expect(post.headers.get('set-cookie')).toBeNull();
    });
  });

  it('works on a short domain (like trim.ng) too', async () => {
    const domain = `exp${Date.now().toString(36)}.example`;
    await api('POST', '/api/domains', { name: domain });
    await asHost(domain, '/.well-known/short-invoice?ping=1');
    const alias = uniqueAlias('hostexp');
    const created = await api('POST', '/api/links', { dest: 'https://example.com/x', alias, domain, expires_at: past() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await withRedirectUrl(home, async () => {
      const res = await asHost(domain, `/${alias}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(home);
    });
  });
});
