'use client';

import { useEffect, useState } from 'react';
import { fetchOg, RemoteOg } from '@/lib/og';

/**
 * Debounced Open Graph lookup for a destination URL. Results are keyed by URL
 * so a stale response for a previous destination is never shown.
 */
export function useOgMetadata(dest: string) {
  const [entry, setEntry] = useState<{ key: string; data: RemoteOg | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const key = dest.trim();

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      const data = await fetchOg(key);
      if (cancelled) return;
      setEntry({ key, data });
      setLoading(false);
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  return {
    remote: entry && entry.key === key ? entry.data : null,
    loading: loading && entry?.key !== key,
  };
}
