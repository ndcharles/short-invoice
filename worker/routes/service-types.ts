import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import type { ServiceTypeRow } from '../../src/lib/clients';
import { readJsonObject } from '../lib/request';
import { activity, changedFields } from '../lib/activity';
import { parseServiceTypeInput } from '../lib/client-input';

/**
 * Service types (Settings → Clients): a name, a default price, reminder days and whether it shows in the Add list.
 * How a service works is picked on each service, not here. Everyone reads the list (the forms show it); only admins
 * change it (see worker/index.ts). Built-in types and types in use cannot be deleted: hide them instead.
 */
const serviceTypes = new Hono<AppEnv>();

const SELECT = `SELECT t.*, (SELECT COUNT(*) FROM client_services s WHERE s.type_id = t.id) AS used FROM service_types t`;
const one = (db: D1Database, id: string) => db.prepare(`${SELECT} WHERE t.id = ?1`).bind(id).first<ServiceTypeRow>();

serviceTypes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} ORDER BY t.sort, t.created_at`).all<ServiceTypeRow>();
  return c.json({ types: results });
});

serviceTypes.post('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseServiceTypeInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  if (!input.name) return c.json({ error: 'Give the service type a name' }, 400);
  const db = c.env.DB;
  if (await db.prepare('SELECT id FROM service_types WHERE name = ?1 COLLATE NOCASE').bind(input.name).first()) {
    return c.json({ error: `There is already a service type called ${input.name}` }, 409);
  }
  const now = Date.now();
  const id = `st_${nanoid(10)}`;
  // New types sit before "Something else", which stays last.
  const sort = ((await db.prepare("SELECT MAX(sort) AS m FROM service_types WHERE part IS NULL OR part != 'other'").first<{ m: number }>())?.m ?? 0) + 10;
  await db.batch([
    db
      .prepare(
        `INSERT INTO service_types (id, name, part, price, price_unit, reminder_days, show_in_add, sort, created_at, updated_at, created_by, updated_by)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?9)`
      )
      .bind(id, input.name, input.price ?? 0, input.price_unit ?? 'once', input.reminder_days ?? '', input.show_in_add === false ? 0 : 1, sort, now, c.var.user.email),
    activity(db, c.var.user, { action: 'created', type: 'service_type', id, label: input.name }, now),
  ]);
  return c.json({ type: await one(db, id) }, 201);
});

const TYPE_FIELDS: Record<string, string> = {
  name: 'name',
  price: 'default price',
  price_unit: 'price unit',
  reminder_days: 'reminder days',
  show_in_add: 'Add list',
};

serviceTypes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseServiceTypeInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  const db = c.env.DB;
  const existing = await one(db, id);
  if (!existing) return c.json({ error: 'Service type not found' }, 404);
  if (input.name !== undefined && !input.name) return c.json({ error: 'Give the service type a name' }, 400);
  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    if (await db.prepare('SELECT id FROM service_types WHERE name = ?1 COLLATE NOCASE AND id != ?2').bind(input.name, id).first()) {
      return c.json({ error: `There is already a service type called ${input.name}` }, 409);
    }
  }
  const next = {
    name: input.name ?? existing.name,
    price: input.price ?? existing.price,
    price_unit: input.price_unit ?? existing.price_unit,
    reminder_days: input.reminder_days ?? existing.reminder_days,
    show_in_add: input.show_in_add === undefined ? existing.show_in_add : input.show_in_add ? 1 : 0,
  };
  const now = Date.now();
  const fields = changedFields(existing as unknown as Record<string, unknown>, next, TYPE_FIELDS);
  await db.batch([
    db
      .prepare('UPDATE service_types SET name = ?1, price = ?2, price_unit = ?3, reminder_days = ?4, show_in_add = ?5, updated_at = ?6, updated_by = ?7 WHERE id = ?8')
      .bind(next.name, next.price, next.price_unit, next.reminder_days, next.show_in_add, now, c.var.user.email, id),
    ...(fields ? [activity(db, c.var.user, { action: 'updated', type: 'service_type', id, label: next.name, detail: fields }, now)] : []),
  ]);
  return c.json({ type: await one(db, id) });
});

serviceTypes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const existing = await one(db, id);
  if (!existing) return c.json({ success: true });
  if (existing.part) return c.json({ error: 'Built-in types cannot be deleted. Turn off "Show in the Add list" instead.' }, 400);
  if ((existing.used ?? 0) > 0) return c.json({ error: 'A type that is in use cannot be deleted. Turn off "Show in the Add list" instead.' }, 400);
  await db.batch([
    db.prepare('DELETE FROM service_types WHERE id = ?1').bind(id),
    activity(db, c.var.user, { action: 'deleted', type: 'service_type', id, label: existing.name }),
  ]);
  return c.json({ success: true });
});

export default serviceTypes;
