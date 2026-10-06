import type { Context } from 'hono';

/** Parses the request body as a JSON object; null for invalid JSON, arrays or primitives. */
export async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
