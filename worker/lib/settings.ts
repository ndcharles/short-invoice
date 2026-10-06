import { DEFAULT_SETTINGS, type SettingsMap } from './settings-defaults';
import {
  parseEmail,
  parseHexColor,
  parseImageSource,
  parseMultiline,
  parseOptionalHttpUrl,
  type Result,
} from '../../src/lib/validate';

export { DEFAULT_SETTINGS, type SettingsMap };

/** Reads all settings, falling back to the defaults for anything unset. */
export async function getSettings(db: D1Database): Promise<SettingsMap> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const settings: SettingsMap = { ...DEFAULT_SETTINGS };
  for (const row of results) settings[row.key] = row.value;
  return settings;
}

/** Keys owned by dedicated endpoints (see routes/domains.ts); the generic PATCH ignores them. */
const MANAGED_KEYS = new Set(['shortener_domains', 'default_domain']);

const BOOLEAN_KEYS = new Set([
  'default_cloak',
  'utm_lowercase',
  'utm_strip_existing',
  'inv_tagline_on',
]);

const LIST_KEYS = new Set([
  'default_tags',
  'utm_presets',
  'inv_accounts',
  'inv_methods',
  'inv_enabled_currencies',
  'inv_currency_options',
]);

const asString = (res: Result<string | null>): Result<string> => (res.ok ? { ok: true, value: res.value ?? '' } : res);

/** Per-key validation; anything not listed is free text with a length cap. */
const VALIDATORS: Record<string, (value: string) => Result<string>> = {
  workspace_logo: (v) => asString(parseImageSource(v, 'Workspace logo')),
  inv_logo: (v) => asString(parseImageSource(v, 'Invoice logo')),
  root_redirect: (v) => asString(parseOptionalHttpUrl(v, 'Root redirect URL')),
  // Invoice settings keep their original free-form values; only fields that end
  // up in an <img src> or a CSS colour are restricted.
  inv_tagline_color: (v) => parseHexColor(v, 'Tagline colour'),
  profile_email: (v) => asString(parseEmail(v, 'Email')),
};

function validateSetting(key: string, raw: unknown): Result<string> {
  const value = raw === null || raw === undefined ? '' : String(raw);
  if (BOOLEAN_KEYS.has(key)) {
    return value === 'true' || value === 'false' ? { ok: true, value } : { ok: false, error: `${key} must be true or false` };
  }
  if (LIST_KEYS.has(key)) {
    if (value.length > 50_000) return { ok: false, error: `${key} is too large` };
    try {
      if (!Array.isArray(JSON.parse(value))) throw new Error();
    } catch {
      return { ok: false, error: `${key} must be a JSON list` };
    }
    return { ok: true, value };
  }
  const validator = VALIDATORS[key];
  if (validator) return validator(value);
  return asString(parseMultiline(value, key, 5000));
}

/**
 * Persists a patch in one batch, ignoring unknown and managed keys and
 * unchanged values. Any invalid value rejects the whole patch.
 */
export async function saveSettings(db: D1Database, patch: Record<string, unknown>): Promise<Result<SettingsMap>> {
  const current = await getSettings(db);
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  const writes = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || MANAGED_KEYS.has(key)) continue;
    const checked = validateSetting(key, raw);
    if (!checked.ok) return checked;
    if (current[key] === checked.value) continue;
    writes.push(stmt.bind(key, checked.value, now));
    current[key] = checked.value;
  }
  if (writes.length) await db.batch(writes);

  return { ok: true, value: current };
}
