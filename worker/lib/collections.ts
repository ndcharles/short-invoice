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

/** Which table/column pairs reference each kind. */
const USES: Record<CollectionKind, [string, string][]> = {
  folders: [
    ['links', 'folder'],
    ['utms', 'folder'],
  ],
  tags: [['links', 'tag']],
};

/** Fallback folder per module when a folder is deleted. */
const MODULE_FOLDER: Record<string, string> = { utms: 'Campaigns' };

export const COLLECTION_COLORS = ['green', 'blue', 'yellow'] as const;

export function parseKind(value: string): CollectionKind | null {
  return value === 'folders' || value === 'tags' ? value : null;
}

export function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) return null;
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

/**
 * Members pick folders and tags from the lists admins maintain; typing a new
 * name into a link, UTM or invoice must not create one by the back door.
 * Returns the message to send back, or null when every pick is allowed. Admins
 * are not checked, and a value the record already carries is always accepted
 * (so editing something older never fails).
 */
export async function unknownPick(
  db: D1Database,
  user: { role: string },
  picks: { kind: CollectionKind; value: string | null | undefined; current?: string | null }[]
): Promise<string | null> {
  if (user.role === 'admin') return null;
  for (const { kind, value, current } of picks) {
    const name = value?.trim();
    if (!name || (current && current.toLowerCase() === name.toLowerCase())) continue;
    if (!(await findByName(db, kind, name))) {
      return `${kind === 'folders' ? 'Folder' : 'Tag'} "${name}" does not exist. Ask an admin to add it first.`;
    }
  }
  return null;
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

  // Keep every record pointing at the renamed item. Column and table names
  // come from the fixed USES map, never from input.
  if (name !== existing.name) {
    for (const [table, column] of USES[kind]) {
      stmts.push(db.prepare(`UPDATE ${table} SET ${column} = ?1, updated_at = ?2 WHERE ${column} = ?3`).bind(name, now, existing.name));
    }
  }

  await db.batch(stmts);
  return { ...existing, name, color };
}

/** Deletes the item and detaches it from every record that used it. */
export async function deleteCollection(
  db: D1Database,
  kind: CollectionKind,
  existing: CollectionItem,
  fallbackFolder: string
): Promise<{ detached: number }> {
  const now = Date.now();
  // Never leave a record pointing at a folder or tag that no longer exists:
  // folders fall back to each module's own default, tags are cleared.
  const detach = USES[kind].map(([table, column]) =>
    kind === 'folders'
      ? db
          .prepare(`UPDATE ${table} SET ${column} = ?1, updated_at = ?2 WHERE ${column} = ?3`)
          .bind(table === 'links' ? fallbackFolder : MODULE_FOLDER[table], now, existing.name)
      : db.prepare(`UPDATE ${table} SET ${column} = NULL, updated_at = ?1 WHERE ${column} = ?2`).bind(now, existing.name)
  );

  const results = await db.batch([...detach, db.prepare(`DELETE FROM ${TABLE[kind]} WHERE id = ?1`).bind(existing.id)]);
  const detached = results.slice(0, -1).reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
  return { detached };
}
