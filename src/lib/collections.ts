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

// One settings fetch per page load, shared by every component (sidebar,
// forms, canvases). Saving settings primes the cache so all of them update.
let settingsCache: WorkspaceSettings | null = null;
let settingsRequest: Promise<WorkspaceSettings | null> | null = null;
const settingsListeners = new Set<(settings: WorkspaceSettings) => void>();

function loadSettings(): Promise<WorkspaceSettings | null> {
  settingsRequest ??= fetch('/api/settings')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data?.settings) primeSettings(data.settings);
      return settingsCache;
    })
    .catch(() => null)
    .finally(() => {
      settingsRequest = null;
    });
  return settingsRequest;
}

/** Replace the cached settings (after a save) and notify every useSettings(). */
export function primeSettings(settings: WorkspaceSettings) {
  settingsCache = settings;
  for (const listener of settingsListeners) listener(settings);
}

/** Workspace settings, or null while loading. */
export function useSettings() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(settingsCache);

  useEffect(() => {
    settingsListeners.add(setSettings);
    if (!settingsCache) void loadSettings();
    return () => {
      settingsListeners.delete(setSettings);
    };
  }, []);

  return settings;
}
