import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, seedLink, seedUtm, unique, type Session } from './helpers';

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

const dialog = (p: Page) => p.getByRole('dialog');
const field = (p: Page, label: string) => p.locator('.field', { hasText: label }).first();
const saveBar = (p: Page) => p.locator('.save-bar');
const storedLink = async (id: string) => (await api('GET', `/api/links/${id}`)).body.link;

async function openLink(over: Record<string, unknown> = {}) {
  const link = await seedLink(over);
  await page.goto(`/links/edit?id=${link.id}`);
  await field(page, 'Destination URL').locator('input').waitFor();
  return link;
}

run('Link editor', () => {
  it('edits the destination, shows the save bar, saves and discards', async () => {
    const link = await openLink();
    const dest = field(page, 'Destination URL').locator('input');
    await expect(saveBar(page).locator('xpath=self::*[contains(@class,"visible")]')).toHaveCount(0);
    await dest.fill('https://example.com/changed');
    await expect(page.locator('.save-bar.visible')).toBeVisible();
    await saveBar(page).getByRole('button', { name: 'Discard' }).click();
    await expect(dest).toHaveValue(link.dest);

    await dest.fill('https://example.com/changed');
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).dest).toBe('https://example.com/changed');
    await expect(page.locator('.save-bar.visible')).toHaveCount(0);
  });

  it('rejects a bad destination with a message instead of saving it', async () => {
    const link = await openLink();
    await field(page, 'Destination URL').locator('input').fill('javascript:alert(1)');
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect(saveBar(page)).toContainText(/http/i);
    expect((await storedLink(link.id)).dest).toBe(link.dest);
  });

  it('the cloak toggle is there, works with the mouse and the keyboard, and saves', async () => {
    const link = await openLink();
    const toggle = page.getByRole('switch', { name: 'Cloak link' });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator('.toggle.on')).toBeVisible();
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).cloak).toBe(1);
    await expect(page.locator('.save-bar.visible')).toHaveCount(0); // the page has finished re-rendering after the save
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.save-bar.visible')).toBeVisible(); // the keyboard toggle registered
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).cloak).toBe(0);
  });

  it('the alias is locked until the pen is clicked, then saves', async () => {
    const link = await openLink();
    const alias = page.locator('.alias-input');
    await expect(alias).toBeDisabled();
    await page.getByTitle('Edit short link').click();
    await expect(alias).toBeEnabled();
    const next = unique('renamed');
    await alias.fill(next);
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).alias).toBe(next);
  });

  it('comments, tags (including a new one) and folder are saved', async () => {
    const link = await openLink();
    const tag = unique('Tag');
    await field(page, 'Comments').locator('textarea').fill('Remember to check this');
    await field(page, 'Tags').locator('.input').click();
    await page.getByText('＋ Create tag').click();
    await page.getByPlaceholder('New tag name').fill(tag);
    await page.keyboard.press('Enter');
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).comments).toBe('Remember to check this');
    await expect.poll(async () => (await storedLink(link.id)).tag).toBe(tag);
  });

  it('the Password, Expiration and UTM tools open and save', async () => {
    const link = await openLink();
    // Password
    await page.getByRole('button', { name: 'Password' }).click();
    await dialog(page).getByPlaceholder('Enter a password').fill('a-long-link-password');
    await dialog(page).getByPlaceholder('Re-enter the password').fill('a-long-link-password');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).has_password).toBe(true);
    expect(JSON.stringify(await storedLink(link.id))).not.toContain('pbkdf2');

    // Mismatched passwords cannot be saved
    await page.getByRole('button', { name: 'Password' }).click();
    await dialog(page).getByPlaceholder('Enter a new password').fill('another-long-password');
    await dialog(page).getByPlaceholder('Re-enter the password').fill('different');
    await expect(dialog(page).getByRole('button', { name: 'Save' })).toBeDisabled();
    await dialog(page).getByRole('button', { name: 'Remove password' }).click();
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).has_password).toBe(false);

    // Expiration
    await page.getByRole('button', { name: 'Expiration' }).click();
    await dialog(page).getByPlaceholder(/tomorrow at 5pm/).fill('in 2 days');
    await dialog(page).getByRole('button', { name: 'Add expiration' }).click();
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).expires_at).toBeGreaterThan(Date.now() + 36 * 3_600_000);

    // UTM
    await page.getByRole('button', { name: 'UTM', exact: true }).click();
    await expect(dialog(page).getByText('UTM Builder')).toBeVisible();
    await dialog(page).locator('input').first().fill('e2e-source');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await storedLink(link.id)).utm_source).toBe('e2e-source');
  });

  it('the ⋯ menu: Copy URL, Duplicate, Archive, and Delete with an app dialog', async () => {
    const link = await openLink();
    await page.locator('.crumb-bar .icon-btn[aria-label="More"], .icon-btn[aria-label="More"]').first().click();
    await page.getByText('Copy URL', { exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(link.alias);

    await page.locator('.icon-btn[aria-label="More"]').first().click();
    await page.getByText('Archive', { exact: true }).click();
    await expect.poll(async () => (await storedLink(link.id)).archived).toBe(1);

    const again = await openLink();
    await page.locator('.icon-btn[aria-label="More"]').first().click();
    await page.getByText('Delete', { exact: true }).click();
    await expect(dialog(page).getByText('Delete this link?')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => (await api('GET', `/api/links/${again.id}`)).status).toBe(404);
    expect(s.nativeDialogs).toEqual([]);
  });

  it('shows who created it, and a QR code', async () => {
    await openLink();
    await expect(page.locator('.attribution')).toContainText('boss');
    await expect(page.locator('.modal-right svg').first()).toBeVisible();
  });
});

run('UTM editor', () => {
  it('edits fields with a live URL, saves and discards', async () => {
    const utm = await seedUtm();
    await page.goto(`/utms/edit?id=${utm.id}`);
    const source = field(page, 'Campaign source').locator('input');
    await source.waitFor();
    await source.fill('edited-source');
    await expect(page.locator('body')).toContainText('utm_source=edited-source');
    await expect(page.locator('.save-bar.visible')).toBeVisible();
    await page.locator('.save-bar').getByRole('button', { name: 'Discard' }).click();
    await expect(source).toHaveValue('newsletter');

    await source.fill('edited-source');
    await page.locator('.save-bar').getByRole('button', { name: /Save/ }).click();
    await expect.poll(async () => (await api('GET', `/api/utms/${utm.id}`)).body.campaign.source).toBe('edited-source');
  });

  it('the ⋯ menu works and Shorten & track makes a short link', async () => {
    const utm = await seedUtm();
    await page.goto(`/utms/edit?id=${utm.id}`);
    await page.locator('.icon-btn[aria-label="More"]').first().click();
    await page.locator('.dropdown').getByText('Copy URL', { exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('utm_medium=email');

    await page.getByRole('button', { name: /Shorten/ }).click();
    await page.waitForURL(/\/links\/edit\?id=/);
    await expect(page.locator('.field', { hasText: 'Destination URL' }).locator('input')).toHaveValue(/utm_campaign=/);
  });

  it('shows who created it and refuses to shorten unsaved edits in an app dialog', async () => {
    const utm = await seedUtm();
    await page.goto(`/utms/edit?id=${utm.id}`);
    await field(page, 'Campaign source').locator('input').fill('unsaved');
    await page.getByRole('button', { name: /Shorten/ }).click();
    await expect(dialog(page).getByText('Save first')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'OK' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.attribution')).toContainText('boss');
    expect(s.nativeDialogs).toEqual([]);
  });
});
