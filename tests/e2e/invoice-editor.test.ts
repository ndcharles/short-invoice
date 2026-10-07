import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, seedInvoice, unique, type Session } from './helpers';

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

const canvas = (p: Page) => p.locator('.edit-invoice-layout .invoice-canvas');
const dialog = (p: Page) => p.getByRole('dialog');
const totalRow = (p: Page) => p.locator('.inv-totals-row.grand').first().locator('.tot-value');
const grandText = (p: Page) => totalRow(p).innerText();

async function openInvoice(over: Record<string, unknown> = {}) {
  const inv = await seedInvoice(over);
  await page.goto(`/invoices/edit?id=${inv.id}`);
  await canvas(page).waitFor();
  return inv;
}
const stored = async (id: string) => (await api('GET', `/api/invoices/${id}`)).body.invoice;

run('Invoice editor: amounts and totals', () => {
  it('typing in an amount works character by character, can be cleared, and totals follow', async () => {
    await openInvoice();
    const amount = page.getByLabel('Item 1 amount');
    await amount.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(amount).toHaveValue('');
    await page.keyboard.type('2150000.5');
    await expect(amount).toHaveValue('2150000.5');
    await expect(totalRow(page)).toContainText('₦2,311,250.54'); // + 7.5% tax
    await page.keyboard.press('Tab');
    await expect(amount).toHaveValue('₦2,150,000.50');
    // Letters and junk are ignored while typing.
    await amount.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('12ab,3.456');
    await expect(amount).toHaveValue('123.456');
  });

  it('Detailed mode multiplies quantity by unit price', async () => {
    await openInvoice();
    await page.getByRole('button', { name: 'Detailed', exact: true }).click();
    await page.getByLabel('Item 1 quantity').fill('3');
    await page.getByLabel('Item 1 unit price').fill('50000');
    await expect(canvas(page)).toContainText('₦150,000.00');
    await expect(totalRow(page)).toContainText('₦161,250.00');
    await page.getByRole('button', { name: 'Simple', exact: true }).click();
    await expect(page.getByLabel('Item 1 amount')).toHaveValue('₦150,000.00');
  });

  it('discount (value and %), additional charges and tax combine in the standard order', async () => {
    await openInvoice();
    await page.getByLabel('Item 1 amount').fill('100000');
    await page.getByLabel('Discount', { exact: true }).fill('10');
    await page.getByRole('button', { name: '%', exact: true }).click();
    await page.getByLabel('Additional charges').fill('5000');
    await expect(totalRow(page)).toContainText('₦102,125.00');
    await page.getByLabel('Tax rate in percent').fill('0');
    await expect(totalRow(page)).toContainText('₦95,000.00');
    // Switch the discount to a flat amount: 10 naira off.
    await page.getByTitle('Fixed amount').click();
    await expect(totalRow(page)).toContainText('₦104,990.00');
  });

  it('adds, duplicates, reorders and deletes items', async () => {
    await openInvoice();
    await page.getByRole('button', { name: 'Add Item' }).click();
    await page.getByLabel('Item 2 name').fill('Second');
    await page.getByLabel('Item 2 amount').fill('5000');
    await expect(canvas(page).locator('.inv-item-row')).toHaveCount(2);
    await canvas(page).locator('.inv-item-row').first().getByTitle('Duplicate').click();
    await expect(canvas(page).locator('.inv-item-row')).toHaveCount(3);
    await canvas(page).locator('.inv-item-row').nth(1).getByTitle('Delete').click();
    await expect(canvas(page).locator('.inv-item-row')).toHaveCount(2);
    await expect(page.getByLabel('Item 2 name')).toHaveValue('Second');
  });

  it('Reset clears the items after an in-app confirmation', async () => {
    await openInvoice();
    await page.getByLabel('Item 1 amount').fill('99999');
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(dialog(page).getByText('Reset this invoice?')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Item 1 amount')).toHaveValue('₦99,999.00');
    await page.getByRole('button', { name: 'Reset' }).click();
    await dialog(page).getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByLabel('Item 1 amount')).toHaveValue('₦0.00');
  });
});

