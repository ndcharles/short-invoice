/**
 * UTM parameters are stored alongside the link rather than baked into `dest`,
 * so editing the destination later never strips or double-encodes them.
 * The effective destination is composed at redirect time.
 */

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_referral',
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

export type UtmParams = Partial<Record<UtmKey, string | null>>;

export function hasUtm(utm: UtmParams | null | undefined): boolean {
  if (!utm) return false;
  return UTM_KEYS.some((k) => !!utm[k]);
}

/** Append the non-empty UTM params to a destination URL. */
export function withUtm(dest: string, utm: UtmParams | null | undefined): string {
  if (!utm || !hasUtm(utm)) return dest;
  try {
    const url = new URL(dest);
    for (const key of UTM_KEYS) {
      const value = utm[key];
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return dest;
  }
}

/** Pick the UTM params off any object shaped like a link row. */
export function pickUtm<T extends Partial<Record<UtmKey, string | null>>>(source: T): UtmParams {
  const out: UtmParams = {};
  for (const key of UTM_KEYS) {
    out[key] = source[key] ?? null;
  }
  return out;
}
