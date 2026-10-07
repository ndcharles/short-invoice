import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, seedLink } from './helpers';
import { cloakPage } from '../../worker/lib/cloak';

const run = chromeAvailable ? describe : describe.skip;

let browser: Browser;
let destination: http.Server;
let dest = '';

beforeAll(async () => {
  browser = await launch();
  // A real web server on another port, so every redirect to it is genuinely cross-origin, as on the internet.
  destination = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Destination</title><h1 id="dest">DESTINATION ${req.url}</h1>`);
  });
  await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve));
  dest = `http://127.0.0.1:${(destination.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await browser?.close();
  destination?.close();
});

const visitor = () => openSession(browser, { user: null });

run('Password-protected links, as a visitor in Chrome', () => {
  it('refuses a wrong password, lets the right one through to the destination, and remembers the visitor', async () => {
    const link = await seedLink({ dest: `${dest}/landing`, password: 'correct horse battery' });
    const v = await visitor();
    try {
      const p = v.page;
      await p.goto(`/s/${link.alias}`);
      await expect(p.getByText('This link is password protected')).toBeVisible();

      await p.getByLabel('Password').fill('not the password');
      await p.getByRole('button', { name: 'Unlock link' }).click();
      await expect(p.getByText('Incorrect password')).toBeVisible();

      await p.getByLabel('Password').fill('correct horse battery');
      await p.getByRole('button', { name: 'Unlock link' }).click();
      await p.waitForURL((url) => url.origin === dest, { timeout: 10_000 });
      await expect(p.locator('#dest')).toContainText('/landing');
      expect(v.errors).toEqual([]);

      // Same browser, next visit: straight through, no password page.
      await p.goto(`/s/${link.alias}`);
      await p.waitForURL((url) => url.origin === dest, { timeout: 10_000 });
      const cookie = (await v.context.cookies()).find((c) => c.name.startsWith('lk_') || c.name.includes('unlock'));
      expect(cookie, JSON.stringify(await v.context.cookies())).toBeTruthy();
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

      // Someone else, or the same person on another device, is asked again.
      const other = await visitor();
      try {
        await other.page.goto(`/s/${link.alias}`);
        await expect(other.page.getByText('This link is password protected')).toBeVisible();
      } finally {
        await other.context.close();
      }

      // Changing the password signs everyone out of the link.
      expect((await api('PATCH', `/api/links/${link.id}`, { password: 'a brand new password' })).status).toBe(200);
      await p.goto(`/s/${link.alias}`);
      await expect(p.getByText('This link is password protected')).toBeVisible();
    } finally {
      await v.context.close();
    }
  });

  it('shows the cloaked page after unlocking', async () => {
    const link = await seedLink({ dest: `${dest}/cloaked-and-locked`, password: 'open sesame please', cloak: true });
    const v = await visitor();
    try {
      await v.page.goto(`/s/${link.alias}`);
      await v.page.getByLabel('Password').fill('open sesame please');
      await v.page.getByRole('button', { name: 'Unlock link' }).click();
      await expect(v.page.frameLocator('iframe').locator('#dest')).toContainText('/cloaked-and-locked');
      expect(v.page.url()).toContain(`/s/${link.alias}`);
    } finally {
      await v.context.close();
    }
  });
});

