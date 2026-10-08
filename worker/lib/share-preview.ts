import { resolveOg } from '../../src/lib/og';
import type { RemoteOg } from '../../src/lib/og';
import type { PagePreview } from './preview-tags';

/** The preview-related columns of a link. */
export interface PreviewColumns {
  dest: string;
  custom_preview: number;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
}

const filled = (value: string | null | undefined) => !!value?.trim();

/** Whether the owner wrote their own preview: switched on, and at least one of the three parts filled in. */
export function hasCustomPreview(link: PreviewColumns): boolean {
  return !!link.custom_preview && (filled(link.og_title) || filled(link.og_description) || filled(link.og_image));
}

/** Whether every part is the owner's own, so nothing needs to come from the destination. */
export function coversEverything(link: PreviewColumns): boolean {
  return !!link.custom_preview && filled(link.og_title) && filled(link.og_description) && filled(link.og_image);
}

/**
 * The preview for a link: the owner's wording for each part they wrote (while the custom preview is on), and
 * what the destination says about itself for the rest, or a plain fallback worked out from the address.
 */
export function previewFor(link: PreviewColumns, alias: string, remote: RemoteOg | null, url: string): PagePreview {
  const og = resolveOg({
    dest: link.dest,
    alias,
    custom_preview: link.custom_preview,
    og_title: link.og_title,
    og_description: link.og_description,
    og_image: link.og_image,
    remote,
  });
  return { title: og.title, description: og.description, image: og.image, site: og.site ?? null, url };
}

/**
 * The preview for a password-protected link. Only what the owner wrote, and plain words for the rest:
 * nothing about the destination, not even the address, may show before the password is entered.
 */
export function gatedPreview(link: PreviewColumns, url: string): PagePreview {
  return {
    title: link.og_title?.trim() || 'Password protected link',
    description: link.og_description?.trim() || 'Enter the password to open this link.',
    image: link.og_image?.trim() || null,
    site: null,
    url,
  };
}
