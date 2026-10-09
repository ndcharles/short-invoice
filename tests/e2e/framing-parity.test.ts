import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { chromeAvailable, launch } from './helpers';
import { framingAllowed } from '../../worker/lib/framing';

/**
 * "Can this page be cloaked?" is decided from a destination's headers (worker/lib/framing.ts). Whatever that
 * code believes, the browser is the judge, so every header combination here is also served to real Chrome
 * inside a frame on another origin, and the two have to agree. A frame Chrome refuses to show has no address
 * (it holds Chrome's own error page), while one it shows has the destination's.
 */
const run = chromeAvailable ? describe : describe.skip;

type Pairs = [string, string][];
/** [what the header set is, headers (`{PARENT}` is the embedding page's origin, `{PORT}` its port)]. */
const CASES: [string, Pairs][] = [
  ['no headers', []],
  ['X-Frame-Options: DENY', [['x-frame-options', 'DENY']]],
  ['X-Frame-Options: SAMEORIGIN', [['x-frame-options', 'SAMEORIGIN']]],
  ['X-Frame-Options: sameorigin (lower case)', [['x-frame-options', 'sameorigin']]],
  ['X-Frame-Options: ALLOW-FROM (ignored by browsers)', [['x-frame-options', 'ALLOW-FROM {PARENT}']]],
  ['X-Frame-Options: nonsense', [['x-frame-options', 'bogus']]],
  ['X-Frame-Options: DENY, SAMEORIGIN', [['x-frame-options', 'DENY, SAMEORIGIN']]],
  ['two X-Frame-Options headers that disagree', [['x-frame-options', 'SAMEORIGIN'], ['x-frame-options', 'DENY']]],
  ["frame-ancestors 'none'", [['content-security-policy', "frame-ancestors 'none'"]]],
  ["frame-ancestors 'self'", [['content-security-policy', "frame-ancestors 'self'"]]],
  ['frame-ancestors *', [['content-security-policy', 'frame-ancestors *']]],
  ['frame-ancestors with the exact origin', [['content-security-policy', 'frame-ancestors {PARENT}']]],
  ['frame-ancestors with the host and port, no scheme', [['content-security-policy', 'frame-ancestors localhost:{PORT}']]],
  ['frame-ancestors with the host and no port (usual port only)', [['content-security-policy', 'frame-ancestors localhost']]],
  ['frame-ancestors with any port', [['content-security-policy', 'frame-ancestors localhost:*']]],
  ['frame-ancestors with the scheme and any port', [['content-security-policy', 'frame-ancestors http://localhost:*']]],
  ['frame-ancestors with the wrong scheme', [['content-security-policy', 'frame-ancestors https://localhost:{PORT}']]],
  ['frame-ancestors http:', [['content-security-policy', 'frame-ancestors http:']]],
  ['frame-ancestors https:', [['content-security-policy', 'frame-ancestors https:']]],
  ['frame-ancestors with another site', [['content-security-policy', 'frame-ancestors https://example.org']]],
  ["frame-ancestors 'self' plus the embedder", [['content-security-policy', "frame-ancestors 'self' {PARENT}"]]],
  ["frame-ancestors 'none' plus the embedder", [['content-security-policy', "frame-ancestors 'none' {PARENT}"]]],
  ['frame-ancestors with only a source that has a path (invalid, so ignored)', [['content-security-policy', 'frame-ancestors {PARENT}/some/path']]],
  ['frame-ancestors with a wildcard subdomain, for a bare host', [['content-security-policy', 'frame-ancestors *.localhost:*']]],
  ['frame-ancestors with no sources', [['content-security-policy', 'frame-ancestors']]],
  ["frame-ancestors among other directives, in capitals", [['content-security-policy', "default-src 'self'; FRAME-ANCESTORS 'none'; img-src *"]]],
  ["frame-ancestors given twice in one policy (the first counts)", [['content-security-policy', "frame-ancestors 'none'; frame-ancestors *"]]],
  ['a policy with no frame-ancestors', [['content-security-policy', "default-src 'none'; img-src *"]]],
  ['a policy with no frame-ancestors, plus X-Frame-Options: SAMEORIGIN', [['content-security-policy', "default-src 'none'"], ['x-frame-options', 'SAMEORIGIN']]],
  ['frame-ancestors * wins over X-Frame-Options: DENY', [['content-security-policy', 'frame-ancestors *'], ['x-frame-options', 'DENY']]],
  ['frame-ancestors with the embedder wins over X-Frame-Options: SAMEORIGIN', [['content-security-policy', 'frame-ancestors {PARENT}'], ['x-frame-options', 'SAMEORIGIN']]],
  ["frame-ancestors 'none' with X-Frame-Options: SAMEORIGIN", [['content-security-policy', "frame-ancestors 'none'"], ['x-frame-options', 'SAMEORIGIN']]],
  ['two CSP headers, one of them forbidding', [['content-security-policy', 'frame-ancestors *'], ['content-security-policy', "frame-ancestors 'none'"]]],
  ['two policies in one header, one of them forbidding', [['content-security-policy', "frame-ancestors *, frame-ancestors 'none'"]]],
  ['a report-only policy forbidding (never blocks)', [['content-security-policy-report-only', "frame-ancestors 'none'"]]],
];