run('Invoice editor: USD equivalent and currency', () => {
  it('adds, overrides, resets and removes the USD equivalent', async () => {
    await openInvoice();
    await page.getByLabel('Item 1 amount').fill('150000');
    await page.getByText('+ Add USD equivalent').click();
    // Default rate from settings (₦1,500 = $1): ₦161,250 → $107.50.
    await expect(page.getByLabel('Exchange rate')).toHaveValue('1,500');
    await expect(page.getByLabel('Equivalent in USD')).toHaveValue('107.50');
    await page.getByLabel('Exchange rate').fill('1600');
    await expect(page.getByLabel('Equivalent in USD')).toHaveValue('100.78');
    await page.getByLabel('Equivalent in USD').fill('100');
    await page.getByRole('button', { name: 'reset', exact: true }).click();
    await expect(page.getByLabel('Equivalent in USD')).toHaveValue('100.78');
    await page.getByRole('button', { name: /Remove the USD equivalent/ }).click();
    await expect(page.getByText('+ Add USD equivalent')).toBeVisible();
  });

  it('switching to USD offers to convert the prices in an app dialog', async () => {
    await openInvoice();
    await page.getByLabel('Item 1 amount').fill('150000');
    await page.locator('.currency-picker select').selectOption('USD');
    await expect(dialog(page).getByText('Switch to USD')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Convert to USD' }).click();
    await expect(canvas(page)).toContainText('$107.50');
    // A USD invoice for a foreign client shows no naira equivalent by default.
    await expect(page.getByText(/Equivalent \(NGN\)/)).toHaveCount(0);
    await expect(page.getByText('+ Add NGN equivalent')).toBeVisible();
    expect(s.nativeDialogs).toEqual([]);

    // Keep the numbers on the way back: only the label changes.
    await page.locator('.currency-picker select').selectOption('NGN');
    await dialog(page).getByRole('button', { name: 'Keep the numbers' }).click();
    await expect(page.getByLabel('Item 1 amount')).toHaveValue('₦100.00');
  });

  it('shows the right bank accounts: naira only, plus USD when the equivalent is added', async () => {
    await openInvoice();
    await expect(canvas(page).locator('.inv-account-name')).toHaveCount(1);
    await page.getByText('+ Add USD equivalent').click();
    await expect(canvas(page).locator('.inv-account-name')).toHaveCount(2);
  });
});

run('Invoice editor: saving, status and payments', () => {
  it('shows the save bar on edit, saves, and Discard puts things back', async () => {
    const inv = await openInvoice();
    await expect(page.locator('.save-bar.visible')).toHaveCount(0);
    await page.getByLabel('Item 1 name').fill('Edited');
    await expect(page.locator('.save-bar.visible')).toBeVisible();
    await page.locator('.save-bar').getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByLabel('Item 1 name')).toHaveValue('Work');
    await expect(page.locator('.save-bar.visible')).toHaveCount(0);

    await page.getByLabel('Item 1 amount').fill('250000');
    await page.getByLabel('Client name').fill('Renamed Client Ltd');
    await page.locator('.save-bar').getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => (await stored(inv.id)).total).toBe(268750);
    expect((await stored(inv.id)).client_name).toBe('Renamed Client Ltd');
    await expect(page.locator('.save-bar.visible')).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('Client name')).toHaveValue('Renamed Client Ltd');
  });

  it('refuses to save without a client name and says why', async () => {
    await openInvoice();
    await page.getByLabel('Client name').fill('');
    await page.locator('.save-bar').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.save-bar')).toContainText(/client name/i);
  });

  it('dates are edited by clicking them, with no extra fields', async () => {
    const inv = await openInvoice();
    await expect(canvas(page).locator('.inv-date-field')).toHaveCount(2);
    await page.getByLabel('Due date').fill('2030-01-31');
    await expect(canvas(page).locator('.inv-date-field').first()).toContainText('31 Jan 2030');
    await page.locator('.save-bar').getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => new Date((await stored(inv.id)).due_at).toISOString().slice(0, 10)).toBe('2030-01-31');
  });

  it('the status menu offers only Draft, Sent and Cancelled; Overdue and Paid are automatic', async () => {
    const inv = await openInvoice();
    await page.locator('.status-switch button').click();
    const menu = page.locator('.dropdown[data-popover]').filter({ hasText: 'Change status' });
    await expect(menu.getByText('Draft', { exact: true })).toBeVisible();
    await expect(menu.getByText('Sent', { exact: true })).toBeVisible();
    await expect(menu.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(menu.locator('.dropdown-item').getByText('Overdue', { exact: true })).toHaveCount(0);
    await menu.locator('.dropdown-item', { hasText: 'Sent' }).click();
    await page.locator('.save-bar').getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => (await stored(inv.id)).status).toBe('sent');
    await expect(canvas(page).locator('.inv-status-big')).toContainText('SENT');
  });

  it('logs a part payment, then the rest; the stamp, balance and receipt follow', async () => {
    const inv = await openInvoice({ status: 'sent' });
    await page.getByRole('button', { name: 'Log Payment' }).first().click();
    await expect(dialog(page).getByText('Log Payment')).toBeVisible();
    await dialog(page).getByLabel('Fully paid').uncheck().catch(async () => {
      await dialog(page).locator('input[type=checkbox]').first().uncheck();
    });
    await dialog(page).getByLabel('Amount paid').fill('50000');
    await dialog(page).getByRole('button', { name: 'Add Payment' }).click();
    await expect(canvas(page).locator('.inv-status-big')).toContainText('PARTIALLY PAID');
    await expect(canvas(page)).toContainText('Balance Due');
    await expect(canvas(page)).toContainText('₦57,500.00');
    await expect(canvas(page).locator('.inv-number')).toContainText('Receipt');

    await page.getByRole('button', { name: 'Log Payment' }).first().click();
    await dialog(page).getByRole('button', { name: 'Add Payment' }).click(); // fully paid is pre-ticked
    await expect(canvas(page).locator('.inv-status-big')).toContainText('PAID');
    await expect.poll(async () => (await stored(inv.id)).status).toBe('paid');
    await expect(page.locator('.rail-actions').getByRole('button', { name: 'Log Payment' })).toBeDisabled();

    // View Invoice shows the original: no payments, no stamp, "Amount Due".
    await page.getByRole('button', { name: 'View Invoice' }).click();
    await expect(canvas(page).locator('.inv-number')).toContainText('Invoice');
    await expect(canvas(page).locator('.inv-stamp')).toHaveCount(0);
    await expect(canvas(page)).toContainText('Amount Due');
    await expect(canvas(page).locator('.tot-paid')).toHaveCount(0);
    await page.getByRole('button', { name: 'View Receipt' }).click();
    await expect(canvas(page).locator('.inv-stamp')).toBeVisible();
  });

  it('removing a payment asks first and reopens the balance', async () => {
    const inv = await openInvoice({ status: 'sent', payments: [{ amount: 107500, date: '2026-10-01', method: 'Cash', note: '' }] });
    await expect.poll(async () => (await stored(inv.id)).status).toBe('paid');
    await page.reload();
    await page.getByTitle('Remove this payment').click();
    await expect(dialog(page).getByText('Remove this payment?')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Remove payment' }).click();
    await expect.poll(async () => (await stored(inv.id)).status).toBe('sent');
  });

  it('the Download buttons open the print dialog for the receipt or the original', async () => {
    await openInvoice({ status: 'sent', payments: [{ amount: 1000, date: '2026-10-01', method: 'Cash', note: '' }] });
    await page.evaluate(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints += 1;
      };
    });
    await page.getByRole('button', { name: 'Download receipt' }).click();
    await page.getByRole('button', { name: 'Download original invoice' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(2);
    await page.getByRole('button', { name: 'Download PDF' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(3);
  });

  it('folder and tag in the side panel are saved with the invoice', async () => {
    const inv = await openInvoice();
    await page.locator('.rail-field', { hasText: 'Tag' }).locator('select').selectOption('Retainer').catch(async () => {
      await api('POST', '/api/collections', { kind: 'tags', name: 'Retainer', color: 'green' });
      await page.reload();
      await page.locator('.rail-field', { hasText: 'Tag' }).locator('select').selectOption('Retainer');
    });
    await page.locator('.save-bar').getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => (await stored(inv.id)).tag).toBe('Retainer');
  });
});

