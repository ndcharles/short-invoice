import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getSettings, saveSettings } from '../lib/settings';

const settings = new Hono<AppEnv>();

settings.get('/', async (c) => c.json({ settings: await getSettings(c.env.DB) }));

settings.patch('/', async (c) => {
  const body = await c.req.json();
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid payload' }, 400);
  return c.json({ settings: await saveSettings(c.env.DB, body as Record<string, unknown>) });
});

export default settings;
