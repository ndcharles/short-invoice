import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { api, chromeAvailable, launch, openSession, seedLink } from './helpers';

const run = chromeAvailable ? describe : describe.skip;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sqlite = (sql: string) =>
  execFileSync(path.join(ROOT, 'node_modules/.bin/wrangler'), ['d1', 'execute', 'short-invoice', '--local', '--persist-to', inject('persistDir'), '--json', '--command', sql], {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
  });
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

let browser: Browser;
let destination: http.Server;
let dest = '';
beforeAll(async () => {
  browser = await launch();
  destination = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Whatever the destination page says</title><h1 id="dest">DESTINATION ${req.url}</h1>`);
  });
  await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve));
  dest = `http://127.0.0.1:${(destination.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await browser?.close();
  destination?.close();
});

const DESTINATION_SAYS = { title: 'Blog Roll | Charles', description: 'Posts I keep coming back to', image: 'https://cdn.example.com/cover.png', siteName: 'Charles' };

/** A cloaked link whose destination's details are already known (the background fetch is switched off in tests). */
async function cloaked() {
  const link = await seedLink({ dest: `${dest}/landing` });
  sqlite(`UPDATE links SET dest_meta = ${quote(JSON.stringify({ state: 'ok', at: Date.now(), ...DESTINATION_SAYS }))} WHERE id = ${quote(link.id)}`);
  await api('PATCH', `/api/links/${link.id}`, { cloak: true });
  return link;
}
const stored = async (id: string) => (await api('GET', `/api/links/${id}`)).body.link;
/** An empty override is saved as null; either way it means "follow the destination". */
const blank = (value: unknown) => value === null || value === '';
const dialog = (p: Page) => p.getByRole('dialog');

run('Cloaked links, as a visitor in Chrome', () => {
  it('the browser tab and the page\'s social tags carry the destination\'s title, description and image', async () => {
    const link = await cloaked();
    const v = await openSession(browser, { user: null });
    try {
      await v.page.goto(`/s/${link.alias}`);
      await expect(v.page.frameLocator('iframe').locator('#dest')).toContainText('/landing'); // still shows the destination
      expect(await v.page.title()).toBe('Blog Roll | Charles');
      const content = (selector: string) => v.page.locator(selector).getAttribute('content');
      expect(await content('meta[property="og:title"]')).toBe('Blog Roll | Charles');
      expect(await content('meta[property="og:description"]')).toBe('Posts I keep coming back to');
      expect(await content('meta[property="og:image"]')).toBe('https://cdn.example.com/cover.png');
      expect(v.page.url()).toContain(`/s/${link.alias}`); // the address bar keeps the short link
      expect(v.errors).toEqual([]);
    } finally {
      await v.context.close();
    }
  });
});

run('Changing a cloaked link\'s preview in the editor', () => {
  it('replaces only what was changed, and the rest keeps following the destination', async () => {
    const link = await cloaked();
    const s = await openSession(browser);
    const p = s.page;
    const visitor = await openSession(browser, { user: null });
    try {
      await p.goto(`/links/edit?id=${link.id}`);
      await p.locator('.custom-preview-row').click();
      const save = dialog(p).getByRole('button', { name: 'Save changes' });
      const title = dialog(p).locator('textarea').first();
      const description = dialog(p).locator('textarea').nth(1);

      // Opening it and changing nothing leaves nothing to save.
      await expect(save).toBeDisabled();

      // Change only the title.
      await title.fill('My own title');
      await expect(save).toBeEnabled();
      await save.click();
      await p.locator('.save-bar').getByRole('button', { name: /Save/ }).click();
      await expect.poll(async () => (await stored(link.id)).og_title).toBe('My own title');
      const afterTitle = await stored(link.id);
      expect([blank(afterTitle.og_description), blank(afterTitle.og_image), afterTitle.custom_preview]).toEqual([true, true, 1]); // the other two were not frozen

      await visitor.page.goto(`/s/${link.alias}`);
      expect(await visitor.page.title()).toBe('My own title');
      expect(await visitor.page.locator('meta[property="og:description"]').getAttribute('content')).toBe('Posts I keep coming back to');
      expect(await visitor.page.locator('meta[property="og:image"]').getAttribute('content')).toBe('https://cdn.example.com/cover.png');

      // Reopen and change only the description: the title written earlier must survive.
      await p.locator('.custom-preview-row').click();
      await expect(title).toHaveValue('My own title');
      await expect(save).toBeDisabled();
      await description.fill('My own description');
      await save.click();
      await p.locator('.save-bar').getByRole('button', { name: /Save/ }).click();
      await expect.poll(async () => (await stored(link.id)).og_description).toBe('My own description');
      expect((await stored(link.id)).og_title).toBe('My own title');

      // "Use the destination title" puts that part back to following the destination.
      await p.locator('.custom-preview-row').click();
      await dialog(p).getByTitle('Use the destination title').click();
      await expect(title).not.toHaveValue('My own title');
      await save.click();
      await p.locator('.save-bar').getByRole('button', { name: /Save/ }).click();
      await expect.poll(async () => blank((await stored(link.id)).og_title)).toBe(true);
      expect((await stored(link.id)).og_description).toBe('My own description');
      await visitor.page.goto(`/s/${link.alias}`);
      expect(await visitor.page.title()).toBe('Blog Roll | Charles');
      expect(await visitor.page.locator('meta[property="og:description"]').getAttribute('content')).toBe('My own description');

      // "Reset to default" clears it all.
      await p.locator('.custom-preview-row').click();
      await dialog(p).getByRole('button', { name: 'Reset to default' }).click();
      await p.locator('.save-bar').getByRole('button', { name: /Save/ }).click();
      await expect.poll(async () => (await stored(link.id)).custom_preview).toBe(0);
      const reset = await stored(link.id);
      expect([blank(reset.og_title), blank(reset.og_description), blank(reset.og_image)]).toEqual([true, true, true]);
      await visitor.page.goto(`/s/${link.alias}`);
      expect(await visitor.page.locator('meta[property="og:description"]').getAttribute('content')).toBe('Posts I keep coming back to');
      // The editor asks the server to preview the destination; for this local test server the address guard refuses (400), by design.
      expect(s.errors.filter((e) => !/status of 400/.test(e))).toEqual([]);
    } finally {
      await s.context.close();
      await visitor.context.close();
    }
  });
});
