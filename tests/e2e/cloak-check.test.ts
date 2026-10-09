import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Browser, Locator, Page } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, seedLink, unique, type Session } from './helpers';

/**
 * "This link cannot be cloaked": what the person sees in the link editor and the new-link form. The Worker in
 * these tests cannot look at the real internet, so the sites used are the ones known without being asked
 * (Zoom, Claude); other answers are made up with page.route.
 */
const run = chromeAvailable ? describe : describe.skip;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sqlite = (sql: string) =>
  execFileSync(path.join(ROOT, 'node_modules/.bin/wrangler'), ['d1', 'execute', 'short-invoice', '--local', '--persist-to', inject('persistDir'), '--json', '--command', sql], {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
  });
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

const ZOOM = 'https://us02web.zoom.us/j/81234567890?pwd=abcDEF123';
const CLAUDE = 'https://claude.ai/artifact/AbCdEfGhIjKlMnOpQrStUv';
const NOT_CLOAKABLE = 'This link cannot be cloaked';

let browser: Browser;
let s: Session;
let page: Page;
beforeAll(async () => {
  browser = await launch();
  s = await openSession(browser);
  page = s.page;
});
afterAll(async () => {
  await browser?.close();
});

const dialog = (p: Page) => p.getByRole('dialog');
const field = (p: Page, label: string) => p.locator('.field', { hasText: label }).first();
const saveBar = (p: Page) => p.locator('.save-bar');
/** The whole page, or just a dialog on it. */
type Scope = Page | Locator;
const note = (p: Scope) => p.locator('.cloak-note');
const blocked = (p: Scope) => p.locator('.cloak-note.is-blocked');
const cloakSwitch = (p: Scope) => p.getByRole('switch', { name: 'Cloak link' });
const storedLink = async (id: string) => (await api('GET', `/api/links/${id}`)).body.link;

/** A link that is cloaked to a site that cannot be cloaked, as an earlier version of the app allowed. */
async function brokenCloaked(dest = ZOOM) {
  const link = await seedLink();
  sqlite(`UPDATE links SET dest = ${quote(dest)}, cloak = 1 WHERE id = ${quote(link.id)}`);
  return link;
}
async function openEditor(link: { id: string }) {
  await page.goto(`/links/edit?id=${link.id}`);
  await field(page, 'Destination URL').locator('input').waitFor();
}

