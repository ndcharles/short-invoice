import type { Context } from 'hono';

/**
 * Parses the request body as a JSON object; null for invalid JSON, arrays,
 * primitives or a body over `maxBytes` (also when no Content-Length was sent).
 */
export async function readJsonObject(c: Context, maxBytes = 1_000_000): Promise<Record<string, unknown> | null> {
  try {
    const text = await c.req.text();
    if (text.length > maxBytes) return null;
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
