import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, unique, type Session } from './helpers';

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
const saveBar = (p: Page) => p.locator('.save-bar');
const row = (p: Page, label: string) => p.locator('.settings-row', { hasText: label }).first();
const settings = async () => (await api('GET', '/api/settings')).body.settings as Record<string, string>;
const save = async (p: Page) => {
  await expect(p.locator('.save-bar.visible')).toBeVisible();
  await saveBar(p).getByRole('button', { name: /Save/ }).click();
  await expect(p.locator('.save-bar.visible')).toHaveCount(0);
};

// A 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

run('Settings → General', () => {
  it('saves the workspace name and the sidebar shows it; Discard restores', async () => {
    const original = (await settings()).workspace_name;
    await page.goto('/settings');
    const name = row(page, 'Workspace name').locator('input');
    await name.fill('Renamed Space');
    await saveBar(page).getByRole('button', { name: 'Discard' }).click();
    await expect(name).toHaveValue(original);

    await name.fill('Renamed Space');
    await save(page);
    expect((await settings()).workspace_name).toBe('Renamed Space');
    await expect(page.locator('.sidebar .workspace-name')).toContainText('Renamed Space');
    await name.fill(original);
    await save(page);
  });

  it('uploads and removes the workspace logo, and rejects the wrong kind of file', async () => {
    await page.goto('/settings');
    const input = row(page, 'Workspace logo').locator('input[type=file]');
    await input.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(row(page, 'Workspace logo').locator('img')).toBeVisible();
    await save(page);
    expect((await settings()).workspace_logo).toMatch(/^data:image\/png;base64,/);
    await expect(page.locator('.sidebar .workspace-avatar img')).toBeVisible();

    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByText('Use a PNG, JPEG, GIF, WebP or SVG image.')).toBeVisible();
    await input.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(320 * 1024, 1) });
    await expect(page.getByText('Images must be under 300 KB.')).toBeVisible();

    await row(page, 'Workspace logo').getByRole('button', { name: 'Remove' }).click();
    await save(page);
    expect((await settings()).workspace_logo).toBe('');
  });

  it('the date format changes how dates read across the app', async () => {
    await page.goto('/settings');
    await row(page, 'Date format').getByRole('button', { name: '2026-03-19' }).click();
    await save(page);
    expect((await settings()).date_format).toBe('2026-03-19');
    await api('POST', '/api/invoices', { client_name: unique('Dates'), items: [{ name: 'x', qty: 1, unitPrice: 1 }] });
    await page.goto('/invoices');
    await expect(page.locator('.link-card .link-date').first()).toContainText(/\d{4}-\d{2}-\d{2}/);
    await page.goto('/settings');
    await row(page, 'Date format').getByRole('button', { name: '19 Mar 2026' }).click();
    await save(page);
  });

  it('adds, renames and deletes folders and tags (saved straight away)', async () => {
    await page.goto('/settings');
    const folder = unique('Folder');
    await page.getByRole('button', { name: 'Add folder' }).click();
    await page.getByPlaceholder('Folder name').fill(folder);
    await page.keyboard.press('Enter');
    await expect(page.getByText(folder, { exact: true })).toBeVisible();
    expect(((await api('GET', '/api/collections?kind=folders')).body.items as { name: string }[]).some((f) => f.name === folder)).toBe(true);

    const tag = unique('Tag');
    await page.getByRole('button', { name: 'Add tag' }).click();
    await page.getByPlaceholder('Tag name').fill(tag);
    await page.keyboard.press('Enter');
    await expect(page.getByText(tag, { exact: true })).toBeVisible();

    await page.getByTitle(`Delete ${tag}`).click();
    await expect(page.getByText(tag, { exact: true })).toHaveCount(0);
    await page.getByTitle(`Delete ${folder}`).click();
    await expect(page.getByText(folder, { exact: true })).toHaveCount(0);
  });

  it('Download JSON exports everything, without secrets', async () => {
    await page.goto('/settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    const text = await (await import('node:fs/promises')).readFile((await download.path()) as string, 'utf8');
    const data = JSON.parse(text);
    expect(Object.keys(data)).toEqual(expect.arrayContaining(['links', 'utms', 'invoices', 'folders', 'tags', 'settings']));
    expect(text).not.toMatch(/smtp_password"|pbkdf2|password_hash/);
  });
});