run('Cloaking in the link editor', () => {
  it('turning cloaking on for a site that cannot be cloaked is refused, and says why', async () => {
    const link = await seedLink({ dest: ZOOM });
    await openEditor(link);
    await expect(note(page)).toHaveCount(0);

    await cloakSwitch(page).click();
    await expect(blocked(page)).toBeVisible();
    await expect(blocked(page)).toContainText(NOT_CLOAKABLE);
    await expect(blocked(page)).toContainText('Zoom');
    await expect(cloakSwitch(page)).toHaveAttribute('aria-checked', 'false'); // the switch went back
    await expect(page.locator('.save-bar.visible')).toHaveCount(0); // so there is nothing to save
    expect((await storedLink(link.id)).cloak).toBe(0);

    // Asking again does not turn it on either, and a different address clears the message.
    await cloakSwitch(page).click();
    await expect(blocked(page)).toContainText(NOT_CLOAKABLE);
    await expect(cloakSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await field(page, 'Destination URL').locator('input').fill('https://example.com/other');
    await expect(blocked(page)).toHaveCount(0);
    expect(s.errors).toEqual([]);
  });

  it('works from the keyboard too, and names the site when it is a Claude artifact', async () => {
    const link = await seedLink({ dest: CLAUDE });
    await openEditor(link);
    await cloakSwitch(page).focus();
    await page.keyboard.press('Enter');
    await expect(blocked(page)).toContainText(NOT_CLOAKABLE);
    await expect(blocked(page)).toContainText("claude.ai doesn't allow other sites to show its pages");
    await expect(cloakSwitch(page)).toHaveAttribute('aria-checked', 'false');
  });

  it('a site it could not look at is cloaked as before, with a quiet note', async () => {
    const link = await seedLink({ dest: 'https://example.com/fine-to-cloak' });
    await openEditor(link);
    await cloakSwitch(page).click();
    await expect(note(page)).toContainText("couldn't check this site");
    await expect(cloakSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect(blocked(page)).toHaveCount(0);
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).cloak).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it('a site the server says is fine is cloaked with no note at all', async () => {
    const link = await seedLink({ dest: 'https://example.com/fine' });
    const route = '**/api/links/cloak-check*';
    await page.route(route, (r) => r.fulfill({ json: { cloak: { status: 'ok' } } }));
    try {
      await openEditor(link);
      await cloakSwitch(page).click();
      await expect(cloakSwitch(page)).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('.save-bar.visible')).toBeVisible();
      await page.waitForTimeout(400);
      await expect(note(page)).toHaveCount(0);
    } finally {
      await page.unroute(route);
    }
  });

  it('shows what the server found out, and that it is checking while it waits', async () => {
    const link = await seedLink({ dest: 'https://example.com/anything' });
    const route = '**/api/links/cloak-check*';
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(route, async (r) => {
      await held;
      await r.fulfill({
        json: { cloak: { status: 'blocked', reason: 'frame-ancestors', host: 'example.com', message: "example.com doesn't allow other sites to show its pages, so visitors would see a blank page." } },
      });
    });
    try {
      await openEditor(link);
      await cloakSwitch(page).click();
      await expect(note(page)).toContainText('Checking that this site can be cloaked');
      await expect(cloakSwitch(page)).toHaveAttribute('aria-checked', 'true'); // on while it checks
      release();
      await expect(blocked(page)).toContainText(NOT_CLOAKABLE);
      await expect(blocked(page)).toContainText("example.com doesn't allow other sites");
      await expect(cloakSwitch(page)).toHaveAttribute('aria-checked', 'false');
    } finally {
      release();
      await page.unroute(route);
    }
  });

  it('asks once for each address, not on every flick of the switch', async () => {
    const link = await seedLink({ dest: ZOOM });
    const asked: string[] = [];
    const watch = (request: { url(): string }) => {
      if (request.url().includes('/api/links/cloak-check')) asked.push(request.url());
    };
    page.on('request', watch);
    try {
      await openEditor(link);
      for (let i = 0; i < 3; i += 1) {
        await cloakSwitch(page).click();
        await expect(blocked(page)).toContainText(NOT_CLOAKABLE);
      }
      expect(asked).toHaveLength(1);
    } finally {
      page.off('request', watch);
    }
  });

  it('does not look at anything while cloaking is off', async () => {
    const link = await seedLink({ dest: ZOOM });
    const asked: string[] = [];
    const watch = (request: { url(): string }) => {
      if (request.url().includes('/api/links/cloak-check')) asked.push(request.url());
    };
    page.on('request', watch);
    try {
      await openEditor(link);
      await page.waitForTimeout(1200); // longer than the pause before an automatic check
      expect(asked).toEqual([]);
      await expect(note(page)).toHaveCount(0);
    } finally {
      page.off('request', watch);
    }
  });

  it('a link that is already cloaked to a site that cannot be cloaked is flagged as soon as it opens', async () => {
    const link = await brokenCloaked();
    await openEditor(link);
    await expect(blocked(page)).toBeVisible();
    await expect(blocked(page)).toContainText(NOT_CLOAKABLE);
    await expect(blocked(page)).toContainText('Turn off Cloak link to fix this');
    await expect(cloakSwitch(page)).toHaveAttribute('aria-checked', 'true'); // shown as it is stored; nothing changes by itself
    await expect(page.locator('.save-bar.visible')).toHaveCount(0);

    // Other changes still save while it is on, so the owner is never stuck.
    await field(page, 'Comments').locator('textarea').fill('edited while still cloaked');
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).comments).toBe('edited while still cloaked');
    expect((await storedLink(link.id)).cloak).toBe(1);

    // Turning it off clears the warning, and saves.
    await cloakSwitch(page).click();
    await expect(blocked(page)).toHaveCount(0);
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).cloak).toBe(0);
  });

  it('pointing a cloaked link at a site that cannot be cloaked is flagged, and saving it is refused', async () => {
    const link = await seedLink({ dest: 'https://example.com/fine-to-cloak' });
    expect((await api('PATCH', `/api/links/${link.id}`, { cloak: true })).status).toBe(200);
    await openEditor(link);
    await field(page, 'Destination URL').locator('input').fill(ZOOM);
    await expect(blocked(page)).toContainText(NOT_CLOAKABLE); // after a short pause, without touching the switch
    await expect(cloakSwitch(page)).toHaveAttribute('aria-checked', 'true');

    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect(saveBar(page)).toContainText(NOT_CLOAKABLE);
    expect(await storedLink(link.id)).toMatchObject({ dest: 'https://example.com/fine-to-cloak', cloak: 1 });

    // Turning cloaking off lets the new destination save.
    await cloakSwitch(page).click();
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).dest).toBe(ZOOM);
    expect((await storedLink(link.id)).cloak).toBe(0);
  });
});

