import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { api, raw, uniqueAlias } from './helpers';
import { CLOAK_LOCK_SCRIPT } from '../../worker/lib/cloak';

const PERSON = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const DEST = 'https://example.com/inside';
const HOUR = 3_600_000;

const visit = (alias: string, headers: Record<string, string> = {}) => raw(`/s/${alias}`, { headers: { 'user-agent': PERSON, ...headers } });
async function cloaked(extra: Record<string, unknown> = {}) {
  const alias = uniqueAlias('lock');
  const res = await api('POST', '/api/links', { dest: DEST, alias, cloak: true, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return alias;
}
const scriptOf = (html: string) => /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? null;
const timeLeft = (html: string) => Number(/<body data-expires-in="(\d+)">/.exec(html)?.[1] ?? NaN);

describe('a cloaked link that will expire locks itself on screen', () => {
  it('carries how long is left, the script that reloads the page, and a policy that allows exactly that script', async () => {
    const alias = await cloaked({ expires_at: Date.now() + HOUR });
    const res = await visit(alias);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(timeLeft(html)).toBeGreaterThan(HOUR - 10_000);
    expect(timeLeft(html)).toBeLessThanOrEqual(HOUR);
    expect(scriptOf(html)).toBe(CLOAK_LOCK_SCRIPT);
    const hash = createHash('sha256').update(CLOAK_LOCK_SCRIPT).digest('base64');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`script-src 'sha256-${hash}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('frame-src');
    expect(html).toContain('<iframe');
  });

  it('is counted by the server\'s clock, so it follows the date if the owner changes it', async () => {
    const alias = await cloaked({ expires_at: Date.now() + HOUR });
    const id = (await api('GET', `/api/links?search=${alias}`)).body.links[0].id;
    await api('PATCH', `/api/links/${id}`, { expires_at: Date.now() + 5 * 60_000 });
    const left = timeLeft(await (await visit(alias)).text());
    expect(left).toBeLessThanOrEqual(5 * 60_000);
    expect(left).toBeGreaterThan(5 * 60_000 - 10_000);
  });

  it('has none for a link that never expires', async () => {
    const alias = await cloaked();
    const res = await visit(alias);
    const html = await res.text();
    expect(html).not.toMatch(/<script|data-expires-in/);
    expect(res.headers.get('content-security-policy') ?? '').not.toContain('script-src');
  });

  it('is there after a password too: on the page that answers the form, and on later visits with the cookie', async () => {
    const alias = await cloaked({ expires_at: Date.now() + HOUR, password: 'the right password' });
    const answer = await raw(`/s/${alias}`, { method: 'POST', headers: { 'user-agent': PERSON, 'cf-connecting-ip': '203.0.113.170' }, body: new URLSearchParams({ pw: 'the right password' }) });
    expect(answer.status).toBe(200);
    expect(scriptOf(await answer.text())).toBe(CLOAK_LOCK_SCRIPT);
    const later = await visit(alias, { cookie: answer.headers.get('set-cookie')!.split(';')[0] });
    expect(scriptOf(await later.text())).toBe(CLOAK_LOCK_SCRIPT);
  });

  it('and once the time has passed the answer is the expired notice, even with the password cookie', async () => {
    const alias = await cloaked({ expires_at: Date.now() + 2_000, password: 'the right password' });
    const answer = await raw(`/s/${alias}`, { method: 'POST', headers: { 'user-agent': PERSON, 'cf-connecting-ip': '203.0.113.171' }, body: new URLSearchParams({ pw: 'the right password' }) });
    const cookie = answer.headers.get('set-cookie')!.split(';')[0];
    await new Promise((resolve) => setTimeout(resolve, 2_300));
    const res = await visit(alias, { cookie });
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain('This link has expired');
    expect(html).not.toContain('<iframe');
  });

  it('plain redirect links are untouched: nothing to lock, they are already on the destination\'s own site', async () => {
    const alias = uniqueAlias('plain');
    await api('POST', '/api/links', { dest: DEST, alias, expires_at: Date.now() + HOUR });
    const res = await visit(alias);
    expect(res.status).toBe(302);
    expect(await res.text()).toBe('');
  });
});