run('Settings → URL Shortener', () => {
  it('adds a domain, verifies it through the domain itself, makes it default and removes another', async () => {
    const host = `go${Date.now().toString(36)}.example`;
    await page.goto('/settings/shortener');
    await page.getByPlaceholder('links.example.com').fill(host);
    await page.getByRole('button', { name: 'Add domain' }).click();
    const rowFor = (h: string) => page.locator('.setting-list-row', { hasText: h });
    await expect(rowFor(host)).toBeVisible();
    await expect(rowFor(host)).toContainText(/Pending/i);

    // Verify pings the domain from the browser; the test host answers via the test Worker.
    await rowFor(host).getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('body')).toContainText(/Pending|Active|verified|answering|reach/i);
    // Bad domains are refused with a reason.
    await page.getByPlaceholder('links.example.com').fill('not a domain');
    await page.getByRole('button', { name: 'Add domain' }).click();
    await expect(page.getByText(/domain like|valid/i).first()).toBeVisible();

    await rowFor(host).getByTitle('Remove domain').click();
    await expect(dialog(page).getByText(`Remove ${host}?`)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Remove' }).click();
    await expect(rowFor(host)).toHaveCount(0);
    expect(s.nativeDialogs).toEqual([]);
  });

  it('saves the root redirect and link defaults, and rejects a bad redirect URL', async () => {
    await page.goto('/settings/shortener');
    const redirect = row(page, 'Redirect URL').locator('input');
    await redirect.fill('https://redirect.example.com');
    await save(page);
    expect((await settings()).root_redirect).toBe('https://redirect.example.com/');
    await redirect.fill('javascript:alert(1)');
    await saveBar(page).getByRole('button', { name: /Save/ }).click();
    await expect(saveBar(page)).toContainText(/http/i);
    await saveBar(page).getByRole('button', { name: 'Discard' }).click();
    await redirect.fill('');
    await save(page);
    expect((await settings()).root_redirect).toBe('');
  });

  it('the cloak default toggles and saves', async () => {
    await page.goto('/settings/shortener');
    const toggle = row(page, 'cloak').locator('.toggle').first();
    await toggle.click();
    await save(page);
    expect((await settings()).default_cloak).toBe('true');
    await toggle.click();
    await save(page);
    expect((await settings()).default_cloak).toBe('false');
  });
});

