import { describe, expect, it } from 'vitest';
import { api, raw, TEST_ADMIN } from './helpers';

/**
 * Real sign-in, end to end: no `x-dev-user` here, only the session cookie.
 * Each test uses its own client IP so the per-IP rate limits do not overlap.
 */
let ipCounter = 0;
const newIp = () => `203.0.113.${(ipCounter += 1)}`;

async function post(path: string, body: unknown, opts: { ip?: string; cookie?: string } = {}) {
  const res = await raw(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': opts.ip ?? newIp(),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') ?? '' };
}

const cookieFrom = (setCookie: string) => setCookie.split(';')[0];
const me = (cookie?: string) => raw('/api/team/me', { headers: cookie ? { cookie } : {} });

let counter = 0;
async function addPerson() {
  counter += 1;
  const email = `person${counter}.${Date.now().toString(36)}@example.org`;
  const res = await api('POST', '/api/team/invites', { email });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { email, code: res.body.code as string };
}

async function signedUp(password = 'correct horse battery') {
  const person = await addPerson();
  const res = await post('/api/auth/setup', { email: person.email, code: person.code, name: 'Test Person', password });
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  return { ...person, password, cookie: cookieFrom(res.setCookie) };
}

describe('the email step', () => {
  it('says nothing for unknown emails, and which form comes next for known ones', async () => {
    expect((await post('/api/auth/check', { email: 'nobody@example.org' })).data).toEqual({ next: null });
    const person = await addPerson();
    expect((await post('/api/auth/check', { email: person.email.toUpperCase() })).data).toEqual({ next: 'setup' });
    const active = await signedUp();
    expect((await post('/api/auth/check', { email: active.email })).data).toEqual({ next: 'password' });
  });

  it('goes quiet for everyone once an IP checks too often', async () => {
    const ip = newIp();
    const person = await addPerson();
    for (let i = 0; i < 30; i += 1) await post('/api/auth/check', { email: `x${i}@example.org` }, { ip });
    expect((await post('/api/auth/check', { email: person.email }, { ip })).data).toEqual({ next: null });
  });
});

describe('first sign-in with a setup code', () => {
  it('creates the account and a 365-day, locked-down session cookie', async () => {
    const person = await addPerson();
    const res = await post('/api/auth/setup', { email: person.email, code: person.code.toLowerCase(), name: 'Ada', password: 'a long enough secret' });
    expect(res.status).toBe(200);
    expect(res.setCookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{40,};/);
    for (const part of ['Path=/', 'Max-Age=31536000', 'HttpOnly', 'Secure', 'SameSite=Strict']) expect(res.setCookie).toContain(part);

    const who = await me(cookieFrom(res.setCookie));
    expect(who.status).toBe(200);
    expect((await who.json()).user).toMatchObject({ email: person.email, name: 'Ada', role: 'member' });
  });

  it('accepts a code only once', async () => {
    const person = await addPerson();
    const body = { email: person.email, code: person.code, name: 'Ada', password: 'a long enough secret' };
    expect((await post('/api/auth/setup', body)).status).toBe(200);
    expect((await post('/api/auth/setup', { ...body, password: 'another long secret' })).status).toBe(400);
  });

  it('burns the code after five wrong guesses', async () => {
    const person = await addPerson();
    const ip = newIp();
    for (let i = 0; i < 4; i += 1) {
      const res = await post('/api/auth/setup', { email: person.email, code: 'AAAAA-AAAAA', name: 'X', password: 'a long enough secret' }, { ip });
      expect(res.data.error).toBe('That code is not right.');
    }
    const fifth = await post('/api/auth/setup', { email: person.email, code: 'AAAAA-AAAAA', name: 'X', password: 'a long enough secret' }, { ip });
    expect(fifth.data.error).toContain('no longer works');
    // Even the right code is refused now; the admin has to issue a new one.
    const right = await post('/api/auth/setup', { email: person.email, code: person.code, name: 'X', password: 'a long enough secret' });
    expect(right.status).toBe(400);
    expect((await post('/api/auth/check', { email: person.email })).data).toEqual({ next: null });

    const fresh = await api('POST', `/api/team/users/${encodeURIComponent(person.email)}/code`);
    expect(fresh.status).toBe(200);
    expect((await post('/api/auth/setup', { email: person.email, code: fresh.body.code, name: 'X', password: 'a long enough secret' })).status).toBe(200);
  });

  it.each([
    ['short', 'too short', 'at least 12'],
    ['containing the email name', 'PERSON-is-my-password', 'email'],
    ['all the same character', 'aaaaaaaaaaaaaaaa', 'too easy'],
  ])('refuses a password that is %s', async (_label, password, message) => {
    const person = await addPerson();
    const res = await post('/api/auth/setup', { email: person.email, code: person.code, name: 'X', password: password.replace('PERSON', person.email.split('@')[0]) });
    expect(res.status).toBe(400);
    expect(String(res.data.error)).toContain(message);
  });

  it('requires a name', async () => {
    const person = await addPerson();
    expect((await post('/api/auth/setup', { email: person.email, code: person.code, name: ' ', password: 'a long enough secret' })).status).toBe(400);
  });
});

