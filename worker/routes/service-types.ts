import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import { KIND_LABEL, type ServiceTypeRow } from '../../src/lib/clients';
import { readJsonObject } from '../lib/request';
import { activity, changedFields } from '../lib/activity';
import { parseServiceTypeInput } from '../lib/client-input';

/**
 * Service types (Settings → Clients). Everyone reads them (the forms list them); only admins change them
 * (see worker/index.ts). A type in use keeps how it works, and cannot be deleted: hide it from the Add
 * list instead. The built-in parts (website, domain, ...) keep how they work too, because the Log a
 * client form depends on them.
 */
const serviceTypes = new Hono<AppEnv>();

const LIST = `SELECT t.*, (SELECT COUNT(*) FROM client_services s WHERE s.type_id = t.id) AS used
  FROM service_types t ORDER BY t.sort, t.created_at`;

serviceTypes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(LIST).all<ServiceTypeRow>();
  return c.json({ types: results });
});

serviceTypes.post('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseServiceTypeInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  if (!input.name) return c.json({ error: 'Give the service type a name' }, 400);
  if (!input.kind) return c.json({ error: 'Pick how it works' }, 400);
  const db = c.env.DB;
  if (await db.prepare('SELECT id FROM service_types WHERE name = ?1 COLLATE NOCASE').bind(input.name).first()) {
    return c.json({ error: `There is already a service type called ${input.name}` }, 409);
  }
  const now = Date.now();
  const id = `st_${nanoid(10)}`;
  const kind = input.kind;
  const cycle = kind === 'job' || kind === 'any' ? 'once' : input.cycle && input.cycle !== 'once' ? input.cycle : kind === 'visits' ? 'monthly' : 'yearly';
  const sort = ((await db.prepare("SELECT MAX(sort) AS m FROM service_types WHERE part IS NULL OR part != 'other'").first<{ m: number }>())?.m ?? 0) + 10;
  await db.batch([
    db
      .prepare(
        `INSERT INTO service_types (id, name, kind, part, cycle, price, price_unit, reminder_days, invoice_when, show_in_add, sort,
          created_at, updated_at, created_by, updated_by)
         VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, ?12)`
      )
      .bind(id, input.name, kind, cycle, input.price ?? 0, input.price_unit ?? 'once', input.reminder_days ?? '', input.invoice_when ?? '',
        input.show_in_add === false ? 0 : 1, sort, now, c.var.user.email),
    activity(db, c.var.user, { action: 'created', type: 'service_type', id, label: input.name, detail: KIND_LABEL[kind] }, now),
  ]);
  const type = await db.prepare(`${LIST.replace('ORDER BY t.sort, t.created_at', 'WHERE t.id = ?1')}`).bind(id).first<ServiceTypeRow>();
  return c.json({ type }, 201);
});

const TYPE_FIELDS: Record<string, string> = {
  name: 'name',
  kind: 'how it works',
  cycle: 'billing cycle',
  price: 'default price',
  price_unit: 'price unit',
  reminder_days: 'reminder days',
  invoice_when: 'invoice choice',
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
  const existing = await db.prepare(LIST.replace('ORDER BY t.sort, t.created_at', 'WHERE t.id = ?1')).bind(id).first<ServiceTypeRow>();
  if (!existing) return c.json({ error: 'Service type not found' }, 404);
  if (input.name !== undefined && !input.name) return c.json({ error: 'Give the service type a name' }, 400);
  if (input.kind !== undefined && input.kind !== existing.kind) {
    if (existing.part) return c.json({ error: 'How a built-in type works cannot change' }, 400);
    if ((existing.used ?? 0) > 0) return c.json({ error: 'How it works is fixed once a service uses this type' }, 400);
  }
  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    if (await db.prepare('SELECT id FROM service_types WHERE name = ?1 COLLATE NOCASE AND id != ?2').bind(input.name, id).first()) {
      return c.json({ error: `There is already a service type called ${input.name}` }, 409);
    }
  }
  const kind = input.kind ?? existing.kind;
  let cycle = input.cycle ?? existing.cycle;
  if (kind === 'job' || kind === 'any') cycle = 'once';
  else if (cycle === 'once') cycle = kind === 'visits' ? 'monthly' : 'yearly';
  const next = {
    name: input.name ?? existing.name,
    kind,
    cycle,
    price: input.price ?? existing.price,
    price_unit: input.price_unit ?? existing.price_unit,
    reminder_days: input.reminder_days ?? existing.reminder_days,
    invoice_when: input.invoice_when ?? existing.invoice_when,
    show_in_add: input.show_in_add === undefined ? existing.show_in_add : input.show_in_add ? 1 : 0,
  };
  const now = Date.now();
  const fields = changedFields(existing as unknown as Record<string, unknown>, next, TYPE_FIELDS);
  await db.batch([
    db
      .prepare(
        `UPDATE service_types SET name = ?1, kind = ?2, cycle = ?3, price = ?4, price_unit = ?5, reminder_days = ?6, invoice_when = ?7,
          show_in_add = ?8, updated_at = ?9, updated_by = ?10 WHERE id = ?11`
      )
      .bind(next.name, next.kind, next.cycle, next.price, next.price_unit, next.reminder_days, next.invoice_when, next.show_in_add, now,
        c.var.user.email, id),
    ...(fields ? [activity(db, c.var.user, { action: 'updated', type: 'service_type', id, label: next.name, detail: fields }, now)] : []),
  ]);
  const type = await db.prepare(LIST.replace('ORDER BY t.sort, t.created_at', 'WHERE t.id = ?1')).bind(id).first<ServiceTypeRow>();
  return c.json({ type });
});

serviceTypes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const existing = await db.prepare(LIST.replace('ORDER BY t.sort, t.created_at', 'WHERE t.id = ?1')).bind(id).first<ServiceTypeRow>();
  if (!existing) return c.json({ success: true });
  if (existing.part) return c.json({ error: 'Built-in types cannot be deleted. Turn off "Show in the Add list" instead.' }, 400);
  if ((existing.used ?? 0) > 0) return c.json({ error: 'A type that is in use can be edited, but not deleted. Turn off "Show in the Add list" instead.' }, 400);
  await db.batch([
    db.prepare('DELETE FROM service_types WHERE id = ?1').bind(id),
    activity(db, c.var.user, { action: 'deleted', type: 'service_type', id, label: existing.name }),
  ]);
  return c.json({ success: true });
});

export default serviceTypes;
