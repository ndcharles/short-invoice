'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface SettingsForm {
  draft: Record<string, string> | null;
  set: (key: string, value: string) => void;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  savedAt: number | null;
  save: () => Promise<void>;
  discard: () => void;
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

  return { draft, set, dirty, saving, error, savedAt, save, discard };
}
