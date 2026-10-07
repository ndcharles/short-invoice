import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, seedInvoice, seedUtm, unique, type Session } from './helpers';

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
  await card(p, text).first().locator('button[data-row-menu]').click();
  await rowMenu(p).waitFor();
}

run('UTM page', () => {
  it('row menu: Edit, Duplicate, Copy, Archive/Unarchive and Delete all work', async () => {
    const utm = await seedUtm();
    await page.goto('/utms');
    await page.getByPlaceholder('Search by campaign or source').fill(utm.campaign);
    await expect(card(page, utm.campaign)).toHaveCount(1);

    await openRowMenu(page, utm.campaign);
    for (const item of ['Edit', 'Duplicate', 'Archive', 'Delete']) await expect(rowMenu(page).getByText(item, { exact: false }).first()).toBeVisible();

    // Copy puts the full tracked URL on the clipboard.
    await rowMenu(page).getByText(/Copy/).first().click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('utm_source=newsletter');
    expect(clip).toContain(`utm_campaign=${utm.campaign}`);

    await openRowMenu(page, utm.campaign);
    await rowMenu(page).getByText('Duplicate', { exact: true }).click();
    await expect
      .poll(async () => ((await api('GET', `/api/utms?search=${encodeURIComponent(utm.campaign)}`)).body.campaigns as unknown[]).length)
      .toBeGreaterThanOrEqual(2);

    await openRowMenu(page, utm.campaign);
    await rowMenu(page).getByText('Edit', { exact: true }).click();
    await page.waitForURL(/\/utms\/edit\?id=/);
    await page.goBack();

    await page.getByPlaceholder('Search by campaign or source').fill(utm.campaign);
    await expect(card(page, utm.campaign).first()).toBeVisible();
    await openRowMenu(page, utm.campaign);
    await rowMenu(page).getByText('Archive', { exact: true }).click();
    await page.getByRole('button', { name: /Archived/ }).click();
    await expect(card(page, utm.campaign).first()).toBeVisible();
    await openRowMenu(page, utm.campaign);
    await rowMenu(page).getByText('Unarchive', { exact: true }).click();
    await page.getByRole('button', { name: /All Active/ }).click();
    await expect(card(page, utm.campaign).first()).toBeVisible();
  });

  it('delete asks in an app dialog first', async () => {
    const utm = await seedUtm();
    await page.goto('/utms');
    await page.getByPlaceholder('Search by campaign or source').fill(utm.campaign);
    await expect(card(page, utm.campaign)).toHaveCount(1);
    await openRowMenu(page, utm.campaign);
    await rowMenu(page).getByText('Delete', { exact: true }).click();
    await expect(dialog(page).getByText('Delete this UTM?')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    expect((await api('GET', `/api/utms/${utm.id}`)).status).toBe(200);
    await openRowMenu(page, utm.campaign);
    await rowMenu(page).getByText('Delete', { exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => (await api('GET', `/api/utms/${utm.id}`)).status).toBe(404);
  });

  it('toolbar Refresh, search, sort and Clear filters work', async () => {
    await page.goto('/utms');
    const late = await seedUtm();
    await page.locator('.toolbar-menu .icon-btn[aria-label="More"]').click();
    await page.getByText('Refresh', { exact: true }).click();
    await page.getByPlaceholder('Search by campaign or source').fill(late.campaign);
    await expect(card(page, late.campaign)).toHaveCount(1);

    await page.getByRole('button', { name: /Sort/ }).click();
    await page.getByText('Campaign A–Z', { exact: true }).click();
    await expect(card(page, late.campaign)).toHaveCount(1);

    await page.getByPlaceholder('Search by campaign or source').fill('nothing-matches-this-zzz');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByPlaceholder('Search by campaign or source')).toHaveValue('');
  });

  it('creates a campaign from the dialog; the generated URL updates as you type', async () => {
    await page.goto('/utms');
    await page.getByRole('button', { name: /Create campaign/ }).first().click();
    await expect(dialog(page)).toBeVisible();
    // Nothing to create until a website is entered.
    await expect(dialog(page).getByRole('button', { name: /Create campaign/ })).toBeDisabled();
    await dialog(page).getByPlaceholder('https://www.example.com').fill('https://shop.example.com/sale');
    await expect(dialog(page).getByRole('button', { name: /Create campaign/ })).toBeEnabled();
    const name = unique('e2e-campaign');
    await dialog(page).getByLabel(/Campaign name/).fill(name).catch(async () => {
      await dialog(page).locator('label', { hasText: 'Campaign name' }).locator('..').locator('input').fill(name);
    });
    await expect(dialog(page)).toContainText(`utm_campaign=${name}`);
    await dialog(page).getByRole('button', { name: /Create campaign/ }).click();
    await expect(dialog(page)).toHaveCount(0);
    await page.getByPlaceholder('Search by campaign or source').fill(name);
    await expect(card(page, name)).toHaveCount(1);
  });
});

run('Invoices page', () => {
  it('status tabs count and filter the list', async () => {
    const draft = await seedInvoice();
    const sent = await seedInvoice({ status: 'sent' });
    await page.goto('/invoices');
    await page.getByPlaceholder('Search by number or client').fill(draft.client_name);
    await expect(card(page, draft.number)).toHaveCount(1);
    await page.getByPlaceholder('Search by number or client').fill(sent.client_name);
    await expect(card(page, sent.number)).toHaveCount(1);

    await page.getByRole('button', { name: /^Draft/ }).click();
    await expect(card(page, sent.number)).toHaveCount(0);
    await page.getByRole('button', { name: /^Sent/ }).click();
    await expect(card(page, sent.number)).toHaveCount(1);
    await page.getByRole('button', { name: /^All invoices/ }).click();
  });

  it('row menu: Edit, Duplicate, Copy number, and Change status with its sub-menu', async () => {
    const inv = await seedInvoice({ status: 'sent' });
    await page.goto('/invoices');
    await page.getByPlaceholder('Search by number or client').fill(inv.client_name);
    await expect(card(page, inv.number)).toHaveCount(1);

    await openRowMenu(page, inv.number);
    for (const item of ['Edit', 'Duplicate', 'Copy number', 'Log payment', 'Change status', 'Delete']) {
      await expect(rowMenu(page).getByText(item, { exact: true })).toBeVisible();
    }

    // Change status opens its sub-menu (it used to close the whole menu on mouse-down).
    await rowMenu(page).getByText('Change status', { exact: true }).click();
    await expect(rowMenu(page)).toBeVisible();
    const sub = page.locator('.status-sub');
    await expect(sub.getByText('Draft')).toBeVisible();
    await sub.getByText('Cancelled').click();
    await expect.poll(async () => (await api('GET', `/api/invoices/${inv.id}`)).body.invoice.status).toBe('cancelled');

    await openRowMenu(page, inv.number);
    await rowMenu(page).getByText('Copy number', { exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inv.number);

    await openRowMenu(page, inv.number);
    await rowMenu(page).getByText('Duplicate', { exact: true }).click();
    await expect
      .poll(async () => ((await api('GET', `/api/invoices?search=${encodeURIComponent(inv.client_name)}`)).body.invoices as unknown[]).length)
      .toBe(2);

    await page.getByPlaceholder('Search by number or client').fill(inv.client_name);
    await openRowMenu(page, inv.number);
    await rowMenu(page).getByText('Edit', { exact: true }).click();
    await page.waitForURL(/\/invoices\/edit\?id=/);
  });

  it('Log payment from the row menu records it and updates the status', async () => {
    const inv = await seedInvoice({ status: 'sent' });
    await page.goto('/invoices');
    await page.getByPlaceholder('Search by number or client').fill(inv.client_name);
    await expect(card(page, inv.number)).toHaveCount(1);
    await openRowMenu(page, inv.number);
    await rowMenu(page).getByText('Log payment', { exact: true }).click();
    await expect(dialog(page).getByText('Log Payment')).toBeVisible();
    // "Fully paid" is pre-ticked with the balance filled in.
    await expect(dialog(page).getByLabel('Amount paid')).toHaveValue(/107,500/);
    await dialog(page).getByRole('button', { name: 'Add Payment' }).click();
    await expect.poll(async () => (await api('GET', `/api/invoices/${inv.id}`)).body.invoice.status).toBe('paid');
    await expect(card(page, inv.number).getByText('Paid')).toBeVisible();
  });

  it('deleting asks first, and only an admin sees Delete', async () => {
    const inv = await seedInvoice();
    await page.goto('/invoices');
    await page.getByPlaceholder('Search by number or client').fill(inv.client_name);
    await openRowMenu(page, inv.number);
    await rowMenu(page).getByText('Delete', { exact: true }).click();
    await expect(dialog(page).getByText('Delete this invoice?')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    expect((await api('GET', `/api/invoices/${inv.id}`)).status).toBe(200);
    await openRowMenu(page, inv.number);
    await rowMenu(page).getByText('Delete', { exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => (await api('GET', `/api/invoices/${inv.id}`)).status).toBe(404);
  });

  it('toolbar Refresh, Filter, Sort and search work', async () => {
    await page.goto('/invoices');
    const late = await seedInvoice({ tag: 'Retainer', currency: 'USD' });
    const naira = await seedInvoice();
    await page.locator('.toolbar-menu .icon-btn[aria-label="More"]').click();
    await page.getByText('Refresh', { exact: true }).click();
    await page.getByPlaceholder('Search by number or client').fill(late.client_name);
    await expect(card(page, late.number)).toHaveCount(1);
    await page.getByPlaceholder('Search by number or client').fill('');

    // Filter by currency: only USD invoices remain.
    await page.getByRole('button', { name: /Filter/ }).click();
    await expect(page.getByText('Currency', { exact: true })).toBeVisible();
    await page.locator('.dropdown-item', { hasText: /^USD$/ }).click();
    await page.keyboard.press('Escape');
    await page.getByPlaceholder('Search by number or client').fill(naira.client_name);
    await expect(page.getByText('No invoices found')).toBeVisible();
    await page.getByPlaceholder('Search by number or client').fill(late.client_name);
    await expect(card(page, late.number)).toHaveCount(1);
    await page.getByRole('button', { name: /Filter/ }).click();
    await page.getByText('Clear filters', { exact: true }).click();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Sort/ }).click();
    for (const label of ['Newest first', 'Due soonest', 'Highest amount']) await expect(page.getByText(label, { exact: true })).toBeVisible();
    await page.getByText('Highest amount', { exact: true }).click();
    await expect(card(page, late.number)).toHaveCount(1);
  });

  it('creates an invoice from the dialog and lands on its editor', async () => {
    await page.goto('/invoices');
    await page.getByRole('button', { name: /Create invoice/ }).first().click();
    await expect(dialog(page)).toBeVisible();
    // The client name is required.
    await dialog(page).getByRole('button', { name: /Create invoice/ }).click();
    await expect(dialog(page).getByText(/client name/i).first()).toBeVisible();
    const client = unique('Created Client');
    await dialog(page).getByLabel('Client name').fill(client);
    await dialog(page).getByLabel('Item 1 name').fill('Consulting');
    await dialog(page).getByLabel('Item 1 amount').fill('250000');
    await dialog(page).getByRole('button', { name: /Create invoice/ }).click();
    await page.waitForURL(/\/invoices\/edit\?id=/);
    await expect(page.locator('.invoice-canvas')).toContainText('₦268,750.00');
    expect(((await api('GET', `/api/invoices?search=${encodeURIComponent(client)}`)).body.invoices as { total: number }[])[0].total).toBe(268750);
  });
});
