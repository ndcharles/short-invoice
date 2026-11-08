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
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

run('client tracker', () => {
  it('logs a client with only some parts switched on, plus a "Something else" job', async () => {
    const name = unique('Lagos Fresh');
    await page.goto('/clients/new');
    await page.locator('#c-name').fill(name);
    await page.locator('#c-site').fill('lagosfresh.example');
    await page.locator('#c-logins').fill('Password manager › Clients');

    // Off parts are one collapsed row each.
    await expect(page.locator('.ct-svc:not(.on)', { hasText: 'Email' })).toContainText('Not with us');
    await shot('01-log-client-empty');

    await page.getByRole('switch', { name: 'Domain is with us' }).click();
    await page.locator('#p-domain-registrar').fill('Namecheap');
    await page.locator('#p-domain-date').fill(isoIn(40));
    await page.locator('#p-domain-price').fill('22000');
    await page.getByRole('switch', { name: 'Hosting is with us' }).click();
    await page.locator('#p-hosting-date').fill(isoIn(200));
    await page.locator('#p-hosting-price').fill('45000');

    await page.getByRole('button', { name: 'Something else', exact: true }).click();
    await page.locator('#o-0-name').fill('Staff training day');
    await page.locator('#o-0-qty').fill('2');
    await page.locator('#o-0-price').fill('120000');
    // The rail lists what each switched-on service gets.
    await expect(page.locator('.ct-rail')).toContainText('Domain');
    await expect(page.locator('.ct-rail')).toContainText('Staff training day');
    await shot('02-log-client-filled');

    await page.getByRole('button', { name: 'Save client', exact: true }).click();
    await page.waitForURL(/\/clients\/view\?id=/);
    await expect(page.locator('h1')).toContainText(name);
    for (const service of ['Domain', 'Hosting', 'Staff training day']) await expect(page.locator('.ct-row', { hasText: service }).first()).toBeVisible();
    await shot('03-client-page');

    // Renew the domain with an invoice.
    await page.locator('.ct-row', { hasText: 'Namecheap' }).getByRole('button', { name: 'Renew', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Counted from the old date');
    await shot('04-renew-dialog');
    await page.getByRole('button', { name: 'Renew and create invoice' }).click();
    await expect(page.locator('.toast').first()).toContainText('Draft invoice');
    await expect(page.locator('.ct-card', { hasText: 'Invoices' }).locator('.ct-row')).toHaveCount(1);

    // Start, then deliver the job: delivering drafts its invoice.
    await page.locator('.ct-row', { hasText: 'Staff training day' }).getByRole('button', { name: 'Start' }).click();
    await page.locator('.ct-row', { hasText: 'Staff training day' }).getByRole('button', { name: 'Mark delivered' }).click();
    await expect(page.locator('.ct-card', { hasText: 'Invoices' }).locator('.ct-row')).toHaveCount(2);

    // Add a service from the client page.
    await page.getByRole('button', { name: 'Add service' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Email', exact: true }).click();
    await page.locator('#dlg-date').fill(isoIn(15));
    await shot('05-add-service');
    await page.getByRole('button', { name: 'Save service' }).click();
    await expect(page.locator('.ct-row', { hasText: 'Email' }).first()).toBeVisible();

    // A maintenance plan: the visit dialog lists the steps for what it looks after.
    await page.getByRole('button', { name: 'Add service' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Maintenance plan', exact: true }).click();
    await page.locator('#dlg-date').fill(isoIn(0));
    await page.getByRole('dialog').locator('label.ct-pill', { hasText: 'Email' }).click();
    await page.getByRole('button', { name: 'Save service' }).click();
    await page.locator('.ct-row', { hasText: 'Maintenance plan' }).getByRole('button', { name: 'Mark visit done' }).click();
    await expect(page.getByRole('dialog')).toContainText('Check the DNS records');
    await page.getByRole('dialog').getByLabel('Check the DNS records').check();
    await shot('05b-visit');
    await page.getByRole('dialog').getByRole('button', { name: 'Mark visit done' }).click();
    await expect(page.locator('.toast').first()).toContainText('1 of 3 steps');

    // A note with a reminder date.
    await page.locator('#note-text').fill('Called them about the renewal');
    await page.locator('#note-remind').fill(isoIn(3));
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.locator('.ct-card', { hasText: 'Notes and activity' })).toContainText('Called them about the renewal');
    await shot('05c-notes');

    await page.goto('/clients');
    await page.getByPlaceholder(/Search name/).fill(name);
    await expect(page.locator('.ct-row', { hasText: name })).toHaveCount(1);
    await shot('06-clients-list');

    await page.goto('/clients/due');
    await expect(page.locator('.ct-row', { hasText: name }).first()).toBeVisible();
    await shot('07-due-dates');
    expect(s.errors).toEqual([]);
    expect(s.nativeDialogs).toEqual([]);
  });

  it('Settings → Clients: add a service type and see it in the Add list', async () => {
    const typeName = unique('LMS setup');
    await page.goto('/settings/clients');
    await page.getByRole('button', { name: 'Add service type' }).click();
    await page.locator('#t-name').fill(typeName);
    await page.locator('#t-price').fill('450000');
    await shot('08-new-service-type');
    await page.getByRole('button', { name: 'Create service type' }).click();
    await expect(page.locator('.settings-card', { hasText: 'Service types' })).toContainText(typeName);
    await shot('09-settings-clients');

    await page.goto('/clients/new');
    await expect(page.getByRole('button', { name: typeName })).toBeVisible();
    const types = (await api('GET', '/api/service-types')).body.types as { name: string; kind: string }[];
    expect(types.find((t) => t.name === typeName)?.kind).toBe('job');
    expect(s.errors).toEqual([]);
  });
});
