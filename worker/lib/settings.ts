import { DEFAULT_SETTINGS, type SettingsMap } from './settings-defaults';

export { DEFAULT_SETTINGS, type SettingsMap };

/** Reads all settings, falling back to the defaults for anything unset. */
export async function getSettings(db: D1Database): Promise<SettingsMap> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const settings: SettingsMap = { ...DEFAULT_SETTINGS };
  for (const row of results) settings[row.key] = row.value;
  return settings;
}

/** Persists a patch in one batch, ignoring unknown keys and unchanged values. */
export async function saveSettings(db: D1Database, patch: Record<string, unknown>): Promise<SettingsMap> {
  const current = await getSettings(db);
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  const writes = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    const value = raw === null || raw === undefined ? '' : String(raw);
    if (current[key] === value) continue;
    writes.push(stmt.bind(key, value, now));
    current[key] = value;
  }
  if (writes.length) await db.batch(writes);

  return current;
}
