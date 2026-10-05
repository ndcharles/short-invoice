'use client';

import { useEffect, useMemo, useState } from 'react';
import { knownDomainNames, shortUrlContext, shortUrlFor, type ShortUrlContext } from '@/lib/short-url';

/**
 * Builds the short URL that really resolves for a link (custom domain when
 * verified, otherwise this app's /s/ path). Call once per page and pass the
 * result down, so cards do not each load settings.
 */
export function useShortUrls(settings: Record<string, string> | null) {
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    // Read after mount: the static export has no window at build time.
    queueMicrotask(() => setOrigin(window.location.origin));
  }, []);

  return useMemo(() => {
    const ctx: ShortUrlContext = shortUrlContext(settings, origin);
    return {
      ctx,
      domains: knownDomainNames(settings ?? { default_domain: '4th.link' }),
      urlFor: (link: { domain: string; alias: string }) => shortUrlFor(link, ctx),
    };
  }, [settings, origin]);
}
