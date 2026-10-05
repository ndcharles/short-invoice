import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getSettings } from '../lib/settings';
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

/** GET /api/collections?kind=folders|tags */
collections.get('/', async (c) => {
  const kind = parseKind(c.req.query('kind') ?? '');
  if (!kind) return c.json({ error: 'kind must be folders or tags' }, 400);
  return c.json({ items: await listCollection(c.env.DB, kind) });
});

/** POST /api/collections — body: { kind, name, color } */
collections.post('/', async (c) => {
  const body = await c.req.json();
  const kind = parseKind(body.kind ?? '');
  if (!kind) return c.json({ error: 'kind must be folders or tags' }, 400);

  const name = normalizeName(body.name);
  if (!name) return c.json({ error: 'A name is required' }, 400);
  if (await findByName(c.env.DB, kind, name)) {
    return c.json({ error: `"${name}" already exists` }, 409);
  }

  const fallbackColor = kind === 'folders' ? 'green' : 'blue';
  const item = await createCollection(c.env.DB, kind, name, normalizeColor(body.color, fallbackColor));
  return c.json({ item }, 201);
});

collections.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const kind = parseKind(body.kind ?? c.req.query('kind') ?? '');
  if (!kind) return c.json({ error: 'kind must be folders or tags' }, 400);

  const existing = await getCollectionItem(c.env.DB, kind, id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const name = body.name === undefined ? undefined : normalizeName(body.name);
  if (body.name !== undefined && !name) return c.json({ error: 'A name is required' }, 400);
  if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await findByName(c.env.DB, kind, name);
    if (clash && clash.id !== id) return c.json({ error: `"${name}" already exists` }, 409);
  }

  const color = body.color === undefined ? undefined : normalizeColor(body.color, existing.color);
  const item = await updateCollection(c.env.DB, kind, existing, { name: name ?? undefined, color });
  return c.json({ item });
});

collections.delete('/:id', async (c) => {
  const kind = parseKind(c.req.query('kind') ?? '');
  if (!kind) return c.json({ error: 'kind must be folders or tags' }, 400);

  const existing = await getCollectionItem(c.env.DB, kind, c.req.param('id'));
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // The default folder is the fallback target, so it cannot be removed.
  const settings = await getSettings(c.env.DB);
  if (kind === 'folders' && existing.name === settings.default_folder) {
    return c.json({ error: `"${existing.name}" is the default folder. Change the default first.` }, 409);
  }

  const { detached } = await deleteCollection(c.env.DB, kind, existing, settings.default_folder);
  return c.json({ success: true, detached });
});

export default collections;
