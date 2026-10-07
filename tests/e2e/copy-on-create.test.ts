import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { api, baseUrl, chromeAvailable, launch, openSession, seedLink, seedUtm, unique, type Session } from './helpers';
import { buildCampaignUrl, formatOptionsFromSettings, type UtmFields } from '@/lib/utm-builder';

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
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
const setClipboard = (text: string) => page.evaluate((t) => navigator.clipboard.writeText(t), text);

run('Copy to the clipboard when something is created', () => {
  it('copies the new short link when a link is created, and says so', async () => {
    await page.goto('/links');
    await setClipboard('something else');
    await page.getByRole('button', { name: /Create link/ }).first().click();
    await dialog(page).getByPlaceholder('https://4th-entity.com/about-us').fill(`https://example.com/${unique('copy')}`);
    const alias = unique('cp');
    await dialog(page).getByTitle('Edit short link').click();
    await dialog(page).getByPlaceholder('Nk6EwSL').fill(alias);
    await dialog(page).getByRole('button', { name: /Create link/ }).click();
    await expect(dialog(page)).toHaveCount(0);

    await expect(page.locator('.toast')).toContainText('Short link copied');
    await expect(page.locator('.toast')).toContainText(alias);
    expect(await clipboard()).toBe(`${baseUrl()}/s/${alias}`);
    expect(s.errors).toEqual([]);
  });

  it('copies nothing, and keeps what you had copied, when the link could not be created', async () => {
    const taken = await seedLink();
    await page.goto('/links');
    await setClipboard('keep me');
    await page.getByRole('button', { name: /Create link/ }).first().click();
    await dialog(page).getByPlaceholder('https://4th-entity.com/about-us').fill('https://example.com/will-not-save');
    await dialog(page).getByTitle('Edit short link').click();
    await dialog(page).getByPlaceholder('Nk6EwSL').fill(taken.alias);
    await dialog(page).getByRole('button', { name: /Create link/ }).click();
    await expect(dialog(page).getByText(/already in use/)).toBeVisible();
    await page.waitForTimeout(500);
    expect(await clipboard()).toBe('keep me');
    await expect(page.locator('.toast')).toHaveCount(0);
  });

  it('copies the finished campaign URL when a UTM campaign is created', async () => {
    await page.goto('/utms');
    await setClipboard('something else');
    await page.getByRole('button', { name: /Create campaign/ }).first().click();
    await dialog(page).getByPlaceholder('https://www.example.com').fill('https://shop.example.com/sale');
    const name = unique('copy-campaign');
    await dialog(page).locator('.field', { hasText: 'Campaign name' }).locator('input').first().fill(name);
    await dialog(page).getByRole('button', { name: /Create campaign/ }).click();
    await expect(dialog(page)).toHaveCount(0);

    await expect(page.locator('.toast')).toContainText('Campaign URL copied');
    // What was copied is exactly the address the campaign builds, in the workspace's own format.
    const list = (await api('GET', '/api/utms?q=' + encodeURIComponent(name))).body.campaigns as (UtmFields & { campaign: string })[];
    const made = list.find((c) => c.campaign === name)!;
    const format = formatOptionsFromSettings((await api('GET', '/api/settings')).body.settings);
    const expected = buildCampaignUrl(made, format);
    expect(expected).toContain(`utm_campaign=${name}`);
    expect(await clipboard()).toBe(expected);
  });

  it('copies the short link made from a campaign ("Shorten & track")', async () => {
    const utm = await seedUtm();
    await page.goto(`/utms/edit?id=${utm.id}`);
    await setClipboard('something else');
    await page.getByRole('button', { name: /Shorten & track/ }).click();
    await page.waitForURL(/\/links\/edit\?id=/);
    await expect(page.locator('.toast')).toContainText('Short link copied');
    const id = new URL(page.url()).searchParams.get('id')!;
    const link = (await api('GET', `/api/links/${id}`)).body.link;
    expect(await clipboard()).toBe(`${baseUrl()}/s/${link.alias}`);
  });

  it('the toast clears itself', async () => {
    await page.goto('/links');
    await page.getByRole('button', { name: /Create link/ }).first().click();
    await dialog(page).getByPlaceholder('https://4th-entity.com/about-us').fill(`https://example.com/${unique('toast')}`);
    await dialog(page).getByRole('button', { name: /Create link/ }).click();
    await expect(page.locator('.toast')).toHaveCount(1);
    await expect.poll(() => page.locator('.toast').count(), { timeout: 8000 }).toBe(0);
  });
});
