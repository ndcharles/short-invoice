import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getSettings, publicSettings, saveSettings } from '../lib/settings';
import { readJsonObject } from '../lib/request';

const settings = new Hono<AppEnv>();

settings.get('/', async (c) => c.json({ settings: publicSettings(await getSettings(c.env.DB)) }));

settings.patch('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const saved = await saveSettings(c.env.DB, body);
  if (!saved.ok) return c.json({ error: saved.error }, 400);
  return c.json({ settings: publicSettings(saved.value) });
});

export default settings;
