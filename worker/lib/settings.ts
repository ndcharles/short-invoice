import { DEFAULT_SETTINGS, type SettingsMap } from './settings-defaults';
import {
  parseEmail,
  parseHexColor,
  parseHostname,
  parseImageSource,
  parseMultiline,
  parseNumber,
  parseOptionalHttpUrl,
  parseText,
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

/** Never sent to the browser; the UI only learns whether one is set. */
export const SECRET_KEYS = new Set(['smtp_password']);

/** Settings safe to return to the UI: secrets removed, `<key>_set` flags added. */
export function publicSettings(settings: SettingsMap): SettingsMap {
  const out: SettingsMap = {};
  for (const [key, value] of Object.entries(settings)) {
    if (SECRET_KEYS.has(key)) out[`${key}_set`] = value ? 'true' : 'false';
    else out[key] = value;
  }
  return out;
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
  inv_contact_email: (v) => asString(parseEmail(v, 'Invoice contact email')),
  inv_tax_rate: (v) => numberSetting(v, 'Tax rate', 0, 100),
  inv_usd_rate: (v) => numberSetting(v, 'USD exchange rate', 0, 1e9),
  inv_number_padding: (v) => numberSetting(v, 'Number padding', 1, 12, true),
  inv_next_number: (v) => numberSetting(v, 'Next invoice number', 1, 1e12, true),
  smtp_host: (v) => smtpHost(v),
  smtp_port: (v) => numberSetting(v, 'SMTP port', 1, 65535, true),
  smtp_security: (v) =>
    ['tls', 'starttls', 'none'].includes(v) ? { ok: true, value: v } : { ok: false, error: 'SMTP security must be tls, starttls or none' },
  smtp_username: (v) => asString(parseText(v, 'SMTP username', 254)),
  smtp_password: (v) => (v.length > 512 || /[\r\n]/.test(v) ? { ok: false, error: 'SMTP password is not valid' } : { ok: true, value: v }),
  smtp_from_name: (v) => asString(parseText(v, 'Sender name', 100)),
  smtp_from_email: (v) => asString(parseEmail(v, 'Sender email')),
  smtp_reply_to: (v) => asString(parseEmail(v, 'Reply-to email')),
};

function smtpHost(value: string): Result<string> {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === 'localhost') return { ok: true, value: trimmed };
  const host = parseHostname(trimmed);
  return host.ok ? host : { ok: false, error: 'SMTP host must look like smtp.example.com' };
}

/** Numeric settings are still stored as text, but must parse and stay in range. */
function numberSetting(value: string, label: string, min: number, max: number, integer = false): Result<string> {
  const trimmed = value.trim();
  const parsed = parseNumber(trimmed, label, { min, max });
  if (!parsed.ok) return parsed;
  if (integer && !Number.isInteger(parsed.value)) return { ok: false, error: `${label} must be a whole number` };
  return { ok: true, value: trimmed };
}

export function validateSetting(key: string, raw: unknown): Result<string> {
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
export async function saveSettings(
  db: D1Database,
  patch: Record<string, unknown>,
  extra: D1PreparedStatement[] | ((changed: string[]) => D1PreparedStatement[]) = []
): Promise<Result<{ settings: SettingsMap; changed: string[] }>> {
  const current = await getSettings(db);
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  const writes = [];
  const changed: string[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || MANAGED_KEYS.has(key)) continue;
    // A secret is only replaced when a new value is typed; `<key>_clear` removes it.
    if (SECRET_KEYS.has(key) && (raw === '' || raw === null || raw === undefined)) continue;
    const checked = validateSetting(key, raw);
    if (!checked.ok) return checked;
    if (current[key] === checked.value) continue;
    writes.push(stmt.bind(key, checked.value, now));
    current[key] = checked.value;
    changed.push(key);
  }
  for (const key of SECRET_KEYS) {
    if (patch[`${key}_clear`] === 'true' || patch[`${key}_clear`] === true) {
      writes.push(db.prepare('DELETE FROM settings WHERE key = ?1').bind(key));
      current[key] = '';
      changed.push(key);
    }
  }
  if (writes.length) await db.batch([...writes, ...(typeof extra === 'function' ? extra(changed) : extra)]);

  return { ok: true, value: { settings: current, changed } };
}
