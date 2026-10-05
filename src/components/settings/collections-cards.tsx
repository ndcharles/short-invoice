'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CollectionItem, useCollections } from '@/lib/collections';
import { Plus, Trash } from '@/components/icons';
import { SettingsCard } from '@/components/settings/settings-ui';

const COLORS = ['green', 'blue', 'yellow'] as const;

function ColorPicks({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
      {COLORS.map((color) => (
        <button
          key={color}
          onClick={() => onChange(color)}
          title={color}
          aria-label={`Use ${color}`}
          style={{
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            border: value === color ? '2px solid var(--foreground)' : '2px solid transparent',
            background:
              color === 'green' ? 'var(--accent-green)' : color === 'blue' ? 'var(--accent-blue)' : 'var(--accent-yellow)',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </span>
  );
}

/** Shared folders / tags manager: add, rename, recolour, delete — saved immediately. */
function CollectionCard({
  kind,
  title,
  subtitle,
  addLabel,
  emptyHint,
}: {
  kind: 'folders' | 'tags';
  title: string;
  subtitle: string;
  addLabel: string;
  emptyHint: string;
}) {
  const { items, loading, create, update, remove } = useCollections(kind);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);

  const flash = (message: string) => {
    setStatus(message);
    setTimeout(() => setStatus(null), 2500);
  };

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      setNewName('');
      return;
    }
    try {
      setError(null);
      await create(name, kind === 'folders' ? 'green' : 'blue');
      setNewName('');
      setAdding(false);
      flash(`Added “${name}”`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add');
    }
  };

  const submitEdit = async (item: CollectionItem) => {
    const name = editName.trim();
    setEditingId(null);
    if (!name || name === item.name) return;
    try {
      setError(null);
      await update(item.id, { name });
      flash(`Renamed to “${name}”`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename');
    }
  };

  const handleDelete = async (item: CollectionItem) => {
    try {
      setError(null);
      const { detached } = await remove(item.id);
      flash(
        kind === 'folders'
          ? `Deleted “${item.name}”${detached ? ` · ${detached} link${detached === 1 ? '' : 's'} moved` : ''}`
          : `Deleted “${item.name}”${detached ? ` · removed from ${detached} link${detached === 1 ? '' : 's'}` : ''}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  return (
    <SettingsCard title={title} subtitle={subtitle}>
      <div className="setting-list">
        {items.map((item) => (
          <div
            className="setting-list-row"
            key={item.id}
            style={{ gridTemplateColumns: '28px minmax(0, 1fr) auto auto' }}
          >
            {kind === 'folders' ? (
              <span className={`fs-swatch ${item.color}`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </span>
            ) : (
              <span className={`tag ${item.color}`} style={{ width: '28px', justifyContent: 'center', padding: '2px 0' }}>
                {item.name.slice(0, 1).toUpperCase()}
              </span>
            )}

            <div style={{ minWidth: 0 }}>
              {editingId === item.id ? (
                <input
                  className="input"
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => submitEdit(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitEdit(item);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <div
                  className="primary"
                  role="button"
                  tabIndex={0}
                  title="Click to rename"
                  style={{ cursor: 'text' }}
                  onClick={() => {
                    setEditingId(item.id);
                    setEditName(item.name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setEditingId(item.id);
                      setEditName(item.name);
                    }
                  }}
                >
                  {item.name}
                </div>
              )}
              {kind === 'folders' && (
                <div className="secondary">{item.name === 'Links' ? 'Default folder' : 'Folder'}</div>
              )}
            </div>

            <ColorPicks value={item.color} onChange={(color) => update(item.id, { color })} />

            <div className="row-actions">
              <button
                className="icon-btn"
                onClick={() => handleDelete(item)}
                title={`Delete ${item.name}`}
                aria-label={`Delete ${item.name}`}
              >
                <Trash />
              </button>
            </div>
          </div>
        ))}

        {!loading && items.length === 0 && (
          <div className="setting-list-row" style={{ borderStyle: 'dashed', color: 'var(--muted-foreground)' }}>
            {emptyHint}
          </div>
        )}

        {adding ? (
          <div className="setting-list-row" style={{ gridTemplateColumns: '28px minmax(0, 1fr) auto' }}>
            <span className={kind === 'folders' ? 'fs-swatch green' : 'tag blue'} style={{ width: '28px' }}>
              {kind === 'tags' ? newName.slice(0, 1).toUpperCase() || 'T' : ''}
            </span>
            <input
              ref={addRef}
              className="input"
              placeholder={kind === 'folders' ? 'Folder name' : 'Tag name'}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={submitNew}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNew();
                if (e.key === 'Escape') {
                  setAdding(false);
                  setNewName('');
                }
              }}
            />
            <button className="btn btn-primary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={submitNew}>
              Add
            </button>
          </div>
        ) : (
          <div
            className="setting-list-row dashed"
            role="button"
            tabIndex={0}
            onClick={() => setAdding(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setAdding(true);
            }}
          >
            <Plus />
            <span style={{ marginLeft: '6px' }}>{addLabel}</span>
          </div>
        )}
      </div>

      {error && <div className="row-help" style={{ color: 'var(--destructive)' }}>{error}</div>}
      {status && !error && <div className="row-help">{status}</div>}
    </SettingsCard>
  );
}

export function FoldersCard() {
  return (
    <CollectionCard
      kind="folders"
      title="Folders"
      subtitle="Group links so your team can filter them. Saves immediately."
      addLabel="Add folder"
      emptyHint="No folders yet"
    />
  );
}

export function TagsCard() {
  return (
    <CollectionCard
      kind="tags"
      title="Tags"
      subtitle="Label links across folders. Saves immediately."
      addLabel="Add tag"
      emptyHint="No tags yet"
    />
  );
}
