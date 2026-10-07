import { inject } from 'vitest';

export const baseUrl = () => inject('baseUrl');

/** In ADMIN_EMAILS for the test Worker (tests/setup/worker.ts). */
export const TEST_ADMIN = 'boss@test.example';

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  body: T;
}

/** JSON request against the test Worker. Never follows redirects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test assertions read arbitrary JSON
export async function api<T = Record<string, any>>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<ApiResponse<T>> {
  // Write endpoints require a JSON body (CSRF guard), so actions send {}.
  if (body === undefined && (method === 'POST' || method === 'PATCH')) body = {};
  // Acts as the test admin unless a test names someone else (or sends '' to be signed out).
  const who = { 'x-dev-user': TEST_ADMIN, ...headers };
  if (!who['x-dev-user']) delete (who as Record<string, string>)['x-dev-user'];
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    redirect: 'manual',
    headers: body === undefined ? who : { 'content-type': 'application/json', ...who },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, body: parsed as T };
}

/** Raw request (HTML pages, redirects, form posts). */
export function raw(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl()}${path}`, { redirect: 'manual', ...init });
}

let counter = 0;
/** Unique alias per call so tests never collide on the shared database. */
export function uniqueAlias(prefix = 't') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
