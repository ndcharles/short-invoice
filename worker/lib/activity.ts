import { nanoid } from 'nanoid';
import type { CurrentUser } from './auth';

export type EntityType = 'link' | 'utm' | 'invoice' | 'settings' | 'team' | 'folder' | 'tag' | 'domain';

export interface ActivityEntry {
  action: string;
  type: EntityType;
  id?: string;
  label?: string;
  detail?: string;
}

/** One activity row, returned as a statement so it joins the change's own batch. */
export function activity(db: D1Database, user: CurrentUser, entry: ActivityEntry, at = Date.now()): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activity (id, at, actor, action, entity_type, entity_id, label, detail)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(`act_${nanoid(12)}`, at, user.email, entry.action, entry.type, entry.id ?? '', (entry.label ?? '').slice(0, 200), (entry.detail ?? '').slice(0, 500));
}

/** "destination, tag and folder" from the fields whose values changed. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): string {
  const changed = Object.entries(labels)
    .filter(([key]) => after[key] !== undefined && JSON.stringify(after[key] ?? null) !== JSON.stringify(before[key] ?? null))
    .map(([, label]) => label);
  if (changed.length <= 1) return changed.join('');
  return `${changed.slice(0, -1).join(', ')} and ${changed[changed.length - 1]}`;
}
