import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, seedInvoice, seedLink, seedUtm } from './helpers';

const run = chromeAvailable ? describe : describe.skip;

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

run('Phone layout', () => {
  it('no page scrolls sideways at 375px', async () => {
    const link = await seedLink();
    const utm = await seedUtm();
    const inv = await seedInvoice({ status: 'sent', payments: [{ amount: 1000, date: '2026-10-01', method: 'Cash', note: '' }] });
    const admin = await openSession(browser, { width: 375, height: 812 });
    try {
      const paths = [
        '/links', '/links/analytics', `/links/edit?id=${link.id}`,
        '/utms', `/utms/edit?id=${utm.id}`,
        '/invoices', '/invoices/analytics', `/invoices/edit?id=${inv.id}`,
        '/settings', '/settings/shortener', '/settings/utm', '/settings/invoice', '/settings/team',
      ];
      const wide: string[] = [];
      for (const path of paths) {
        await admin.page.goto(path);
        await admin.page.locator('.sidebar').waitFor();
        await admin.page.waitForTimeout(500);
        const over = await admin.page.evaluate(() => {
          const main = document.querySelector('.main') as HTMLElement | null;
          return Math.max(document.documentElement.scrollWidth - innerWidth, main ? main.scrollWidth - main.clientWidth : 0);
        });
        if (over > 1) {
          const detail = await admin.page.evaluate(() => {
            const main = document.querySelector('.main') as HTMLElement;
            const clipped = (el: Element) => { for (let p = el.parentElement; p && !p.classList.contains('main'); p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'hidden' || ox === 'scroll') return true; } return false; };
            const wide: string[] = [];
            for (const el of document.querySelectorAll('body *')) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > innerWidth + 1 && !clipped(el) && getComputedStyle(el).position !== 'fixed') wide.push(`${el.tagName}.${String(el.className).slice(0, 30)}@${Math.round(r.right)}`);
            }
            return `doc=${document.documentElement.scrollWidth} main=${main.scrollWidth}/${main.clientWidth} ${wide.slice(0, 6).join(' ')}`;
          });
          wide.push(`${path} (+${over}px) ${detail}`);
        }
      }
      expect(wide).toEqual([]);
    } finally {
      await admin.context.close();
    }
  });

  it('the sign-in page fits a phone', async () => {
    const guest = await openSession(browser, { user: null, width: 375, height: 700 });
    try {
      await guest.page.goto('/login');
      await guest.page.getByPlaceholder('you@company.com').waitFor();
      expect(await guest.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    } finally {
      await guest.context.close();
    }
  });
});

run('No placeholders flash while data loads', () => {
  it('the sidebar and lists stay neutral until settings arrive', async () => {
    await seedLink();
    const admin = await openSession(browser);
    try {
      const p = admin.page;
      await p.route('**/api/settings', async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });
      await p.goto('/links');
      await p.waitForTimeout(500);
      // Settings are still on their way: no made-up logo letter, no "Domain pending", no half-drawn list.
      expect(await p.locator('.sidebar .workspace-avatar').innerText()).toBe('');
      await expect(p.locator('.sidebar .workspace-avatar.skeleton')).toBeVisible();
      expect(await p.locator('body').innerText()).not.toMatch(/Domain pending|Workspace$/m);
      await expect(p.locator('.link-card .link-dest')).toHaveCount(0); // only grey loading rows
      // Then the real thing appears.
      await expect(p.locator('.link-card').first()).toBeVisible();
      await expect(p.locator('.sidebar .workspace-name')).toContainText('My workspace');
    } finally {
      await admin.context.close();
    }
  });

  it('the sign-in page shows a neutral logo until the workspace name arrives', async () => {
    const guest = await openSession(browser, { user: null });
    try {
      await guest.page.route('**/api/auth/brand', async (route) => {
        await new Promise((r) => setTimeout(r, 1200));
        await route.continue();
      });
      await guest.page.goto('/login');
      await expect(guest.page.locator('.login-logo.skeleton')).toBeVisible();
      expect(await guest.page.locator('.login-logo').innerText()).toBe('');
      await expect(guest.page.locator('.login-workspace')).toContainText('My workspace');
    } finally {
      await guest.context.close();
    }
  });

  it('the invoice list waits for the date format so dates do not change shape', async () => {
    await seedInvoice();
    const admin = await openSession(browser);
    try {
      const p = admin.page;
      await p.route('**/api/settings', async (route) => {
        await new Promise((r) => setTimeout(r, 1200));
        await route.continue();
      });
      await p.goto('/invoices');
      await p.waitForTimeout(400);
      await expect(p.locator('.link-card .link-date')).toHaveCount(0);
      await expect(p.locator('.link-card .link-date').first()).toBeVisible();
    } finally {
      await admin.context.close();
    }
  });
});

run('Analytics pages', () => {
  it('link analytics shows its figures, switches the range and exports a CSV', async () => {
    const link = await seedLink();
    await api('GET', `/s/${link.alias}`).catch(() => undefined);
    const admin = await openSession(browser);
    try {
      const p = admin.page;
      await p.goto('/links/analytics');
      await expect(p.locator('.stat-card').first()).toBeVisible();
      for (const label of ['Clicks', 'Unique visitors', 'Active links']) await expect(p.getByText(label, { exact: true }).first()).toBeVisible();
      await p.getByLabel('Date range').click();
      await p.getByText('Last 7 days', { exact: false }).first().click().catch(() => undefined);
      await expect(p.locator('.stat-card').first()).toBeVisible();
      const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Export CSV' }).click()]);
      expect(download.suggestedFilename()).toMatch(/\.csv$/);
    } finally {
      await admin.context.close();
    }
  });

  it('invoice analytics shows totals in naira and exports a CSV', async () => {
    await seedInvoice({ status: 'sent' });
    const admin = await openSession(browser);
    try {
      const p = admin.page;
      await p.goto('/invoices/analytics');
      await expect(p.locator('.stat-card').first()).toBeVisible();
      await expect(p.locator('.stat-value').nth(1)).toContainText('₦');
      await expect(p.getByText('Latest invoice')).toBeVisible();
      // "Latest invoice" sits above the month-on-month chart.
      const order = await p.evaluate(() => {
        const titles = [...document.querySelectorAll('h4, .chart-title')].map((e) => e.textContent ?? '');
        return { latest: titles.findIndex((t) => t.includes('Latest invoice')), chart: titles.findIndex((t) => t.includes('month on month')) };
      });
      expect(order.latest).toBeGreaterThanOrEqual(0);
      expect(order.latest).toBeLessThan(order.chart);
      const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Export CSV' }).click()]);
      expect(download.suggestedFilename()).toMatch(/^invoices-.*\.csv$/);
    } finally {
      await admin.context.close();
    }
  });
});
