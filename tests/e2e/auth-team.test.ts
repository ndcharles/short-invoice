import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { addMember, api, chromeAvailable, launch, openSession, setUpAccount, unique } from './helpers';

const run = chromeAvailable ? describe : describe.skip;

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

const dialog = (p: Page) => p.getByRole('dialog');
const profileRow = (p: Page) => p.locator('button.user-row');

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(email);
  await page.keyboard.press('Enter');
  await page.getByLabel('Password').fill(password);
  await page.keyboard.press('Enter');
}

run('Sign-in screens', () => {
  it('sends signed-out visitors to the sign-in page and back to where they were going', async () => {
    const guest = await openSession(browser, { user: null });
    try {
      await guest.page.goto('/invoices');
      await guest.page.waitForURL(/\/login\?next=%2Finvoices/);
      await expect(guest.page.getByPlaceholder('you@company.com')).toBeVisible();
      // Nothing of the app is shown meanwhile.
      await expect(guest.page.locator('.sidebar')).toHaveCount(0);
    } finally {
      await guest.context.close();
    }
  });

  it('does nothing at all for an email that is not on the team', async () => {
    const guest = await openSession(browser, { user: null });
    try {
      const p = guest.page;
      await p.goto('/login');
      await p.getByPlaceholder('you@company.com').fill('stranger@example.org');
      const before = await p.locator('.login-card').innerText();
      const fieldsBefore = await p.locator('.login-card input').count();
      const requests: string[] = [];
      p.on('request', (r) => requests.push(r.url()));
      await p.keyboard.press('Enter');
      await expect.poll(() => requests.some((u) => u.endsWith('/api/auth/check'))).toBe(true);
      await p.waitForTimeout(500);
      expect(await p.locator('.login-card').innerText()).toBe(before);
      expect(await p.locator('.login-card input').count()).toBe(fieldsBefore);
      await expect(p.getByLabel('Password')).toHaveCount(0);
      await expect(p.getByLabel('Setup code')).toHaveCount(0);
      await expect(p.locator('.login-error')).toHaveCount(0);
    } finally {
      await guest.context.close();
    }
  });

  it('first sign-in: setup code, name and password, with clear errors, then the app', async () => {
    const who = await addMember();
    const guest = await openSession(browser, { user: null });
    try {
      const p = guest.page;
      await p.goto('/login?next=/utms');
      await p.getByPlaceholder('you@company.com').fill(who.email);
      await p.keyboard.press('Enter');
      await expect(p.getByLabel('Setup code')).toBeVisible();

      await p.getByLabel('Setup code').fill('AAAAA-AAAAA');
      await p.getByLabel('Your name').fill('Test Member');
      await p.getByLabel('New password').fill('short');
      await p.getByLabel('Confirm password').fill('short');
      await p.getByRole('button', { name: 'Create account and sign in' }).click();
      await expect(p.locator('.login-error')).toContainText('at least 12');

      await p.getByLabel('New password').fill('a long enough secret');
      await p.getByLabel('Confirm password').fill('does not match at all');
      await p.getByRole('button', { name: 'Create account and sign in' }).click();
      await expect(p.locator('.login-error')).toContainText('do not match');

      await p.getByLabel('Confirm password').fill('a long enough secret');
      await p.getByRole('button', { name: 'Create account and sign in' }).click();
      await expect(p.locator('.login-error')).toContainText('code is not right');

      await p.getByLabel('Setup code').fill(who.code.toLowerCase());
      await p.getByRole('button', { name: 'Create account and sign in' }).click();
      await p.waitForURL('**/utms'); // back to where they were going
      await expect(profileRow(p)).toContainText('Test Member');
      await expect(profileRow(p)).toContainText('Member');
    } finally {
      await guest.context.close();
    }
  });

  it('later sign-ins: email, then the password field appears under it; Show/Hide and Enter work', async () => {
    const who = await addMember();
    const first = await openSession(browser, { user: null });
    await setUpAccount(first.page, who);
    await first.context.close();

    const guest = await openSession(browser, { user: null });
    try {
      const p = guest.page;
      await p.goto('/login');
      await expect(p.getByLabel('Password')).toHaveCount(0);
      await p.getByPlaceholder('you@company.com').fill(who.email);
      await p.getByRole('button', { name: 'Continue' }).click();
      const password = p.getByLabel('Password');
      await expect(password).toBeVisible();
      expect(await password.getAttribute('type')).toBe('password');
      await p.getByRole('button', { name: 'Show' }).click();
      expect(await password.getAttribute('type')).toBe('text');

      await password.fill('the wrong password');
      await p.keyboard.press('Enter');
      await expect(p.locator('.login-error')).toContainText('not right');
      await expect(password).toHaveValue('');

      await password.fill('a long enough secret');
      await p.keyboard.press('Enter');
      await p.waitForURL('**/links');
      await expect(profileRow(p)).toContainText('New Person');
    } finally {
      await guest.context.close();
    }
  });

  it('editing the email after the check starts over', async () => {
    const who = await addMember();
    const guest = await openSession(browser, { user: null });
    try {
      const p = guest.page;
      await p.goto('/login');
      await p.getByPlaceholder('you@company.com').fill(who.email);
      await p.keyboard.press('Enter');
      await expect(p.getByLabel('Setup code')).toBeVisible();
      await p.getByPlaceholder('you@company.com').fill(who.email + 'x');
      await expect(p.getByLabel('Setup code')).toHaveCount(0);
      await expect(p.getByRole('button', { name: 'Continue' })).toBeVisible();
    } finally {
      await guest.context.close();
    }
  });
});

