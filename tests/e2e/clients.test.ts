import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, unique, type Session } from './helpers';

const run = chromeAvailable ? describe : describe.skip;
const SHOTS = process.env.CLIENT_SHOTS_DIR;

let browser: Browser;
let s: Session;
let page: Page;

beforeAll(async () => {
  browser = await launch();
  s = await openSession(browser, { width: 1360, height: 1000 });
  page = s.page;
});
afterAll(async () => {
  await browser?.close();
});

const shot = async (name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
let loggedClient = '';
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

run('client tracker', () => {
  it('logs a client with a website (domain and hosting ticked), plus a "Something else" job', async () => {
    const name = unique('Lagos Fresh');
    await page.goto('/clients/new');
    await page.locator('#c-name').fill(name);
    await page.locator('#c-site').fill('lagosfresh.example');
    await page.locator('#c-logins').fill('Password manager › Clients');
    loggedClient = name;

    // Billing details sit in one row, laid out like "Invoiced To" on an invoice.
    await page.locator('#c-contact').fill('Ada Obi');
    await page.locator('#c-email').fill('billing@lagosfresh.example');
    // Billing details stay folded away until asked for.
    await expect(page.locator('#c-street')).toHaveCount(0);
    await page.getByRole('button', { name: '+ Add billing details' }).scrollIntoViewIfNeeded();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/00a-billing-closed.png` });
    await page.getByRole('button', { name: '+ Add billing details' }).click();
    await page.locator('#c-street').fill('12 Allen Avenue');
    await page.locator('#c-city').fill('Ikeja, Lagos 100001');
    await page.locator('#c-country').fill('Nigeria');
    const [street, city, country] = await Promise.all(['#c-street', '#c-city', '#c-country'].map((id) => page.locator(id).boundingBox()));
    expect(street!.y).toBe(city!.y);
    expect(city!.y).toBe(country!.y);
    await page.locator('.ct-billing').scrollIntoViewIfNeeded();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/00b-billing.png` });

    // The "i" tips open on hover and on a tap.
    await page.locator('.ct-tip').first().hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    // No tags; unticking "Same number on WhatsApp" asks for the WhatsApp number.
    await expect(page.locator('#c-wa')).toHaveCount(0);
    await page.getByLabel('Same number on WhatsApp').uncheck();
    await page.locator('#c-wa').fill('+234 901 222 3344');

    // Website, Email and Maintenance plan, each off (collapsed) until switched on.
    await expect(page.locator('.ct-svc.on')).toHaveCount(0);
    await expect(page.locator('.ct-svc:not(.on)', { hasText: 'Email' })).toContainText('Not with us');
    await shot('01-log-client-empty');

    await page.getByRole('switch', { name: 'Website is with us' }).click();
    const site = page.locator('.ct-svc.on', { has: page.getByRole('switch', { name: 'Website is with us' }) });
    // Website has no "How it works": a due date, a charge and an optional renewal date.
    await expect(site.getByRole('group', { name: 'How it works' })).toHaveCount(0);
    await page.locator('#p-website-built').fill('WordPress');
    await expect(page.locator('#p-website-prov-domain')).toHaveCount(0);
    await site.locator('label.ct-pill', { hasText: 'Domain' }).click();
    await site.locator('label.ct-pill', { hasText: 'Hosting' }).click();
    await page.locator('#p-website-prov-domain').fill('Namecheap');
    await page.locator('#p-website-prov-hosting').fill('Hetzner');
    await page.locator('#p-website-price').fill('45000');
    await page.locator('#p-website-renew').fill(isoIn(40));
    await site.getByRole('button', { name: 'Delivered', exact: true }).click();
    await site.scrollIntoViewIfNeeded();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/02a-website.png` });

    await page.getByRole('button', { name: 'Something else', exact: true }).click();
    await page.locator('#o-0-name').fill('Staff training day');
    await page.locator('#o-0-due').fill(isoIn(10));
    await page.locator('#o-0-price').fill('120000');
    // The rail lists what each switched-on service gets.
    await expect(page.locator('.ct-rail')).toContainText('Website');
    await expect(page.locator('.ct-rail')).toContainText('Staff training day');
    await shot('02-log-client-filled');

    await page.getByRole('button', { name: 'Save client', exact: true }).click();
    await page.waitForURL(/\/clients\/view\?id=/);
    await expect(page.locator('h1')).toContainText(name);
    await expect(page.locator('.ct-row', { hasText: 'Website (domain, hosting)' })).toBeVisible();
    await expect(page.locator('.ct-row', { hasText: 'Staff training day' })).toBeVisible();
    await shot('03-client-page');

    // The ⋯ menu opens above the page, not clipped by the services table.
    await page.getByRole('button', { name: 'More actions for Website' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 1000).toBe(true);
    await shot('03b-service-menu');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // Renew the website with an invoice; the price can change in the dialog.
    await page.locator('.ct-row', { hasText: 'Website (domain, hosting)' }).getByRole('button', { name: 'Renew', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Counted from the old date');
    await page.locator('#renew-price').fill('48000');
    await shot('04-renew-dialog');
    await page.getByRole('button', { name: 'Renew and create invoice' }).click();
    await expect(page.locator('.toast').first()).toContainText('Draft invoice');
    await expect(page.locator('.ct-card', { hasText: 'Invoices' }).locator('.ct-row')).toHaveCount(1);

    // Start, then deliver the job: delivering drafts its invoice.
    await page.locator('.ct-row', { hasText: 'Staff training day' }).getByRole('button', { name: 'Start' }).click();
    await page.locator('.ct-row', { hasText: 'Staff training day' }).getByRole('button', { name: 'Mark delivered' }).click();
    await expect(page.locator('.ct-card', { hasText: 'Invoices' }).locator('.ct-row')).toHaveCount(2);

    // Add Email from the client page.
    await page.getByRole('button', { name: 'Add service' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Email', exact: true }).click();
    await page.locator('#dlg-provider').fill('Google Workspace');
    await page.locator('#dlg-mailboxes').fill('5');
    await page.locator('#dlg-renew').fill(isoIn(15));
    await shot('05-add-email');
    await page.getByRole('button', { name: 'Save service' }).click();
    await expect(page.locator('.ct-row', { hasText: 'Google Workspace' })).toBeVisible();

    // A maintenance plan: scheduled, and "Mark done" lists the steps for what it looks after.
    await page.getByRole('button', { name: 'Add service' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Maintenance plan', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('group', { name: 'How it works' })).toContainText('Scheduled');
    await page.locator('#dlg-next').fill(isoIn(0));
    await page.getByRole('dialog').locator('label.ct-pill', { hasText: 'Email' }).click();
    await shot('05a-add-maintenance');
    await page.getByRole('button', { name: 'Save service' }).click();
    await page.locator('.ct-row', { hasText: 'Maintenance plan' }).getByRole('button', { name: 'Mark done' }).click();
    await expect(page.getByRole('dialog')).toContainText('Mark done: Maintenance plan');
    await expect(page.getByRole('dialog')).toContainText('Check the DNS records');
    await page.getByRole('dialog').getByLabel('Check the DNS records').check();
    await shot('05b-mark-done');
    await page.getByRole('dialog').getByRole('button', { name: 'Mark done' }).click();
    await expect(page.locator('.toast').first()).toContainText('1 of 3 steps');

    // A note with a reminder date.
    await page.locator('#note-text').fill('Called them about the renewal');
    await page.locator('#note-remind').fill(isoIn(3));
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.locator('.ct-card', { hasText: 'Notes and activity' })).toContainText('Called them about the renewal');
    await shot('05c-notes');

    await page.goto('/clients');
    await page.getByPlaceholder(/Search name/).fill(name);
    const row = page.locator('.ct-row', { hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.ct-svc-words')).toContainText('Website · Staff training day · Email · Maintenance plan');
    await shot('06-clients-list');

    await page.goto('/clients/due');
    await expect(page.locator('.ct-row', { hasText: name }).first()).toBeVisible();
    await shot('07-due-dates');
    expect(s.errors).toEqual([]);
    expect(s.nativeDialogs).toEqual([]);
  });

  it('picks a client on a new invoice and fills "Invoiced To" from their billing details', async () => {
    expect(loggedClient).toBeTruthy();
    await page.goto('/invoices');
    await page.getByRole('button', { name: /Create invoice/ }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Client name').fill(loggedClient.slice(0, 8));
    const option = dlg.getByRole('option', { name: new RegExp(loggedClient) });
    await expect(option).toBeVisible();
    await expect(option).toContainText('Ada Obi');
    await shot('10-invoice-client-picker');
    await option.click();
    await expect(dlg.getByLabel('Client name')).toHaveValue(loggedClient);
    await expect(dlg.getByPlaceholder('Contact person')).toHaveValue('Ada Obi');
    await expect(dlg.getByPlaceholder('Street address')).toHaveValue('12 Allen Avenue');
    await expect(dlg.getByPlaceholder('City, State, Postal code')).toHaveValue('Ikeja, Lagos 100001');
    await expect(dlg.getByPlaceholder('Country')).toHaveValue('Nigeria');
    await expect(dlg.getByPlaceholder('client@company.com')).toHaveValue('billing@lagosfresh.example');
    await expect(dlg.locator('.inv-linked')).toContainText("Use client's details");
    await shot('11-invoice-filled');
    await dlg.getByLabel('Item 1 name').fill('Consulting');
    await dlg.getByLabel('Item 1 amount').fill('1000');
    await dlg.getByRole('button', { name: /Create invoice/ }).click();
    await page.waitForURL(/\/invoices\/edit\?id=/);
    const id = new URL(page.url()).searchParams.get('id')!;
    const invoice = (await api('GET', `/api/invoices/${id}`)).body.invoice as { client_id: string; client_address: string };
    expect(invoice.client_id).toMatch(/^cli_/);
    expect(invoice.client_address).toBe(`${loggedClient}\nAda Obi\n12 Allen Avenue\nIkeja, Lagos 100001\nNigeria`);

    // One-way: editing the invoice leaves the client alone; "Use client's details" refills it.
    await page.getByPlaceholder('Contact person').fill('Someone else');
    await page.getByRole('button', { name: "Use client's details" }).click();
    await expect(page.getByPlaceholder('Contact person')).toHaveValue('Ada Obi');
    expect(s.errors).toEqual([]);
  });

  it('Settings → Clients: add a service type and see it in the Add list', async () => {
    const typeName = unique('LMS setup');
    await page.goto('/settings/clients');
    await expect(page.locator('.ct-types')).not.toContainText('Hosting');
    await page.getByRole('button', { name: 'Add service type' }).click();
    await expect(page.getByRole('dialog')).not.toContainText('How does it work');
    await page.locator('#t-name').fill(typeName);
    await page.locator('#t-price').fill('450000');
    await shot('08-new-service-type');
    await page.getByRole('button', { name: 'Create service type' }).click();
    await expect(page.locator('.settings-card', { hasText: 'Service types' })).toContainText(typeName);
    await shot('09-settings-clients');

    await page.goto('/clients/new');
    await expect(page.getByRole('button', { name: typeName })).toBeVisible();
    const types = (await api('GET', '/api/service-types')).body.types as { name: string; show_in_add: number }[];
    expect(types.find((t) => t.name === typeName)?.show_in_add).toBe(1);
    expect(s.errors).toEqual([]);
  });
});
