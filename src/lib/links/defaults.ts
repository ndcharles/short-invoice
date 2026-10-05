/** Options for Settings → URL Shortener → Default expiration. */
export const EXPIRATION_OPTIONS = ['Never expire', '7 days', '30 days', '90 days', '1 year'] as const;

const DAYS: Record<string, number> = { '7 days': 7, '30 days': 30, '90 days': 90, '1 year': 365 };

/** Expiry timestamp for a new link created at `now`, or null for "Never expire". */
export function expirationFromSetting(setting: string | undefined, now: number): number | null {
  const days = setting ? DAYS[setting] : undefined;
  return days ? now + days * 86_400_000 : null;
}