run('Cloaking in the new-link form', () => {
  const create = () => page.getByRole('button', { name: /Create link/ }).first();
  const destination = () => dialog(page).getByPlaceholder('https://4th-entity.com/about-us');

  it('turning cloaking on for a site that cannot be cloaked is refused, and says why', async () => {
    await page.goto('/links');
    await create().click();
    await destination().fill(ZOOM);
    await cloakSwitch(dialog(page)).click();
    await expect(blocked(dialog(page))).toContainText(NOT_CLOAKABLE);
    await expect(blocked(dialog(page))).toContainText('Zoom');
    await expect(cloakSwitch(dialog(page))).toHaveAttribute('aria-checked', 'false');

    // Another address clears it, and then the switch turns on.
    await destination().fill('https://example.com/fine');
    await expect(blocked(dialog(page))).toHaveCount(0);
    await cloakSwitch(dialog(page)).click();
    await expect(cloakSwitch(dialog(page))).toHaveAttribute('aria-checked', 'true');
  });

  it('turning cloaking on before an address is typed says nothing, then flags the address once it is typed', async () => {
    await page.goto('/links');
    await create().click();
    await cloakSwitch(dialog(page)).click();
    await expect(cloakSwitch(dialog(page))).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(800); // longer than the pause before an automatic check
    await expect(note(dialog(page))).toHaveCount(0);

    await destination().fill(ZOOM);
    await expect(blocked(dialog(page))).toContainText(NOT_CLOAKABLE); // the switch is already on, so the address is checked as it is typed
    await expect(cloakSwitch(dialog(page))).toHaveAttribute('aria-checked', 'true');
  });

  it('with cloaking on by default, a site that cannot be cloaked is flagged as soon as it is typed, and creating it is refused', async () => {
    const before = (await api('GET', '/api/settings')).body.settings.default_cloak;
    expect((await api('PATCH', '/api/settings', { default_cloak: 'true' })).status).toBe(200);
    const alias = unique('cc');
    try {
      await page.goto('/links');
      await create().click();
      await expect(cloakSwitch(dialog(page))).toHaveAttribute('aria-checked', 'true');
      await destination().fill(CLAUDE);
      await expect(blocked(dialog(page))).toContainText(NOT_CLOAKABLE); // no click on the switch needed
      await expect(blocked(dialog(page))).toContainText('Turn off Cloak link to fix this');
      await dialog(page).getByTitle('Edit short link').click();
      await dialog(page).getByPlaceholder('Nk6EwSL').fill(alias);

      const refused = page.waitForResponse((r) => r.url().endsWith('/api/links') && r.request().method() === 'POST');
      await dialog(page).getByRole('button', { name: /Create link/ }).click();
      const response = await refused;
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ error: NOT_CLOAKABLE, code: 'not_cloakable' });
      await expect(dialog(page)).toBeVisible(); // still open, with the form's own error banner
      expect((await api('GET', `/api/links?search=${alias}`)).body.links).toHaveLength(0);

      // Without cloaking it is created as an ordinary redirect.
      await cloakSwitch(dialog(page)).click();
      await expect(blocked(dialog(page))).toHaveCount(0);
      await dialog(page).getByRole('button', { name: /Create link/ }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect.poll(async () => (await api('GET', `/api/links?search=${alias}`)).body.links[0]?.cloak).toBe(0);
    } finally {
      await api('PATCH', '/api/settings', { default_cloak: before });
    }
  });
});

run('Duplicating a link on the links page', () => {
  it('says why when the copy would be cloaked to a site that cannot be cloaked', async () => {
    const link = await brokenCloaked();
    // (Searched by a short part of the address: the database refuses patterns over 50 bytes.)
    const copies = async () => {
      const res = await api('GET', `/api/links?search=${encodeURIComponent('us02web.zoom.us/j/81234567890')}`);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      return (res.body.links as unknown[]).length;
    };
    const before = await copies();
    await page.goto('/links');
    await page.getByPlaceholder(/Search by short link/).fill(link.alias);
    const card = page.locator('.link-card', { hasText: link.alias });
    await expect.poll(() => card.count()).toBe(1);
    await card.locator('button[data-row-menu]').click();
    await page.locator('.dropdown[data-row-menu]').getByText('Duplicate', { exact: true }).click();
    await expect(page.locator('.toast')).toContainText(NOT_CLOAKABLE);
    expect(await copies()).toBe(before); // nothing was copied
  });
});
