'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { primeSettings } from '@/lib/collections';

export interface SettingsForm {
  draft: Record<string, string> | null;
  set: (key: string, value: string) => void;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  savedAt: number | null;
  save: () => Promise<void>;
  discard: () => void;
  adopt: (patch: Record<string, string>) => void;
}

/**
 * Loads settings into a baseline/draft pair and tracks dirty state, matching
 * the design's floating save bar (nothing saves until you press Save changes).
 */
export function useSettingsForm(): SettingsForm {
  const [baseline, setBaseline] = useState<Record<string, string> | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || 'Could not load settings');
        const loaded = (data.settings ?? {}) as Record<string, string>;
        primeSettings(loaded);
        setBaseline(loaded);
        setDraft(loaded);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load settings');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(
    () => !!baseline && !!draft && JSON.stringify(baseline) !== JSON.stringify(draft),
    [baseline, draft]
  );

  const set = useCallback((key: string, value: string) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      const saved = (data.settings ?? {}) as Record<string, string>;
      primeSettings(saved);
      setBaseline(saved);
      setDraft(saved);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const discard = useCallback(() => {
    setDraft(baseline);
    setError(null);
  }, [baseline]);

  /** Adopt values saved elsewhere (e.g. the domains API) without marking the form dirty. */
  const adopt = useCallback((patch: Record<string, string>) => {
    setBaseline((prev) => (prev ? { ...prev, ...patch } : prev));
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  return { draft, set, dirty, saving, error, savedAt, save, discard, adopt };
}
