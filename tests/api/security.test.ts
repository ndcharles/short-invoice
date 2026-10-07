import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, inject } from 'vitest';
import http from 'node:http';
import { api, baseUrl, raw, TEST_ADMIN } from './helpers';

/**
 * Security regression tests: what an outsider, a signed-out visitor and a
 * member must NOT be able to do, and the protections every response carries.
 */
const ANON = { 'x-dev-user': '' };
const ROOT = path.resolve(__dirname, '../..');

const sqlite = (sql: string) =>
  execFileSync(path.join(ROOT, 'node_modules/.bin/wrangler'), ['d1', 'execute', 'short-invoice', '--local', '--persist-to', inject('persistDir'), '--json', '--command', sql], {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
  });

function getWithHost(host: string, p: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = new URL(baseUrl());
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: p, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('every API route needs a signed-in person', () => {
  const routes: [string, string][] = [
    ['GET', '/api/links'], ['POST', '/api/links'], ['GET', '/api/links/x'], ['PATCH', '/api/links/x'], ['DELETE', '/api/links/x'],
    ['GET', '/api/utms'], ['POST', '/api/utms'], ['GET', '/api/utms/x'], ['PATCH', '/api/utms/x'], ['DELETE', '/api/utms/x'],
    ['GET', '/api/invoices'], ['POST', '/api/invoices'], ['GET', '/api/invoices/x'], ['PATCH', '/api/invoices/x'], ['DELETE', '/api/invoices/x'],
    ['POST', '/api/invoices/x/send'],
    ['GET', '/api/collections?kind=tags'], ['POST', '/api/collections'], ['PATCH', '/api/collections/x'], ['DELETE', '/api/collections/x'],
    ['GET', '/api/settings'], ['PATCH', '/api/settings'],
    ['GET', '/api/metadata?url=https://example.com'],
    ['GET', '/api/analytics/links'],
    ['GET', '/api/domains'], ['POST', '/api/domains'], ['POST', '/api/domains/x.example/verify'], ['POST', '/api/domains/x.example/default'], ['DELETE', '/api/domains/x.example'],
    ['GET', '/api/export'], ['POST', '/api/email/test'],
    ['GET', '/api/team/me'], ['PATCH', '/api/team/me'], ['GET', '/api/team/users'], ['POST', '/api/team/invites'],
    ['POST', '/api/team/users/a@b.co/code'], ['DELETE', '/api/team/users/a@b.co'], ['GET', '/api/team/activity'],
    ['POST', '/api/auth/logout-all'],
  ];
  it.each(routes)('%s %s → 401 without a session', async (method, route) => {
    const res = await api(method, route, undefined, ANON);
    expect(res.status, JSON.stringify(res.body)).toBe(401);
  });

  it('only health, the sign-in endpoints and the verify path answer without one', async () => {
    expect((await api('GET', '/api/health', undefined, ANON)).status).toBe(200);
    expect((await api('GET', '/api/auth/brand', undefined, ANON)).status).toBe(200);
    expect((await api('POST', '/api/auth/check', { email: 'nobody@example.org' }, ANON)).status).toBe(200);
    // Unknown API paths are 401 too: nothing about the API's shape leaks.
    expect((await api('GET', '/api/secret-admin-panel', undefined, ANON)).status).toBe(401);
  });
});

describe('what members cannot do', () => {
  it('cannot reach any admin-only endpoint', async () => {
    const email = `sec-member-${Date.now()}@example.org`;
    expect((await api('POST', '/api/team/invites', { email })).status).toBe(201);
    const member = { 'x-dev-user': email };
    const attempts: [string, string, unknown?][] = [
      ['PATCH', '/api/settings', { workspace_name: 'x' }],
      ['POST', '/api/domains', { name: 'evil.example' }],
      ['POST', '/api/domains/x.example/verify'],
      ['POST', '/api/domains/x.example/default'],
      ['DELETE', '/api/domains/x.example'],
      ['GET', '/api/export'],
      ['POST', '/api/email/test', {}],
      ['POST', '/api/team/invites', { email: 'x@example.org' }],
      ['POST', '/api/team/users/a@example.org/code'],
      ['DELETE', '/api/team/users/a@example.org'],
      ['GET', '/api/team/activity'],
      ['DELETE', '/api/links/x'],
      ['DELETE', '/api/utms/x'],
      ['DELETE', '/api/invoices/x'],
      ['PATCH', '/api/collections/x', { kind: 'tags', name: 'x' }],
      ['DELETE', '/api/collections/x?kind=tags'],
    ];
    for (const [method, route, body] of attempts) {
      const res = await api(method, route, body, member);
      expect(res.status, `${method} ${route}`).toBe(403);
    }
  });

  it('never sees mail-server details or the password in settings, only whether sending is ready', async () => {
    await api('PATCH', '/api/settings', { smtp_host: 'smtp.example.test', smtp_username: 'user@example.test', smtp_from_email: 'billing@example.test' });
    const email = `sec-member2-${Date.now()}@example.org`;
    await api('POST', '/api/team/invites', { email });
    const asMember = (await api('GET', '/api/settings', undefined, { 'x-dev-user': email })).body.settings;
    for (const key of ['smtp_host', 'smtp_port', 'smtp_username', 'smtp_from_email', 'smtp_password', 'smtp_from_name']) expect(asMember[key], key).toBeUndefined();
    expect(asMember.smtp_ready).toBe('true');
    const asAdmin = (await api('GET', '/api/settings')).body.settings;
    expect(asAdmin.smtp_host).toBe('smtp.example.test');
    expect(asAdmin.smtp_password).toBeUndefined();
    await api('PATCH', '/api/settings', { smtp_host: '', smtp_username: '', smtp_from_email: '' });
  });
});

describe('the SMTP password is encrypted in the database', () => {
  it('is stored as ciphertext, decrypts for sending, and is never returned', async () => {
    const secret = `smtp-secret-${Date.now()}`;
    await api('PATCH', '/api/settings', { smtp_password: secret });
    const row = sqlite("SELECT value FROM settings WHERE key = 'smtp_password'");
    expect(row).toContain('enc1:');
    expect(row).not.toContain(secret);
    const everything = JSON.stringify([(await api('GET', '/api/settings')).body, (await api('GET', '/api/export')).body, (await api('GET', '/api/team/users')).body]);
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain('enc1:');
    await api('PATCH', '/api/settings', { smtp_password_clear: 'true' });
  });
});

describe('response headers', () => {
  it('pages the Worker writes itself load nothing, cannot be framed and are not sniffed', async () => {
    const res = await raw('/s/not-a-real-link');
    expect(res.status).toBe(404);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    // No third-party requests (fonts, scripts) from a page a stranger may open.
    const html = await res.text();
    expect(html).not.toMatch(/googleapis|gstatic|<script/i);
  });

  it('API responses are never cached', async () => {
    expect((await api('GET', '/api/team/me')).headers.get('cache-control')).toBe('no-store');
    expect((await api('GET', '/api/team/me', undefined, ANON)).headers.get('cache-control')).toBe('no-store');
  });

  it('a password prompt is not cached and sets no cookie before the password is right', async () => {
    const alias = `pw-${Date.now().toString(36)}`;
    await api('POST', '/api/links', { dest: 'https://example.com/private', alias, password: 'a-link-password-123' });
    const res = await raw(`/s/${alias}`);
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).not.toContain('example.com/private');
  });

  it('a cloaked link page frames only web pages and loads nothing else', async () => {
    const alias = `cl-${Date.now().toString(36)}`;
    await api('POST', '/api/links', { dest: 'https://example.com/cloaked', alias, cloak: true });
    const res = await raw(`/s/${alias}`);
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('frame-src http: https:');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(await res.text()).toContain('referrerpolicy="no-referrer"');
  });
});

