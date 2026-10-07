import { createWorker } from './worker';

/** Browser tests: the built app served by its own Worker on a separate port. */
const worker = createWorker(Number(process.env.TEST_E2E_PORT ?? 8792), { real: true });
export const setup = worker.setup;
export const teardown = worker.teardown;
