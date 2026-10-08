/**
 * The "site default" link preview: the company's own title, description and image, offered in the
 * Link Preview popup so nobody has to upload or retype them. The image is public/site-default.png,
 * drawn by `npm run brand` from these same words, so the picture and the text always agree.
 */
export const SITE_DEFAULT = {
  title: '4th Entity Technologies',
  description: 'AI, Data And Technology Training, Consulting, & Solutions.',
  /** Where the image is served from, on the app's own address. */
  imagePath: '/site-default.png',
} as const;

/** The full address to store as a link's preview image (crawlers need an absolute one). */
export const siteDefaultImage = (origin: string) => `${origin.replace(/\/+$/, '')}${SITE_DEFAULT.imagePath}`;

/** Whether an image address is the site default one, on whichever address the app was reached at. */
export const isSiteDefaultImage = (image: string | null | undefined) => !!image && image.endsWith(SITE_DEFAULT.imagePath);
