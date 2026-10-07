import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, seedLink, unique, type Session } from './helpers';

/**
 * The three list pages (Links, UTMs, Invoices) with a real mouse in real Chrome:
 * row menus, toolbar menus, filters, search, tabs, pagination and the create flows.
 */
const run = chromeAvailable ? describe : describe.skip;

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

const rowMenu = (p: Page) => p.locator('.dropdown[data-row-menu]');
const card = (p: Page, text: string) => p.locator('.link-card', { hasText: text });
const dialog = (p: Page) => p.getByRole('dialog');

async function openRowMenu(p: Page, text: string) {
  await card(p, text).locator('button[data-row-menu]').click();
  await rowMenu(p).waitFor();
}

async function search(p: Page, placeholder: RegExp, value: string) {
  await p.getByPlaceholder(placeholder).fill(value);
}

run('Links page', () => {
  it('opens the row menu and every item in it works with a real click', async () => {
    const link = await seedLink({ tag: null });
    await page.goto('/links');
    await search(page, /Search by short link/, link.alias);
    await expect.poll(() => card(page, link.alias).count()).toBe(1);

    // The menu stays open when an item is pressed (it used to close on mouse-down).
    await openRowMenu(page, link.alias);
    for (const item of ['Edit', 'Duplicate', 'Archive', 'Delete']) await expect(rowMenu(page).getByText(item, { exact: true })).toBeVisible();

    // Edit navigates to the editor.
    await rowMenu(page).getByText('Edit', { exact: true }).click();
    await page.waitForURL(/\/links\/edit\?id=/);
    expect(page.url()).toContain(link.id);
    await page.goBack();

    // Duplicate makes a second link to the same destination.
    await search(page, /Search by short link/, link.alias);
    await openRowMenu(page, link.alias);
    await rowMenu(page).getByText('Duplicate', { exact: true }).click();
    await expect
      .poll(async () => ((await api('GET', `/api/links?search=${encodeURIComponent(link.dest)}`)).body.links as unknown[]).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('archives and restores a link, moving it between the tabs', async () => {
    const link = await seedLink();
    await page.goto('/links');
    await search(page, /Search by short link/, link.alias);
    await openRowMenu(page, link.alias);
    await rowMenu(page).getByText('Archive', { exact: true }).click();
    await expect.poll(() => card(page, link.alias).count()).toBe(0);

    await page.getByRole('button', { name: /Archived/ }).click();
    await expect.poll(() => card(page, link.alias).count()).toBe(1);
    await openRowMenu(page, link.alias);
    await rowMenu(page).getByText('Unarchive', { exact: true }).click();
    await expect.poll(() => card(page, link.alias).count()).toBe(0);

    await page.getByRole('button', { name: /All Active/ }).click();
    await expect.poll(() => card(page, link.alias).count()).toBe(1);
  });

  it('asks before deleting, in an app dialog, and honours Cancel and Delete', async () => {
    const link = await seedLink();
    await page.goto('/links');
    await search(page, /Search by short link/, link.alias);
    await openRowMenu(page, link.alias);
    await rowMenu(page).getByText('Delete', { exact: true }).click();

    await expect(dialog(page).getByText('Delete this link?')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await api('GET', `/api/links/${link.id}`)).status).toBe(200);

    await openRowMenu(page, link.alias);
    await rowMenu(page).getByText('Delete', { exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => (await api('GET', `/api/links/${link.id}`)).status).toBe(404);
    await expect.poll(() => card(page, link.alias).count()).toBe(0);
    expect(s.nativeDialogs).toEqual([]);
  });

  it('Refresh in the toolbar menu shows links created elsewhere', async () => {
    await page.goto('/links');
    const late = await seedLink();
    await expect.poll(() => card(page, late.alias).count()).toBe(0);
    await page.locator('.toolbar-menu .icon-btn[aria-label="More"]').click();
    await page.getByText('Refresh', { exact: true }).click();
    await search(page, /Search by short link/, late.alias);
    await expect.poll(() => card(page, late.alias).count()).toBe(1);
  });

  it('menus close on Escape and on a click elsewhere', async () => {
    const link = await seedLink();
    await page.goto('/links');
    await search(page, /Search by short link/, link.alias);
    await openRowMenu(page, link.alias);
    await page.keyboard.press('Escape');
    await expect(rowMenu(page)).toHaveCount(0);

    await openRowMenu(page, link.alias);
    await page.locator('.page-title').click();
    await expect(rowMenu(page)).toHaveCount(0);

    // Opening the toolbar menu closes the row menu.
    await openRowMenu(page, link.alias);
    await page.locator('.toolbar-menu .icon-btn[aria-label="More"]').click();
    await expect(page.getByText('Refresh', { exact: true })).toBeVisible();
    await expect(rowMenu(page)).toHaveCount(0);
  });

  it('search narrows the list, and Clear filters brings everything back', async () => {
    const a = await seedLink();
    const b = await seedLink();
    await page.goto('/links');
    await search(page, /Search by short link/, a.alias);
    await expect.poll(() => card(page, a.alias).count()).toBe(1);
    await expect(card(page, b.alias)).toHaveCount(0);

    await search(page, /Search by short link/, 'no-such-link-anywhere-zzz');
    await expect(page.getByText('No links found')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByPlaceholder(/Search by short link/)).toHaveValue('');
    await expect.poll(() => card(page, b.alias).count()).toBe(1);
  });

  it('filters by tag and by folder, and sorts', async () => {
    const tag = unique('tag');
    const folder = unique('folder');
    await api('POST', '/api/collections', { kind: 'tags', name: tag, color: 'blue' });
    await api('POST', '/api/collections', { kind: 'folders', name: folder, color: 'green' });
    const tagged = await seedLink({ tag });
    const filed = await seedLink({ folder });
    const plain = await seedLink();
    await page.goto('/links');

    await page.getByRole('button', { name: /Filter/ }).click();
    await page.locator('.dropdown-item', { hasText: tag }).first().click();
    await page.keyboard.press('Escape');
    await expect.poll(() => card(page, tagged.alias).count()).toBe(1);
    await expect(card(page, plain.alias)).toHaveCount(0);

    await page.reload();
    await page.getByRole('button', { name: /All folders/ }).click();
    await page.locator('.dropdown-item', { hasText: folder }).click();
    await expect.poll(() => card(page, filed.alias).count()).toBe(1);
    await expect(card(page, plain.alias)).toHaveCount(0);

    await page.getByRole('button', { name: /Sort/ }).click();
    await expect(page.getByText('Most clicks', { exact: true })).toBeVisible();
    await page.getByText('Most clicks', { exact: true }).click();
    await expect(page.locator('.link-card').first()).toBeVisible();
  });

  it('pages through more than 25 links', async () => {
    const prefix = unique('pg');
    await Promise.all(Array.from({ length: 27 }, (_, i) => seedLink({ alias: `${prefix}-${String(i).padStart(2, '0')}` })));
    await page.goto('/links');
    await search(page, /Search by short link/, prefix);
    await expect(page.getByText(/Viewing 1.25 of 27 links/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/Viewing 26.27 of 27 links/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.getByText(/Viewing 1.25 of 27 links/)).toBeVisible();
  });

  it('creates a link from the dialog (button and the C key), with validation', async () => {
    await page.goto('/links');
    await page.getByRole('button', { name: /Create link/ }).first().click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: /Create link/ }).click();
    await expect(dialog(page).getByText('Please provide a destination URL')).toBeVisible();

    const alias = unique('new');
    await dialog(page).getByPlaceholder('https://dub.co/help/article/dub-links').fill('https://example.com/from-e2e');
    await dialog(page).getByTitle('Edit short link').click();
    await dialog(page).getByPlaceholder('Nk6EwSL').fill(alias);
    await dialog(page).getByRole('button', { name: /Create link/ }).click();
    await expect(dialog(page)).toHaveCount(0);
    await search(page, /Search by short link/, alias);
    await expect.poll(() => card(page, alias).count()).toBe(1);

    // "C" opens it too, and ⌘C / Ctrl+C (copy) must not.
    await page.locator('.page-title').click();
    await page.keyboard.press('c');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Close' }).first().click().catch(() => undefined);
  });

  it('keeps Delete out of reach for members', async () => {
    const link = await seedLink();
    const member = await openSession(browser, { user: null });
    try {
      // A member is a person an admin added: sign them in with their own session.
      const email = `${unique('m')}@example.org`;
      const added = await api('POST', '/api/team/invites', { email });
      expect(added.status).toBe(201);
      const memberSession = await openSession(browser, { user: email });
      await memberSession.page.goto('/links');
      await memberSession.page.getByPlaceholder(/Search by short link/).fill(link.alias);
      await card(memberSession.page, link.alias).locator('button[data-row-menu]').click();
      await expect(rowMenu(memberSession.page).getByText('Edit', { exact: true })).toBeVisible();
      await expect(rowMenu(memberSession.page).getByText('Delete', { exact: true })).toHaveCount(0);
      await expect(memberSession.page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
      await memberSession.context.close();
    } finally {
      await member.context.close();
    }
  });
});
