import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getSettings, publicSettings, saveSettings } from '../lib/settings';
import { readJsonObject } from '../lib/request';
import { activity } from '../lib/activity';

/** "invoice tax rate, SMTP password" from setting keys, for the activity feed. */
function describeKeys(keys: string[]): string {
  const words = keys.map((key) =>
    key
      .replace(/^inv_/, 'invoice ')
      .replace(/^utm_/, 'UTM ')
      .replace(/^smtp_/, 'SMTP ')
      .replace(/_/g, ' ')
  );
  return words.length > 6 ? `${words.slice(0, 6).join(', ')} and ${words.length - 6} more` : words.join(', ');
}

const settings = new Hono<AppEnv>();

settings.get('/', async (c) => c.json({ settings: publicSettings(await getSettings(c.env.DB)) }));

settings.patch('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const saved = await saveSettings(c.env.DB, body, (changed) =>
    changed.length ? [activity(c.env.DB, c.var.user, { action: 'updated', type: 'settings', label: 'Settings', detail: describeKeys(changed) })] : []
  );
  if (!saved.ok) return c.json({ error: saved.error }, 400);
  return c.json({ settings: publicSettings(saved.value.settings) });
});

export default settings;
