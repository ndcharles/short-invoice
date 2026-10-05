import { UTM_KEYS, type UtmKey } from '../../src/lib/links/utm';
import { parseExpiresAt } from '../../src/lib/links/fields';
import {
  LIMITS,
  parseAlias,
  parseHostname,
  parseHttpUrl,
  parseMultiline,
  parseOptionalHttpUrl,
  parseText,
  type Result,
} from '../../src/lib/validate';

/** Validated, normalised link fields. Keys are present only when supplied. */
export interface LinkInput {
  domain?: string;
  alias?: string;
  dest?: string;
  tag?: string | null;
  folder?: string | null;
  comments?: string;
  cloak?: number;
  /** undefined = unchanged, null = remove, string = new password (plain text). */
  password?: string | null;
  expires_at?: number | null;
  expires_url?: string | null;
  utm?: Partial<Record<UtmKey, string | null>>;
  custom_preview?: number;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  archived?: number;
}

const has = (body: Record<string, unknown>, ...keys: string[]) => keys.some((k) => body[k] !== undefined);
const first = (body: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (body[k] !== undefined) return body[k];
  return undefined;
};
const flag = (value: unknown) => (value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0);

/**
 * Validates a create/update payload. Accepts the snake_case API names and the
 * camelCase names some UI forms send. Unknown keys are ignored.
 */
export function parseLinkInput(body: Record<string, unknown>): Result<LinkInput> {
  const out: LinkInput = {};
  const check = <T>(res: Result<T>, apply: (value: T) => void): string | null => {
    if (!res.ok) return res.error;
    apply(res.value);
    return null;
  };

  const errors = [
    has(body, 'domain') ? check(parseHostname(body.domain), (v) => (out.domain = v)) : null,
    has(body, 'alias') ? check(parseAlias(body.alias), (v) => (out.alias = v)) : null,
    has(body, 'dest') ? check(parseHttpUrl(body.dest, 'Destination URL'), (v) => (out.dest = v)) : null,
    has(body, 'tag') ? check(parseText(body.tag, 'Tag', LIMITS.name), (v) => (out.tag = v)) : null,
    has(body, 'folder') ? check(parseText(body.folder, 'Folder', LIMITS.name), (v) => (out.folder = v)) : null,
    has(body, 'comments')
      ? check(parseMultiline(body.comments, 'Comments', LIMITS.longText), (v) => (out.comments = v ?? ''))
      : null,
    has(body, 'password')
      ? check(parseText(body.password, 'Password', LIMITS.password), (v) => (out.password = v))
      : null,
    has(body, 'expires_url', 'expiresUrl')
      ? check(parseOptionalHttpUrl(first(body, 'expires_url', 'expiresUrl'), 'Expired-link URL'), (v) => (out.expires_url = v))
      : null,
    has(body, 'og_title', 'ogTitle')
      ? check(parseText(first(body, 'og_title', 'ogTitle'), 'Preview title', LIMITS.shortText), (v) => (out.og_title = v))
      : null,
    has(body, 'og_description', 'ogDescription')
      ? check(
          parseMultiline(first(body, 'og_description', 'ogDescription'), 'Preview description', 500),
          (v) => (out.og_description = v)
        )
      : null,
    has(body, 'og_image', 'ogImage')
      ? check(parseOptionalHttpUrl(first(body, 'og_image', 'ogImage'), 'Preview image URL'), (v) => (out.og_image = v))
      : null,
  ];

  if (has(body, 'expires_at', 'expiresAt')) {
    const raw = first(body, 'expires_at', 'expiresAt');
    const parsed = parseExpiresAt(raw);
    if (raw !== null && raw !== '' && parsed === null) errors.push('Expiration date is not a valid date');
    else out.expires_at = parsed;
  }

  for (const key of UTM_KEYS) {
    if (body[key] === undefined) continue;
    errors.push(check(parseText(body[key], key, LIMITS.shortText), (v) => ((out.utm ??= {})[key] = v)));
  }

  if (has(body, 'cloak')) out.cloak = flag(body.cloak);
  if (has(body, 'custom_preview', 'customPreview')) out.custom_preview = flag(first(body, 'custom_preview', 'customPreview'));
  if (has(body, 'archived')) out.archived = flag(body.archived);

  const error = errors.find((e): e is string => !!e);
  return error ? { ok: false, error } : { ok: true, value: out };
}
