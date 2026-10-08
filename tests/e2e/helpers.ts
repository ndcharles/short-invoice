import { existsSync } from 'node:fs';
import { inject } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import './matchers';
import { api, TEST_ADMIN } from '../api/helpers';

export { api, TEST_ADMIN };
export const baseUrl = () => inject('baseUrl');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const chromeAvailable = existsSync(CHROME);

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: CHROME, headless: true });
}

export interface Session {
  context: BrowserContext;
  page: Page;
  /** Errors the page logged or threw (a test fails if the app logs unexpected ones). */
  errors: string[];
  /** Browser-native alert/confirm/prompt dialogs the app opened (the app should use its own). */
  nativeDialogs: string[];
}

/** A signed-in browser tab. The test Worker accepts `x-dev-user` on localhost to act as someone. */
export async function openSession(
  browser: Browser,
  opts: { user?: string | null; width?: number; height?: number; ip?: string; timezoneId?: string; userAgent?: string } = {}
): Promise<Session> {
  const user = opts.user === undefined ? TEST_ADMIN : opts.user;
  const context = await browser.newContext({
    baseURL: baseUrl(),
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 900 },
    ...(opts.timezoneId ? { timezoneId: opts.timezoneId } : {}),
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    // Real sign-in is rate limited per client IP; production always has one, so give each browser its own.
    extraHTTPHeaders: user ? { 'x-dev-user': user } : { 'cf-connecting-ip': opts.ip ?? `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
    acceptDownloads: true,
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl() });
  const page = await context.newPage();
  const errors: string[] = [];
  // Leaving a page with unsaved edits asks "Leave site?"; tests simply leave.
  const nativeDialogs: string[] = [];
  page.on('dialog', (dialog) => {
    if (dialog.type() !== 'beforeunload') nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.accept().catch(() => undefined);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource.*(401|404|410)/.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  return { context, page, errors, nativeDialogs };
}

let counter = 0;
export const unique = (prefix = 'e2e') => `${prefix}-${Date.now().toString(36)}${(counter += 1)}`;

/** Creates a link through the API and returns it. */
export async function seedLink(over: Record<string, unknown> = {}) {
  const alias = unique('l');
  const res = await api('POST', '/api/links', { dest: 'https://example.com/' + alias, alias, ...over });
  if (res.status !== 201) throw new Error(`seedLink failed: ${JSON.stringify(res.body)}`);
  return res.body.link as { id: string; alias: string; domain: string; dest: string };
}

export async function seedUtm(over: Record<string, unknown> = {}) {
  const campaign = unique('c');
  const res = await api('POST', '/api/utms', { website: 'https://example.com/' + campaign, source: 'newsletter', medium: 'email', campaign, ...over });
  if (res.status !== 201) throw new Error(`seedUtm failed: ${JSON.stringify(res.body)}`);
  return res.body.campaign as { id: string; campaign: string };
}

export async function seedInvoice(over: Record<string, unknown> = {}) {
  const client = unique('Client');
  const res = await api('POST', '/api/invoices', {
    client_name: client,
    items: [{ name: 'Work', desc: '', qty: 1, unitPrice: 100000 }],
    ...over,
  });
  if (res.status !== 201) throw new Error(`seedInvoice failed: ${JSON.stringify(res.body)}`);
  return res.body.invoice as { id: string; number: string; client_name: string };
}


/** Adds a member through the API (as the admin) and returns their email and one-time setup code. */
export async function addMember(prefix = 'member') {
  const email = `${unique(prefix)}@example.org`;
  const res = await api('POST', '/api/team/invites', { email });
  if (res.status !== 201) throw new Error(`addMember failed: ${JSON.stringify(res.body)}`);
  return { email, code: res.body.code as string };
}

/** Walks a person through first sign-in in the browser; returns when they are in the app. */
export async function setUpAccount(page: Page, who: { email: string; code: string }, password = 'a long enough secret', name = 'New Person') {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(who.email);
  await page.keyboard.press('Enter');
  await page.getByLabel('Setup code').fill(who.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account and sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}
