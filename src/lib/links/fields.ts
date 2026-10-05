/** Shared normalisation for link fields, used by both POST and PATCH. */

export function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function asBooleanish(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function normalizeDest(dest: string): string {
  const trimmed = dest.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function normalizeAlias(alias: string): string {
  return alias.trim().replace(/^\/+/, '').replace(/\s+/g, '-');
}

/** Accepts epoch milliseconds, an ISO date string, or a `datetime-local` value. */
export function parseExpiresAt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  // Bare epoch seconds (10 digits) or milliseconds (13 digits).
  if (/^\d{13}$/.test(trimmed)) return Number(trimmed);
  if (/^\d{10}$/.test(trimmed)) return Number(trimmed) * 1000;

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}