run('Invoice editor: the ⋯ menu and sending', () => {
  it('Duplicate as new draft, Print, and Delete (admin) with confirmation', async () => {
    const inv = await openInvoice({ client_name: unique('Menu Client') });
    await page.locator('.crumb-bar .toolbar-menu .icon-btn').click();
    await expect(page.getByText('Duplicate as new draft')).toBeVisible();
    await expect(page.getByText('Print / PDF')).toBeVisible();
    await page.getByText('Duplicate as new draft').click();
    await page.waitForURL((url) => url.pathname === '/invoices/edit' && url.searchParams.get('id') !== inv.id);
    expect(page.url()).not.toContain(inv.id);

    await page.goto(`/invoices/edit?id=${inv.id}`);
    await page.locator('.crumb-bar .toolbar-menu .icon-btn').click();
    await page.getByText('Delete invoice').click();
    await expect(dialog(page).getByText(new RegExp(`Delete ${inv.number}`))).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await page.waitForURL(/\/invoices$/);
    expect((await api('GET', `/api/invoices/${inv.id}`)).status).toBe(404);
  });

  it('the Send dialog offers the three attachments, fills the company sign-off, and explains missing SMTP', async () => {
    await openInvoice({ status: 'sent' });
    await page.getByRole('button', { name: /^Send$/ }).click();
    await expect(dialog(page).getByText('Send to client')).toBeVisible();
    // Before any payment only the invoice can be attached.
    await expect(dialog(page).locator('.send-choice')).toHaveCount(3);
    await expect(dialog(page).getByLabel('Receipt only')).toBeDisabled();
    await expect(dialog(page).getByLabel('Invoice only')).toBeChecked();
    await expect(dialog(page).locator('textarea')).toContainText(/Thanks,\s*Your Company Ltd/);
    await expect(dialog(page).getByText(/not set up yet/)).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  it('with payments, Receipt only is the default and all three options can be picked', async () => {
    await openInvoice({ status: 'sent', payments: [{ amount: 1000, date: '2026-10-01', method: 'Cash', note: '' }] });
    await page.getByRole('button', { name: 'Send receipt' }).click();
    await expect(dialog(page).getByLabel('Receipt only')).toBeChecked();
    await dialog(page).getByLabel('Invoice + Receipt').check();
    await expect(dialog(page).getByLabel('Invoice + Receipt')).toBeChecked();
    await dialog(page).getByLabel('Invoice only').check();
    await expect(dialog(page).locator('.log-field', { hasText: 'Subject' }).locator('input')).toHaveValue(/Invoice/);
  });
});
