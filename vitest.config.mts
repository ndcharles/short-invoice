import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Two kinds of tests:
 *  - tests/unit: pure functions shared by the UI and the Worker, run in Node.
 *  - tests/api:  black-box HTTP tests against `wrangler dev` with a fresh,
 *                migrated local D1 (started once in tests/setup/worker.ts).
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          globalSetup: ['tests/setup/worker.ts'],
          // Every file shares one Worker and database, so run files one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