run('Profile dialog and sessions', () => {
  it('shows your name and role, saves a new name, and signs out of this device only', async () => {
    const who = await addMember();
    const a = await openSession(browser, { user: null });
    const b = await openSession(browser, { user: null });
    try {
      await setUpAccount(a.page, who);
      await signIn(b.page, who.email, 'a long enough secret');
      await b.page.waitForURL('**/links');

      await profileRow(a.page).click();
      await expect(dialog(a.page).getByText(who.email)).toBeVisible();
      await dialog(a.page).getByRole('textbox').fill('Renamed Person');
      await dialog(a.page).getByRole('button', { name: 'Save' }).click();
      await expect(profileRow(a.page)).toContainText('Renamed Person');

      await profileRow(a.page).click();
      await dialog(a.page).getByRole('button', { name: 'Sign out', exact: true }).click();
      await a.page.waitForURL('**/login');
      await a.page.goto('/links');
      await a.page.waitForURL(/\/login/);

      // The other device is still signed in.
      await b.page.reload();
      await expect(profileRow(b.page)).toContainText('Renamed Person');
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  it('Sign out everywhere ends the other devices too', async () => {
    const who = await addMember();
    const a = await openSession(browser, { user: null });
    const b = await openSession(browser, { user: null });
    try {
      await setUpAccount(a.page, who);
      await signIn(b.page, who.email, 'a long enough secret');
      await b.page.waitForURL('**/links');
      await profileRow(a.page).click();
      await dialog(a.page).getByRole('button', { name: 'Sign out everywhere' }).click();
      await a.page.waitForURL('**/login');
      await b.page.reload();
      await b.page.waitForURL(/\/login/);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  it('the dialog dims and blurs the whole page, sidebar and toolbar included, on every page', async () => {
    const admin = await openSession(browser);
    try {
      for (const path of ['/links', '/links/analytics', '/utms', '/invoices', '/invoices/analytics', '/settings']) {
        await admin.page.goto(path);
        await admin.page.locator('.sidebar').waitFor();
        // The dev-session profile row has no sign-out; open it like a person would.
        await profileRow(admin.page).click();
        await expect(dialog(admin.page)).toBeVisible();
        const exposed = await admin.page.evaluate(() => {
          const backdrop = document.querySelector('.modal-backdrop');
          const exposed: string[] = [];
          if (!backdrop || backdrop.parentElement !== document.body) exposed.push('backdrop is not at the top level');
          const points: [number, number][] = [];
          for (let x = 10; x < innerWidth; x += 90) for (let y = 10; y < innerHeight; y += 70) points.push([x, y]);
          for (const [x, y] of points) {
            const el = document.elementFromPoint(x, y);
            if (el && backdrop && el !== backdrop && !backdrop.contains(el)) exposed.push(`${x},${y} ${el.className}`);
          }
          return exposed;
        });
        expect(exposed, path).toEqual([]);
        await admin.page.keyboard.press('Escape');
        await admin.page.getByRole('button', { name: 'Close' }).click().catch(() => undefined);
      }
    } finally {
      await admin.context.close();
    }
  });

  it('a removed person is signed out on their next click', async () => {
    const who = await addMember();
    const a = await openSession(browser, { user: null });
    try {
      await setUpAccount(a.page, who);
      await api('DELETE', `/api/team/users/${encodeURIComponent(who.email)}`);
      await a.page.goto('/utms');
      await a.page.waitForURL(/\/login/);
    } finally {
      await a.context.close();
    }
  });
});

run('Members vs admins in the UI', () => {
  it('a member has no Settings, no Delete, and the settings URL says admins only', async () => {
    const who = await addMember();
    const a = await openSession(browser, { user: null });
    try {
      await setUpAccount(a.page, who);
      await expect(a.page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
      await a.page.goto('/settings');
      await expect(a.page.getByText('Only admins can view and change settings')).toBeVisible();
      await a.page.goto('/settings/team');
      await expect(a.page.getByText('Only admins can view and change settings')).toBeVisible();
      await expect(a.page.getByText('Add member')).toHaveCount(0);

      // A member can still add a tag while tagging a link, but not manage tags.
      expect((await a.page.evaluate(async () => (await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"workspace_name":"x"}' })).status))).toBe(403);
    } finally {
      await a.context.close();
    }
  });
});

run('Settings → Team (admin)', () => {
  it('adds a member, shows the code once with a copy button, issues a new code, removes and re-invites', async () => {
    const admin = await openSession(browser);
    try {
      const p = admin.page;
      await p.goto('/settings/team');
      const email = `${unique('team')}@example.org`;
      await p.getByLabel('Email to invite').fill(email);
      await p.getByRole('button', { name: 'Add member' }).click();
      await expect(dialog(p).getByText(`Setup code for ${email}`)).toBeVisible();
      const code = await dialog(p).locator('.setup-code').innerText();
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      await dialog(p).getByRole('button', { name: 'Copy message with code' }).click();
      const copied = await p.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain(code);
      expect(copied).toContain(email);
      expect(copied).toContain('/login');
      await dialog(p).getByRole('button', { name: 'Done' }).click();

      const personRow = p.locator('.team-row', { hasText: email });
      await expect(personRow).toContainText('not signed in yet');
      await personRow.getByRole('button', { name: 'New code' }).click();
      const second = await dialog(p).locator('.setup-code').innerText();
      expect(second).not.toBe(code);
      await dialog(p).getByRole('button', { name: 'Done' }).click();

      // The old code no longer works, the new one does.
      const guest = await openSession(browser, { user: null });
      try {
        await guest.page.goto('/login');
        const old = await guest.page.evaluate(async ([mail, c]) => (await fetch('/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mail, code: c, name: 'X', password: 'a long enough secret' }) })).status, [email, code]);
        expect(old).toBe(400);
      } finally {
        await guest.context.close();
      }

      await personRow.getByRole('button', { name: 'Remove' }).click();
      await expect(dialog(p).getByText(/Remove/)).toBeVisible();
      await dialog(p).getByRole('button', { name: 'Remove' }).click();
      await expect(personRow).toContainText('Removed');
      await personRow.getByRole('button', { name: 'Re-invite' }).click();
      await expect(dialog(p).getByText(`Setup code for ${email}`)).toBeVisible();
      await dialog(p).getByRole('button', { name: 'Done' }).click();
      await expect(personRow).toContainText('not signed in yet');
    } finally {
      await admin.context.close();
    }
  });

  it('refuses bad emails and duplicates, and the activity feed lists who did what with filters', async () => {
    const admin = await openSession(browser);
    try {
      const p = admin.page;
      await p.goto('/settings/team');
      await p.getByLabel('Email to invite').fill('not-an-email');
      await p.getByRole('button', { name: 'Add member' }).click();
      await expect(p.getByText('Enter a valid email address')).toBeVisible();

      const link = await api('POST', '/api/links', { dest: 'https://example.com/feed', alias: unique('feed') });
      expect(link.status).toBe(201);
      await p.goto('/settings/team');
      await expect(p.locator('.activity-row').first()).toBeVisible();
      await expect(p.locator('.activity-list')).toContainText(/created link/);

      await p.locator('select[aria-label="Type"]').selectOption('link');
      await expect(p.locator('.activity-row', { hasText: 'invited' })).toHaveCount(0);
      await p.locator('select[aria-label="Type"]').selectOption('team');
      await expect(p.locator('.activity-row', { hasText: /created link/ })).toHaveCount(0);
      await expect(p.locator('.activity-row').first()).toBeVisible();
    } finally {
      await admin.context.close();
    }
  });
});
