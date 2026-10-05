'use client';

import { useCallback, useEffect, useState } from 'react';

export interface CollectionItem {
  id: string;
  name: string;
  color: string;
  created_at?: number;
}

export type CollectionKind = 'folders' | 'tags';

export const COLOR_CLASSES: Record<string, string> = {
  green: 'green',
  blue: 'blue',
  yellow: 'yellow',
};

/** Folder swatch / tag colours, matching the `.tag` and `.fs-swatch` palettes. */
export function collectionColor(color: string): string {
  return COLOR_CLASSES[color] ?? 'green';
}

/**
 * Loads folders or tags and exposes create/update/remove helpers.
 * Mutations reload the list so every surface stays in sync.
 */
export function useCollections(kind: CollectionKind) {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/collections?kind=${kind}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || 'Failed to load');
        setItems(data.items ?? []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const create = useCallback(
    async (name: string, color: string) => {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name, color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      reload();
      return data.item as CollectionItem;
    },
    [kind, reload]
  );

  const update = useCallback(
    async (id: string, patch: { name?: string; color?: string }) => {
      const res = await fetch(`/api/collections/${id}?kind=${kind}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      reload();
      return data.item as CollectionItem;
    },
    [kind, reload]
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/collections/${id}?kind=${kind}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      reload();
      return data as { detached: number };
    },
    [kind, reload]
  );

  return { items, loading, error, reload, create, update, remove };
}

export interface WorkspaceSettings {
  [key: string]: string;
}

/** Reads workspace settings; used for defaults and the sidebar label. */
export function useSettings() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setSettings(data.settings ?? {});
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}