run('Expiration, as a visitor in Chrome', () => {
  it('an expired link shows the expired page, not the destination or a password prompt', async () => {
    const link = await seedLink({ dest: `${dest}/gone`, expires_at: Date.now() - 60_000, password: 'irrelevant password' });
    const v = await visitor();
    try {
      const res = await v.page.goto(`/s/${link.alias}`);
      expect(res?.status()).toBe(410);
      await expect(v.page.getByText('This link has expired')).toBeVisible();
      await expect(v.page.getByText('password protected')).toHaveCount(0);
    } finally {
      await v.context.close();
    }
  });

  it('an expired link says so, then moves on to its own fallback address', async () => {
    const link = await seedLink({ dest: `${dest}/gone`, expires_at: Date.now() - 60_000, expires_url: `${dest}/sorry-it-ended` });
    const v = await visitor();
    try {
      await v.page.goto(`/s/${link.alias}`);
      await expect(v.page.getByText('This link has expired')).toBeVisible();
      expect(v.page.url()).toContain(`/s/${link.alias}`); // still on the notice
      await v.page.waitForURL((url) => url.origin === dest, { timeout: 15_000 });
      await expect(v.page.locator('#dest')).toContainText('/sorry-it-ended');
      expect(v.errors).toEqual([]);
    } finally {
      await v.context.close();
    }
  });

  it('Back from the destination returns to where the visitor came from, not to the notice', async () => {
    const link = await seedLink({ dest: `${dest}/gone`, expires_at: Date.now() - 60_000, expires_url: `${dest}/after` });
    const v = await visitor();
    try {
      const p = v.page;
      await p.goto(`${dest}/before`);
      await p.goto(`/s/${link.alias}`);
      await expect(p.getByText('This link has expired')).toBeVisible();
      await p.waitForURL((url) => url.pathname === '/after', { timeout: 15_000 });
      await p.goBack();
      await p.waitForURL((url) => url.pathname === '/before');
      await p.waitForTimeout(3_000); // longer than the notice's wait: it must not bounce forward again
      expect(new URL(p.url()).pathname).toBe('/before');
      expect(v.errors).toEqual([]);
    } finally {
      await v.context.close();
    }
  });

  it('"Go there now" skips the wait, and Back is not trapped after it either', async () => {
    const link = await seedLink({ dest: `${dest}/gone`, expires_at: Date.now() - 60_000, expires_url: `${dest}/right-away` });
    const v = await visitor();
    try {
      await v.page.goto(`${dest}/before`);
      await v.page.goto(`/s/${link.alias}`);
      const started = Date.now();
      await v.page.getByRole('link', { name: 'Go there now' }).click();
      await v.page.waitForURL((url) => url.origin === dest && url.pathname === '/right-away');
      expect(Date.now() - started).toBeLessThan(1_500); // well inside the 2 second wait
      await v.page.goBack();
      await v.page.waitForURL((url) => url.pathname === '/before');
      await v.page.waitForTimeout(2_500);
      expect(new URL(v.page.url()).pathname).toBe('/before');
    } finally {
      await v.context.close();
    }
  });

  it('with nowhere to go, the notice stays put', async () => {
    const link = await seedLink({ dest: `${dest}/gone`, expires_at: Date.now() - 60_000 });
    const v = await visitor();
    try {
      await v.page.goto(`/s/${link.alias}`);
      await expect(v.page.getByText('This link has expired')).toBeVisible();
      await v.page.waitForTimeout(4_500); // longer than the wait a redirect would have had
      expect(v.page.url()).toContain(`/s/${link.alias}`);
      await expect(v.page.getByText('This link has expired')).toBeVisible();
    } finally {
      await v.context.close();
    }
  });

  it('an expired link with no fallback of its own goes to the Redirect URL from Settings', async () => {
    const link = await seedLink({ dest: `${dest}/gone`, expires_at: Date.now() - 60_000 });
    expect((await api('PATCH', '/api/settings', { root_redirect: `${dest}/company-home` })).status).toBe(200);
    const v = await visitor();
    try {
      await v.page.goto(`/s/${link.alias}`);
      await expect(v.page.getByText('This link has expired')).toBeVisible();
      await v.page.waitForURL((url) => url.origin === dest, { timeout: 15_000 });
      await expect(v.page.locator('#dest')).toContainText('/company-home');
    } finally {
      await api('PATCH', '/api/settings', { root_redirect: '' });
      await v.context.close();
    }
  });

  it('works right up to the moment it expires, then stops', async () => {
    const link = await seedLink({ dest: `${dest}/limited`, expires_at: Date.now() + 4_000 });
    const v = await visitor();
    try {
      await v.page.goto(`/s/${link.alias}`);
      await v.page.waitForURL((url) => url.origin === dest);
      await expect.poll(async () => (await v.page.goto(`/s/${link.alias}`))?.status() ?? 0, { timeout: 15_000, interval: 500 }).toBe(410);
    } finally {
      await v.context.close();
    }
  });
});

run('Cloaked links', () => {
  it('show the destination inside the short link, over http', async () => {
    const link = await seedLink({ dest: `${dest}/inside`, cloak: true });
    const v = await visitor();
    try {
      await v.page.goto(`/s/${link.alias}`);
      await expect(v.page.frameLocator('iframe').locator('#dest')).toContainText('/inside');
      expect(v.page.url()).toContain(link.alias); // the address bar keeps the short link
    } finally {
      await v.context.close();
    }
  });

  it('on https, an http:// destination still loads (the browser blocks http frames inside https pages)', async () => {
    const target = 'http://cloak-target.example/blog-roll';
    const v = await visitor();
    try {
      await v.context.route('https://short.example/**', (route) => {
        const secure = cloakPage('charles', target, true);
        return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': secure.csp }, body: secure.html });
      });
      await v.context.route('https://cloak-target.example/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<h1 id="inside">INSIDE THE FRAME</h1>' })
      );
      await v.page.goto('https://short.example/charles');
      await expect(v.page.frameLocator('iframe').locator('#inside')).toContainText('INSIDE THE FRAME');
    } finally {
      await v.context.close();
    }
  });

  it('control: the old page (http frame inside an https page) really is blocked, so the test above proves something', async () => {
    const v = await visitor();
    try {
      await v.context.route('https://short.example/**', (route) => {
        const old = cloakPage('charles', 'http://cloak-target.example/blog-roll', false); // keeps the http:// address
        return route.fulfill({ status: 200, contentType: 'text/html', body: old.html });
      });
      await v.context.route('http://cloak-target.example/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<h1 id="inside">INSIDE THE FRAME</h1>' })
      );
      await v.page.goto('https://short.example/charles');
      await v.page.waitForTimeout(1500);
      await expect(v.page.frameLocator('iframe').locator('#inside')).toHaveCount(0);
    } finally {
      await v.context.close();
    }
  });
});

