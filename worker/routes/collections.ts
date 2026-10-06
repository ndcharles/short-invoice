import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getSettings } from '../lib/settings';
import { activity } from '../lib/activity';
import { readJsonObject } from '../lib/request';
import {
  createCollection,
  deleteCollection,
  findByName,
  getCollectionItem,
  listCollection,
  normalizeColor,
  normalizeName,
  parseKind,
  updateCollection,
} from '../lib/collections';

const collections = new Hono<AppEnv>();

/** Each module's fallback folder; renaming or deleting one would strand new records. */
const BUILT_IN_FOLDERS = new Set(['links', 'campaigns', 'invoices']);
const isBuiltIn = (kind: string, name: string) => kind === 'folders' && BUILT_IN_FOLDERS.has(name.toLowerCase());

/** GET /api/collections?kind=folders|tags */
collections.get('/', async (c) => {
  const kind = parseKind(c.req.query('kind') ?? '');
  if (!kind) return c.json({ error: 'kind must be folders or tags' }, 400);
  return c.json({ items: await listCollection(c.env.DB, kind) });
});

/** POST /api/collections — body: { kind, name, color } */
collections.post('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const kind = parseKind(String(body.kind ?? ''));
  if (!kind) return c.json({ error: 'kind must be folders or tags' }, 400);

  const name = normalizeName(body.name);
  if (!name) return c.json({ error: 'A name is required' }, 400);
  if (await findByName(c.env.DB, kind, name)) {
    return c.json({ error: `"${name}" already exists` }, 409);
  }

  const fallbackColor = kind === 'folders' ? 'green' : 'blue';
  const item = await createCollection(c.env.DB, kind, name, normalizeColor(body.color, fallbackColor));
  await activity(c.env.DB, c.var.user, { action: 'created', type: kind === 'folders' ? 'folder' : 'tag', id: item?.id ?? '', label: name }).run();
  return c.json({ item }, 201);
});

collections.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const kind = parseKind(String(body.kind ?? c.req.query('kind') ?? ''));
  if (!kind) return c.json({ error: 'kind must be folders or tags' }, 400);

  const existing = await getCollectionItem(c.env.DB, kind, id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const name = body.name === undefined ? undefined : normalizeName(body.name);
  if (body.name !== undefined && !name) return c.json({ error: 'A name is required' }, 400);
  if (name && name !== existing.name && isBuiltIn(kind, existing.name)) {
    return c.json({ error: `"${existing.name}" is a built-in folder and cannot be renamed.` }, 409);
  }
  if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await findByName(c.env.DB, kind, name);
    if (clash && clash.id !== id) return c.json({ error: `"${name}" already exists` }, 409);
  }

  const color = body.color === undefined ? undefined : normalizeColor(body.color, existing.color);
  const item = await updateCollection(c.env.DB, kind, existing, { name: name ?? undefined, color });
  const renamed = name && name !== existing.name;
  await activity(c.env.DB, c.var.user, {
    action: renamed ? 'renamed' : 'updated',
    type: kind === 'folders' ? 'folder' : 'tag',
    id,
    label: name ?? existing.name,
    detail: renamed ? `was ${existing.name}` : 'colour',
  }).run();
  return c.json({ item });
});

collections.delete('/:id', async (c) => {
  const kind = parseKind(c.req.query('kind') ?? '');
  if (!kind) return c.json({ error: 'kind must be folders or tags' }, 400);

  const existing = await getCollectionItem(c.env.DB, kind, c.req.param('id'));
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // The default folder is the fallback target, so it cannot be removed.
  if (isBuiltIn(kind, existing.name)) {
    return c.json({ error: `"${existing.name}" is a built-in folder and cannot be deleted.` }, 409);
  }
  const settings = await getSettings(c.env.DB);
  if (kind === 'folders' && existing.name === settings.default_folder) {
    return c.json({ error: `"${existing.name}" is the default folder. Change the default first.` }, 409);
  }

  const { detached } = await deleteCollection(c.env.DB, kind, existing, settings.default_folder);
  await activity(c.env.DB, c.var.user, { action: 'deleted', type: kind === 'folders' ? 'folder' : 'tag', id: existing.id, label: existing.name }).run();
  return c.json({ success: true, detached });
});

export default collections;