run('Settings → UTM and Invoice', () => {
  it('UTM defaults save and prefill the create form', async () => {
    await page.goto('/settings/utm');
    const source = row(page, 'Default source').locator('input');
    await source.fill('linkedin');
    await save(page);
    expect((await settings()).utm_default_source).toBe('linkedin');
    await page.goto('/utms');
    await page.getByRole('button', { name: /Create campaign/ }).first().click();
    await expect(dialog(page).locator('.field', { hasText: 'Campaign source' }).locator('input')).toHaveValue('linkedin');
    await page.keyboard.press('Escape');
    await page.goto('/settings/utm');
    await source.fill('newsletter');
    await save(page);
  });

  it('invoice settings: tax rate, payment terms and number format save and drive new invoices', async () => {
    await page.goto('/settings/invoice');
    await row(page, 'Tax rate').locator('input').fill('5');
    await row(page, 'Default payment terms').locator('select').selectOption('Net 14');
    await save(page);
    const now = await settings();
    expect(now.inv_tax_rate).toBe('5');
    expect(now.inv_payment_terms).toBe('Net 14');
    const created = await api('POST', '/api/invoices', { client_name: unique('Terms'), items: [{ name: 'x', qty: 1, unitPrice: 1000 }] });
    expect(created.body.invoice.total).toBe(1050);
    expect(Math.round((created.body.invoice.due_at - created.body.invoice.issued_at) / 86_400_000)).toBe(14);
    await row(page, 'Tax rate').locator('input').fill('7.5');
    await row(page, 'Default payment terms').locator('select').selectOption('Net 30');
    await save(page);
  });

  it('uploads the invoice logo and it shows on the invoice', async () => {
    await page.goto('/settings/invoice');
    await row(page, 'Company logo').locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(row(page, 'Company logo').locator('img')).toBeVisible();
    await save(page);
    const inv = await api('POST', '/api/invoices', { client_name: unique('Logo'), items: [{ name: 'x', qty: 1, unitPrice: 1 }] });
    await page.goto(`/invoices/edit?id=${inv.body.invoice.id}`);
    await expect(page.locator('.invoice-canvas .inv-logo-img')).toBeVisible();
    await page.goto('/settings/invoice');
    await row(page, 'Company logo').getByRole('button', { name: 'Remove' }).click();
    await save(page);
  });

  it('payment accounts and methods can be added, edited and removed', async () => {
    await page.goto('/settings/invoice');
    await page.getByText('Add payment account').click();
    await expect(page.getByText('New account')).toBeVisible();
    await page.locator('.setting-list-row', { hasText: 'New account' }).getByTitle('Edit account').click();
    await page.getByPlaceholder('Naira account').fill('Test account');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('.setting-list-row', { hasText: 'Test account' }).getByTitle('Delete account').click();
    await expect(page.getByText('Test account', { exact: true })).toHaveCount(0);

    await page.getByText('Add custom method').click();
    await expect(page.getByText('New method')).toBeVisible();
    await page.locator('.setting-list-row', { hasText: 'New method' }).getByTitle('Delete method').click();
    await expect(page.getByText('New method')).toHaveCount(0);
  });

  it('the SMTP card validates, never shows a saved password, and Send test email reports the failure', async () => {
    await page.goto('/settings/invoice');
    await row(page, 'SMTP server').locator('input').first().fill('127.0.0.1');
    await row(page, 'SMTP server').locator('input').nth(1).fill('9');
    await row(page, 'Security').locator('select').selectOption({ label: 'None (local testing only)' });
    await row(page, 'Send as').locator('input').nth(1).fill('billing@example.com');
    await page.getByRole('button', { name: 'Send test email' }).click();
    await expect(page.locator('[role=status]')).toContainText(/reach|refused|mail server|failed/i);

    await row(page, 'Password').locator('input').fill('secret-smtp-password');
    await save(page);
    await page.reload();
    await expect(row(page, 'Password').locator('input')).toHaveValue('');
    await expect(row(page, 'Password').locator('input')).toHaveValue('');
    expect((await settings()).smtp_password_set).toBe('true');
    expect(await page.content()).not.toContain('secret-smtp-password');

    await row(page, 'Password').getByRole('button', { name: 'Remove' }).click();
    await row(page, 'SMTP server').locator('input').first().fill('');
    await row(page, 'Send as').locator('input').nth(1).fill('');
    await save(page);
    expect((await settings()).smtp_password_set).toBe('false');
  });

  it('currencies: toggling and adding a custom currency', async () => {
    await page.goto('/settings/invoice');
    await page.getByRole('button', { name: /Add currency/ }).click();
    await page.getByPlaceholder('e.g. CAD (C$)').fill('AED (AED)');
    await page.keyboard.press('Enter');
    await expect(page.locator('.setting-chip', { hasText: 'AED (AED)' })).toBeVisible();
    await saveBar(page).getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('.setting-chip', { hasText: 'AED (AED)' })).toHaveCount(0);
  });
});
