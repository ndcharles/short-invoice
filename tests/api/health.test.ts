import { describe, expect, it } from 'vitest';
import { api } from './helpers';

describe('worker', () => {
  it('answers the health check', async () => {
    const res = await api('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await api('GET', '/api/nope');
    expect(res.status).toBe(404);
  });
});
