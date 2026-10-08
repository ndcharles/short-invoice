import { esc, previewTags, type PagePreview } from './preview-tags';

/**
 * The page a link-preview crawler gets for a link that has a custom preview, instead of the redirect:
 * nothing but the tags it reads to draw the card, and a plain link. People never see it (they are
 * redirected, or shown the password page), and it deliberately does not redirect by itself: a crawler
 * that followed a meta refresh would go on to the destination and draw the destination's card instead.
 *
 * `target` is null for a password-protected link, which must not reveal where it goes.
 */
export function sharePage(alias: string, target: string | null, preview: PagePreview): string {
  const body = target ? `<p><a href="${esc(target)}">${esc(target)}</a></p>` : `<p>This link is password protected.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(preview.title.trim() || alias)}</title>
${previewTags(preview)}
</head>
<body>
  ${body}
</body>
</html>`;
}