describe('signing in with a password', () => {
  it('signs in with the right password, case-insensitive email', async () => {
    const person = await signedUp();
    const res = await post('/api/auth/login', { email: person.email.toUpperCase(), password: person.password });
    expect(res.status).toBe(200);
    expect((await me(cookieFrom(res.setCookie))).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const person = await signedUp();
    const wrong = await post('/api/auth/login', { email: person.email, password: 'not the password' });
    const unknown = await post('/api/auth/login', { email: 'nobody@example.org', password: 'whatever it is' });
    expect(wrong).toMatchObject({ status: 401, data: { error: 'That password is not right.' } });
    expect(unknown).toMatchObject({ status: 401, data: { error: 'That password is not right.' } });
    expect(wrong.setCookie).toBe('');
  });

  it('locks the account after five wrong passwords, even with the right one', async () => {
    const person = await signedUp();
    for (let i = 0; i < 5; i += 1) await post('/api/auth/login', { email: person.email, password: `wrong ${i} password` });
    const locked = await post('/api/auth/login', { email: person.email, password: person.password });
    expect(locked.status).toBe(429);
    expect(String(locked.data.error)).toContain('Try again in 15 minutes');
  });

  it('limits attempts per IP across accounts', async () => {
    const ip = newIp();
    for (let i = 0; i < 20; i += 1) await post('/api/auth/login', { email: `x${i}@example.org`, password: 'guessing here' }, { ip });
    expect((await post('/api/auth/login', { email: 'x@example.org', password: 'guessing here' }, { ip })).status).toBe(429);
  });
});

describe('sessions', () => {
  it('refuses requests without a session or with a made-up one', async () => {
    expect((await me()).status).toBe(401);
    expect((await me('__Host-session=made-up-token-that-is-long-enough-0000000000')).status).toBe(401);
    expect((await api('GET', '/api/links', undefined, { 'x-dev-user': '' })).status).toBe(401);
  });

  it('keeps sign-in, health and the sign-in page brand public, and nothing else', async () => {
    expect((await raw('/api/health')).status).toBe(200);
    const brand = await raw('/api/auth/brand');
    expect(brand.status).toBe(200);
    expect(Object.keys(await brand.json()).sort()).toEqual(['logo', 'name']);
    for (const path of ['/api/settings', '/api/invoices', '/api/team/users', '/api/export']) expect((await raw(path)).status).toBe(401);
  });

  it('signs out this device only', async () => {
    const person = await signedUp();
    const other = cookieFrom((await post('/api/auth/login', { email: person.email, password: person.password })).setCookie);
    const out = await post('/api/auth/logout', {}, { cookie: person.cookie });
    expect(out.setCookie).toContain('Max-Age=0');
    expect((await me(person.cookie)).status).toBe(401);
    expect((await me(other)).status).toBe(200);
  });

  it('signs out every device', async () => {
    const person = await signedUp();
    const other = cookieFrom((await post('/api/auth/login', { email: person.email, password: person.password })).setCookie);
    expect((await post('/api/auth/logout-all', {}, { cookie: person.cookie })).status).toBe(200);
    expect((await me(person.cookie)).status).toBe(401);
    expect((await me(other)).status).toBe(401);
  });

  it('ends every session when an admin removes the person', async () => {
    const person = await signedUp();
    expect((await me(person.cookie)).status).toBe(200);
    await api('DELETE', `/api/team/users/${encodeURIComponent(person.email)}`);
    expect((await me(person.cookie)).status).toBe(401);
    expect((await post('/api/auth/login', { email: person.email, password: person.password })).status).toBe(401);
    expect((await post('/api/auth/check', { email: person.email })).data).toEqual({ next: null });
  });

  it('re-inviting resets the password: the old one stops working', async () => {
    const person = await signedUp();
    await api('DELETE', `/api/team/users/${encodeURIComponent(person.email)}`);
    const again = await api('POST', '/api/team/invites', { email: person.email });
    expect((await post('/api/auth/login', { email: person.email, password: person.password })).status).toBe(401);
    expect((await post('/api/auth/setup', { email: person.email, code: again.body.code, name: 'Back', password: 'a brand new secret' })).status).toBe(200);
  });

  it('records sign-ins in the activity feed', async () => {
    const person = await signedUp();
    await post('/api/auth/login', { email: person.email, password: person.password });
    const feed = (await api('GET', `/api/team/activity?actor=${encodeURIComponent(person.email)}`)).body.activity as { action: string }[];
    expect(feed.map((a) => a.action)).toEqual(expect.arrayContaining(['joined', 'signed in']));
  });

  it('never needs the dev header in production paths', () => {
    expect(TEST_ADMIN).toBe('boss@test.example');
  });
});
