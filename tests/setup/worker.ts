import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
    persistDir: string;
  }
}

const ROOT = path.resolve(__dirname, '../..');
const WRANGLER = path.join(ROOT, 'node_modules/.bin/wrangler');
const PORT = Number(process.env.TEST_WORKER_PORT ?? 8791);

/**
 * Boots the real Worker with `wrangler dev` on a fresh, migrated local D1, so
 * tests exercise the same code and SQL that runs in production. Each test
 * project (API, browser) gets its own Worker, port and database.
 *
 * `real` serves the built app from `out/` (browser tests); otherwise a stub is
 * enough because API tests never load pages.
 */
export function createWorker(port: number, opts: { real?: boolean } = {}) {
  const PORT = port;
  let child: ChildProcess | null = null;
  let persistDir = '';
  let createdOut = false;

  async function setup(project: TestProject) {
  persistDir = mkdtempSync(path.join(tmpdir(), 'short-invoice-test-'));
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };

  // Static assets are optional for API tests, but wrangler needs the directory.
  const outDir = path.join(ROOT, 'out');
  // Browser tests need the app as it is now, so always rebuild it first.
  if (opts.real) execFileSync('npx', ['next', 'build'], { cwd: ROOT, env, stdio: 'pipe' });
  if (!existsSync(outDir)) {
    mkdirSync(outDir);
    writeFileSync(path.join(outDir, '404.html'), '<h1>404</h1>');
    writeFileSync(path.join(outDir, 'index.html'), '<h1>app</h1>');
    createdOut = true;
  }

  execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'short-invoice', '--local', '--persist-to', persistDir], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
  });

  child = spawn(
    WRANGLER,
    [
      'dev',
      '--port', String(PORT),
      '--ip', '127.0.0.1',
      '--persist-to', persistDir,
      '--var', 'LINK_COOKIE_SECRET:test-secret',
      '--var', `DOMAIN_CHECK_ORIGIN:http://127.0.0.1:${PORT}`,
      // Tests act as different people with the localhost-only `x-dev-user` header.
      '--var', 'ADMIN_EMAILS:boss@test.example',
      '--var', 'DEV_AUTH_BYPASS:1',
      '--var', 'AUTH_PEPPER:test-pepper',
      // Cloaked links would fetch real websites in the background; tests set up their previews directly.
      '--var', 'DEST_PREVIEW_FETCH:off',
      '--show-interactive-dev-session=false',
    ],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }
  );
  let log = '';
  child.stdout?.on('data', (chunk) => (log += chunk));
  child.stderr?.on('data', (chunk) => (log += chunk));

  const baseUrl = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline || child.exitCode !== null) {
      throw new Error(`wrangler dev did not start:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  project.provide('baseUrl', baseUrl);
  project.provide('persistDir', persistDir);
  }

  async function teardown() {
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    if (persistDir) rmSync(persistDir, { recursive: true, force: true });
    if (createdOut) rmSync(path.join(ROOT, 'out'), { recursive: true, force: true });
  }

  return { setup, teardown };
}

const api = createWorker(PORT);
export const setup = api.setup;
export const teardown = api.teardown;
