import { nanoid } from 'nanoid';

/** Folders and tags are structurally identical, so they share one store. */
export type CollectionKind = 'folders' | 'tags';

export interface CollectionItem {
  id: string;
  name: string;
  color: string;
  created_at: number;
}

// Table names come from this fixed map, never from request input.
const TABLE: Record<CollectionKind, 'folders' | 'tags'> = { folders: 'folders', tags: 'tags' };
const PREFIX: Record<CollectionKind, string> = { folders: 'fld', tags: 'tag' };

export const COLLECTION_COLORS = ['green', 'blue', 'yellow'] as const;

export function parseKind(value: string): CollectionKind | null {
  return value === 'folders' || value === 'tags' ? value : null;
}

export function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name) return null;
  return name.slice(0, 40);
}

export function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && (COLLECTION_COLORS as readonly string[]).includes(value) ? value : fallback;
}

export async function listCollection(db: D1Database, kind: CollectionKind): Promise<CollectionItem[]> {
  const { results } = await db.prepare(`SELECT * FROM ${TABLE[kind]} ORDER BY created_at ASC`).all<CollectionItem>();
  return results;
}

export function getCollectionItem(db: D1Database, kind: CollectionKind, id: string) {
  return db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ?1`).bind(id).first<CollectionItem>();
}

export function findByName(db: D1Database, kind: CollectionKind, name: string) {
  return db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE name = ?1 COLLATE NOCASE`).bind(name).first<CollectionItem>();
}

export async function createCollection(
  db: D1Database,
  kind: CollectionKind,
  name: string,
  color: string
): Promise<CollectionItem> {
  const item = { id: `${PREFIX[kind]}_${nanoid(10)}`, name, color, created_at: Date.now() };
  await db
    .prepare(`INSERT INTO ${TABLE[kind]} (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(item.id, item.name, item.color, item.created_at)
    .run();
  return item;
}

export async function updateCollection(
  db: D1Database,
  kind: CollectionKind,
  existing: CollectionItem,
  patch: { name?: string; color?: string }
): Promise<CollectionItem> {
  const name = patch.name ?? existing.name;
  const color = patch.color ?? existing.color;
  const now = Date.now();
  const stmts = [db.prepare(`UPDATE ${TABLE[kind]} SET name = ?1, color = ?2 WHERE id = ?3`).bind(name, color, existing.id)];

  // Keep links pointing at the renamed item.
  if (name !== existing.name) {
    const column = kind === 'folders' ? 'folder' : 'tag';
    stmts.push(db.prepare(`UPDATE links SET ${column} = ?1, updated_at = ?2 WHERE ${column} = ?3`).bind(name, now, existing.name));
  }

  await db.batch(stmts);
  return { ...existing, name, color };
}

/** Deletes the item and detaches it from any links that used it. */
export async function deleteCollection(
  db: D1Database,
  kind: CollectionKind,
  existing: CollectionItem,
  fallbackFolder: string
): Promise<{ detached: number }> {
  const now = Date.now();
  // Never leave links pointing at a folder that no longer exists.
  const detach =
    kind === 'folders'
      ? db.prepare('UPDATE links SET folder = ?1, updated_at = ?2 WHERE folder = ?3').bind(fallbackFolder, now, existing.name)
      : db.prepare('UPDATE links SET tag = NULL, updated_at = ?1 WHERE tag = ?2').bind(now, existing.name);

  const [detached] = await db.batch([detach, db.prepare(`DELETE FROM ${TABLE[kind]} WHERE id = ?1`).bind(existing.id)]);
  return { detached: detached.meta.changes ?? 0 };
}
