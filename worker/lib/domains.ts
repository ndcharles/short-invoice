import { knownDomainNames, parseDomains } from '../../src/lib/short-url';
import { DEFAULT_SETTINGS } from './settings-defaults';
import type { SettingsMap } from './settings';

export { parseDomains };

export function knownDomains(settings: SettingsMap): string[] {
  return knownDomainNames(settings);
}

/**
 * Hosts that can only ever be the app itself, never a short domain. Checked
 * before touching D1 so that loading the app costs no database reads.
 */
export function isAppHost(host: string): boolean {
  return host.endsWith('.workers.dev') || host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** The settings the host router needs, in one small indexed read. */
export async function readShortDomainConfig(db: D1Database): Promise<{ domains: string[]; rootRedirect: string }> {
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN ('shortener_domains', 'default_domain', 'root_redirect')`)
    .all<{ key: string; value: string }>();
  const map: SettingsMap = {
    shortener_domains: DEFAULT_SETTINGS.shortener_domains,
    default_domain: DEFAULT_SETTINGS.default_domain,
    root_redirect: DEFAULT_SETTINGS.root_redirect,
  };
  for (const row of results) map[row.key] = row.value;
  return {
    domains: parseDomains(map.shortener_domains).map((d) => d.name),
    rootRedirect: map.root_redirect,
  };
}