describe('untrusted text in generated pages', () => {
  it('is escaped, whatever is put in the address', async () => {
    for (const evil of ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "';alert(1);//"]) {
      const res = await raw(`/s/${encodeURIComponent(evil)}`);
      const html = await res.text();
      expect(html, evil).not.toContain('<script>alert');
      expect(html, evil).not.toContain('<img src=x');
    }
    const onHost = await getWithHost('unknown.example', `/${encodeURIComponent('<b>x</b>')}`);
    expect(onHost.body).not.toContain('<b>x</b>');
  });

  it('a destination that is not a web address can never become a redirect', async () => {
    for (const dest of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'ftp://example.com/x', 'https://user:pass@example.com/', 'https://example.com/\r\nSet-Cookie: x=1']) {
      const res = await api('POST', '/api/links', { dest, alias: `bad-${Math.random().toString(36).slice(2, 8)}` });
      expect(res.status, dest).toBe(400);
    }
  });
});

describe('CSRF and request limits on sign-in too', () => {
  it('refuses cross-site and non-JSON requests to the sign-in endpoints', async () => {
    for (const route of ['/api/auth/login', '/api/auth/check', '/api/auth/setup', '/api/auth/logout']) {
      const cross = await raw(route, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' });
      expect(cross.status, route).toBe(403);
      const form = await raw(route, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a@b.co' });
      expect(form.status, route).toBe(415);
    }
  });

  it('refuses oversized bodies', async () => {
    const big = JSON.stringify({ dest: 'https://example.com/', comments: 'x'.repeat(1_500_000) });
    const res = await api('POST', '/api/links', JSON.parse(big));
    expect(res.status).toBe(413);
  });

  it('does not trust a forwarded IP header for rate limiting', async () => {
    // Without Cloudflare's own header every caller shares one bucket, so spoofing x-forwarded-for gains nothing.
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await raw('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${i}`, 'x-real-ip': `198.51.100.${i}` }, body: JSON.stringify({ email: 'nobody@example.org', password: 'whatever it is' }) });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe('link previews cannot be pointed inside', () => {
  it.each([
    'http://localhost/', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'http://169.254.169.254/latest/meta-data/', 'http://metadata.google.internal/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://100.64.0.1/',
    'http://intranet/', 'http://printer.local/', 'https://example.com:22/', 'https://example.com:8443/', 'https://user:pass@example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)',
  ])('%s is refused', async (url) => {
    const res = await api('GET', `/api/metadata?url=${encodeURIComponent(url)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });
});

describe('secrets and configuration', () => {
  it('the production config has no auth bypass and the workers.dev address is off', async () => {
    const config = await import('node:fs/promises').then((fs) => fs.readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
    expect(config).not.toMatch(/DEV_AUTH_BYPASS|ADMIN_EMAILS|AUTH_PEPPER|LINK_COOKIE_SECRET/);
    expect(config).toMatch(/"workers_dev":\s*false/);
    expect(config).toMatch(/"preview_urls":\s*false/);
    expect(config).not.toMatch(/"vars"/);
  });

  it('the dev bypass only works for localhost with the header, and the admin header is not an admin elsewhere', async () => {
    // The bypass is real here (the test Worker enables it) but a non-team email is refused even so.
    expect((await api('GET', '/api/team/me', undefined, { 'x-dev-user': 'stranger@example.org' })).status).toBe(401);
    expect((await api('GET', '/api/team/me', undefined, { 'x-dev-user': TEST_ADMIN })).status).toBe(200);
  });
});
