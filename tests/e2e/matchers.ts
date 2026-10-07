import { expect } from 'vitest';
import type { Locator } from 'playwright-core';

/**
 * Playwright-style assertions for vitest: each one retries for a few seconds,
 * because the page is updating while we look at it. `.not` waits for the
 * opposite state, so "it went away" does not cost the full timeout.
 */
const TIMEOUT = 8000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle<T>(read: () => Promise<T>, holds: (value: T) => boolean, isNot: boolean) {
  const end = Date.now() + TIMEOUT;
  let value = await read().catch(() => undefined as unknown as T);
  const wantNot = !!isNot;
  while (holds(value) === wantNot && Date.now() < end) {
    await sleep(100);
    value = await read().catch(() => undefined as unknown as T);
  }
  return value;
}

expect.extend({
  async toBeVisible(this: { isNot: boolean }, loc: Locator) {
    const value = await settle(() => loc.first().isVisible(), (v) => !!v, this.isNot);
    return { pass: !!value, message: () => `expected locator ${this.isNot ? 'not ' : ''}to be visible` };
  },
  async toHaveCount(this: { isNot: boolean }, loc: Locator, expected: number) {
    const value = await settle(() => loc.count(), (v) => v === expected, this.isNot);
    return { pass: value === expected, message: () => `expected ${expected} element(s) but found ${value}`, actual: value, expected };
  },
  async toHaveValue(this: { isNot: boolean }, loc: Locator, expected: string | RegExp) {
    const test = (v: string) => (expected instanceof RegExp ? expected.test(v) : v === expected);
    const value = await settle(() => loc.first().inputValue(), test, this.isNot);
    return { pass: test(value), message: () => `expected value ${String(expected)} but got "${value}"`, actual: value, expected };
  },
  async toBeDisabled(this: { isNot: boolean }, loc: Locator) {
    const value = await settle(() => loc.first().isDisabled(), (v) => !!v, this.isNot);
    return { pass: !!value, message: () => `expected locator ${this.isNot ? 'not ' : ''}to be disabled` };
  },
  async toBeEnabled(this: { isNot: boolean }, loc: Locator) {
    const value = await settle(() => loc.first().isEnabled(), (v) => !!v, this.isNot);
    return { pass: !!value, message: () => `expected locator ${this.isNot ? 'not ' : ''}to be enabled` };
  },
  async toBeChecked(this: { isNot: boolean }, loc: Locator) {
    const value = await settle(() => loc.first().isChecked(), (v) => !!v, this.isNot);
    return { pass: !!value, message: () => `expected locator ${this.isNot ? 'not ' : ''}to be checked` };
  },
  async toContainText(this: { isNot: boolean }, loc: Locator, expected: string | RegExp) {
    const test = (v: string) => (expected instanceof RegExp ? expected.test(v) : (v ?? '').includes(expected));
    const value = await settle(() => loc.first().evaluate((el) => (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? String((el as HTMLInputElement).value) : (el as HTMLElement).innerText)), test, this.isNot);
    return { pass: test(value), message: () => `expected text to contain ${String(expected)} but got "${value}"`, actual: value, expected };
  },
});

interface LocatorMatchers<R = unknown> {
  toBeVisible(): Promise<R>;
  toHaveCount(count: number): Promise<R>;
  toHaveValue(value: string | RegExp): Promise<R>;
  toBeDisabled(): Promise<R>;
  toBeEnabled(): Promise<R>;
  toBeChecked(): Promise<R>;
  toContainText(text: string | RegExp): Promise<R>;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends LocatorMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends LocatorMatchers {}
}