let browser: Browser;
let page: Page;
let destination: http.Server;
let embedder: http.Server;
let destOrigin = '';
let embedOrigin = '';
let embedPort = 0;

const fill = (value: string) => value.replaceAll('{PARENT}', embedOrigin).replaceAll('{PORT}', String(embedPort));

beforeAll(async () => {
  destination = http.createServer((req, res) => {
    const index = Number(/^\/case\/(\d+)/.exec(req.url ?? '')?.[1]);
    const grouped = new Map<string, string[]>();
    for (const [name, value] of CASES[index]?.[1] ?? []) grouped.set(name, [...(grouped.get(name) ?? []), fill(value)]);
    for (const [name, values] of grouped) res.setHeader(name, values.length === 1 ? values[0] : values); // an array is sent as repeated headers
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>destination</title><h1>destination</h1>');
  });
  await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve));
  destOrigin = `http://127.0.0.1:${(destination.address() as AddressInfo).port}`;

  // A different origin from the destination (localhost, not 127.0.0.1), so the destination is framed cross-site.
  embedder = http.createServer((req, res) => {
    const index = /^\/embed\/(\d+)/.exec(req.url ?? '')?.[1] ?? '0';
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><body><iframe src="${destOrigin}/case/${index}" style="width:400px;height:200px"></iframe>`);
  });
  await new Promise<void>((resolve) => embedder.listen(0, resolve)); // all interfaces: "localhost" may be ::1 or 127.0.0.1
  embedPort = (embedder.address() as AddressInfo).port;
  embedOrigin = `http://localhost:${embedPort}`;

  browser = await launch();
  page = await (await browser.newContext()).newPage();
});
afterAll(async () => {
  await browser?.close();
  destination?.close();
  embedder?.close();
});

/** Whether Chrome rendered the destination inside the frame. */
async function rendersInFrame(index: number): Promise<boolean> {
  await page.goto(`${embedOrigin}/embed/${index}`, { waitUntil: 'load' }); // the main page's load waits for the frame's
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) return false;
  // Shown for real: it has the destination's address and its content (not an error page that borrows the address).
  return frame.url().startsWith(destOrigin) && (await frame.locator('h1').count()) === 1;
}

run('The header check agrees with Chrome', () => {
  CASES.forEach(([name, pairs], index) => {
    it(name, async () => {
      const headers = new Headers();
      for (const [header, value] of pairs) headers.append(header, fill(value));
      const predicted = framingAllowed(headers, new URL(embedOrigin), new URL(`${destOrigin}/case/${index}`)).allowed;
      expect(await rendersInFrame(index), `Chrome ${predicted ? 'was expected to show' : 'was expected to refuse'} the page`).toBe(predicted);
    });
  });
});