run('Setting an expiration in the editor', () => {
  const dialogOf = (p: import('playwright-core').Page) => p.getByRole('dialog');
  const stored = async (id: string) => (await api('GET', `/api/links/${id}`)).body.link;

  async function openExpiration(p: import('playwright-core').Page, id: string) {
    await p.goto(`/links/edit?id=${id}`);
    await p.getByRole('button', { name: 'Expiration' }).click();
    return dialogOf(p).getByPlaceholder(/tomorrow at 5pm/);
  }

  it('stores "tomorrow at 5pm" as 5 PM in the browser\'s own timezone, and says which one', async () => {
    const link = await seedLink();
    const s = await openSession(browser, { timezoneId: 'Africa/Lagos' });
    try {
      const p = s.page;
      const field = await openExpiration(p, link.id);
      await field.fill('tomorrow at 5pm');
      await field.blur();
      await expect(dialogOf(p).getByText(/Expires on/)).toContainText('5:00 PM');
      await expect(dialogOf(p).getByText(/Expires on/)).toContainText('Africa/Lagos time');
      await dialogOf(p).getByRole('button', { name: 'Add expiration' }).click();
      await p.locator('.save-bar').getByRole('button', { name: /Save/ }).click();

      // Lagos is UTC+1 all year, so 5 PM there is 16:00 UTC on Lagos's "tomorrow".
      const lagosNow = new Date(Date.now() + 3_600_000);
      const expected = Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate() + 1, 16, 0);
      await expect.poll(async () => (await stored(link.id)).expires_at).toBe(expected);

      // Reopening shows the same time back, in the same zone.
      const again = await openExpiration(p, link.id);
      await expect(again).toHaveValue(/5:00 PM/);
      expect(s.errors).toEqual([]);
    } finally {
      await s.context.close();
    }
  });

  it('refuses a time that has already passed, and text it cannot read', async () => {
    const link = await seedLink();
    const s = await openSession(browser, { timezoneId: 'Africa/Lagos' });
    try {
      const p = s.page;
      const field = await openExpiration(p, link.id);
      const add = dialogOf(p).getByRole('button', { name: 'Add expiration' });

      await field.fill('2020-01-01 10:00');
      await expect(dialogOf(p).getByText('That time has already passed')).toBeVisible();
      await expect(add).toBeDisabled();

      await field.fill('banana');
      await field.blur();
      await expect(dialogOf(p).getByText('Could not read that date')).toBeVisible();
      await expect(add).toBeDisabled();

      // A numeric date could be day-first or month-first, so it is not guessed.
      await field.fill('10/11/2030');
      await field.blur();
      await expect(dialogOf(p).getByText('Could not read that date')).toBeVisible();

      // No complaint while still typing; fixing the text clears it.
      await field.fill('friday 9am');
      await expect(dialogOf(p).getByText('Could not read that date')).toHaveCount(0);
      await expect(add).toBeEnabled();
      await expect.poll(async () => (await stored(link.id)).expires_at).toBe(null);
    } finally {
      await s.context.close();
    }
  });

  it('checks the fallback address before saving, and tidies a bare domain', async () => {
    const link = await seedLink();
    const s = await openSession(browser, { timezoneId: 'Africa/Lagos' });
    try {
      const p = s.page;
      const field = await openExpiration(p, link.id);
      await field.fill('in 3 days');
      const url = dialogOf(p).getByPlaceholder('https://example.com');
      await url.fill('javascript:alert(1)');
      await dialogOf(p).getByRole('button', { name: 'Add expiration' }).click();
      await expect(dialogOf(p).getByText('must start with http:// or https://')).toBeVisible();
      expect((await stored(link.id)).expires_at).toBe(null); // nothing was saved

      await url.fill('example.com/offer');
      await dialogOf(p).getByRole('button', { name: 'Add expiration' }).click();
      await p.locator('.save-bar').getByRole('button', { name: /Save/ }).click();
      await expect.poll(async () => (await stored(link.id)).expires_url).toBe('https://example.com/offer');
      expect((await stored(link.id)).expires_at).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    } finally {
      await s.context.close();
    }
  });

  it('lets you change only the fallback address of a link that has already expired', async () => {
    const link = await seedLink({ expires_at: Date.now() - 3_600_000 });
    const s = await openSession(browser, { timezoneId: 'Africa/Lagos' });
    try {
      const p = s.page;
      await openExpiration(p, link.id);
      await expect(dialogOf(p).getByText('That time has already passed')).toHaveCount(0);
      await dialogOf(p).getByPlaceholder('https://example.com').fill('https://example.com/we-moved');
      await dialogOf(p).getByRole('button', { name: 'Save' }).click();
      await p.locator('.save-bar').getByRole('button', { name: /Save/ }).click();
      await expect.poll(async () => (await stored(link.id)).expires_url).toBe('https://example.com/we-moved');
    } finally {
      await s.context.close();
    }
  });
});
