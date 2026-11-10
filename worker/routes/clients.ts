import { Hono, type Context } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import type { InvoiceRow } from '../../src/lib/types';
import {
  addPeriod,
  clientRules,
  comingUp,
  datesOf,
  includesFor,
  isActive,
  modesFor,
  periodLine,
  serviceLabel,
  type ClientNote,
  type ClientRow,
  type ClientSummary,
  type DueRow,
  type Mode,
  type ServiceRow,
  type ServiceTypeRow,
  type Status,
} from '../../src/lib/clients';
import { currencyCode, fmtMoney, paidTotal, parsePayments, round2, type InvoiceItem } from '../../src/lib/invoices';
import { formatDate } from '../../src/lib/dates';
import { getSettings, type SettingsMap } from '../lib/settings';
import { readJsonObject } from '../lib/request';
import { activity, changedFields } from '../lib/activity';
import { requireAdmin, type CurrentUser } from '../lib/auth';
import { containsText } from '../lib/search';
import { parseClientInput, parseServiceInput, type ClientInput, type PartInput, type ServiceInput } from '../lib/client-input';
import { parseMultiline, parseText } from '../../src/lib/validate';
import { draftInvoiceStatements, markOverdue } from '../lib/invoice-create';
import { dailyRun } from '../lib/client-reminders';
import { loadServices, serviceById } from '../lib/client-services';

const clients = new Hono<AppEnv>();

const UNPAID = "status IN ('sent', 'overdue', 'partially-paid')";
const MAX_SERVICES_PER_SAVE = 30;
const NO_NUMBER = 'Could not find a free invoice number. Check "Next number" in Settings → Invoice.';

type Ctx = Context<AppEnv>;

async function loadTypes(db: D1Database): Promise<Map<string, ServiceTypeRow>> {
  const { results } = await db.prepare('SELECT * FROM service_types').all<ServiceTypeRow>();
  return new Map(results.map((t) => [t.id, t]));
}

const unpaidOf = (rows: Pick<InvoiceRow, 'total' | 'payments'>[]) =>
  round2(rows.reduce((sum, inv) => sum + Math.max(0, Number(inv.total) - paidTotal(parsePayments(inv.payments))), 0));

// ------------------------------------------------------------------------------------------------
// Reading services with what they include and which periods are invoiced
// ------------------------------------------------------------------------------------------------


// ------------------------------------------------------------------------------------------------
// Writing a service: one shape for every type, with the fields each way of working uses
// ------------------------------------------------------------------------------------------------

interface Shaped {
  name: string;
  recurs: 'renews' | 'scheduled' | null;
  repeats: ServiceRow['repeats'];
  next_at: number | null;
  due_at: number | null;
  status: Status;
  amount: number;
  quantity: number;
  details: string;
  parts: PartInput[];
}

/**
 * The stored shape of a service from its type and the input (merged over what it was). Website and Email have a
 * work due date and an optional yearly renewal; Maintenance is scheduled or one-off; other types renew, run on a
 * schedule, or are one-off. Fields the chosen way does not use are cleared.
 */
function shape(type: ServiceTypeRow, input: Partial<ServiceInput>, before: ServiceRow | null): { ok: true; value: Shaped } | { ok: false; error: string } {
  const modes = modesFor(type.part);
  const name = (type.part === 'other' ? input.name ?? before?.name : input.name || before?.name || type.name)?.trim() ?? '';
  if (!name) return { ok: false, error: 'Give "Something else" a name' };
  const next = input.next_at !== undefined ? input.next_at : before?.next_at ?? null;
  const due = input.due_at !== undefined ? input.due_at : before?.due_at ?? null;
  let repeats = input.repeats ?? before?.repeats ?? 'yearly';
  let recurs: Shaped['recurs'];
  let next_at: number | null = next;
  let due_at: number | null = due;
  if (!modes.length) {
    recurs = next_at === null ? null : 'renews';
    repeats = 'yearly';
  } else {
    const was: Mode | undefined = before ? before.recurs ?? 'oneoff' : undefined;
    const mode: Mode = input.mode ?? was ?? (type.part === 'maintenance' ? 'scheduled' : 'oneoff');
    if (!modes.includes(mode)) return { ok: false, error: `${type.name} cannot be "${mode}"` };
    recurs = mode === 'oneoff' ? null : mode;
    if (mode === 'oneoff') next_at = null;
    else due_at = null;
    if (mode === 'renews' && !input.repeats && !before?.recurs) repeats = 'yearly';
    if (mode === 'scheduled' && next_at === null) return { ok: false, error: `${name}: add the next date` };
    if (mode === 'scheduled' && !input.repeats && before?.recurs !== 'scheduled') repeats = 'monthly';
  }
  const allowed = new Set<string>([...includesFor(type.part), ...(type.part === 'email' ? ['email'] : [])]);
  const parts = (input.parts ?? before?.parts ?? []).filter((p) => allowed.has(p.part)).map((p) => ({ part: p.part, provider: p.provider ?? '', count: p.count ?? null }));
  return {
    ok: true,
    value: {
      name,
      recurs,
      repeats,
      next_at,
      due_at,
      status: input.status ?? before?.status ?? 'not_started',
      amount: input.amount ?? before?.amount ?? Number(type.price) ?? 0,
      quantity: type.price_unit === 'each' ? input.quantity ?? before?.quantity ?? 1 : 1,
      details: input.details ?? before?.details ?? '',
      parts,
    },
  };
}

const partStatements = (db: D1Database, serviceId: string, parts: PartInput[]) => [
  db.prepare('DELETE FROM service_parts WHERE service_id = ?1').bind(serviceId),
  ...parts.map((p) => db.prepare('INSERT INTO service_parts (service_id, part, provider, count) VALUES (?1, ?2, ?3, ?4)').bind(serviceId, p.part, p.provider, p.count)),
];

/** The invoice line for the work itself, or for one renewal / scheduled period. */
function itemsFor(s: ServiceRow, client: ClientRow, settings: SettingsMap, from: number | null): InvoiceItem[] {
  const fmt = (ms: number) => formatDate(ms, settings.date_format);
  const name = from === null ? serviceLabel(s) : periodLine(s, client.website, from, fmt);
  return [{ name: name.slice(0, 200), desc: s.details.slice(0, 2000), qty: from === null ? Number(s.quantity) || 1 : 1, unitPrice: Number(s.amount) || 0 }];
}

/** Does this status change draft the invoice for the work (once)? Only for services with work to deliver. */
function workNeedsDraft(s: ServiceRow, from: Status | null, to: Status, rule: 'delivered' | 'start' | 'none'): boolean {
  if (from === to || !(s.amount > 0) || (s.invoiced ?? []).includes('due')) return false;
  if (s.due_at === null && s.recurs !== null) return false;
  if (rule === 'delivered') return to === 'delivered';
  if (rule === 'start') return to === 'in_progress' || (to === 'delivered' && (from === null || from === 'not_started'));
  return false;
}

async function draftWork(db: D1Database, settings: SettingsMap, user: CurrentUser, client: ClientRow, s: ServiceRow, now: number) {
  const draft = await draftInvoiceStatements(db, settings, user, { client, serviceId: s.id, serviceFor: null, items: itemsFor(s, client, settings, null), currency: s.currency }, now);
  if (draft) settings.inv_next_number = String(draft.advanceTo);
  return draft;
}

// ------------------------------------------------------------------------------------------------
// Clients
// ------------------------------------------------------------------------------------------------

clients.get('/', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const search = c.req.query('search')?.trim().slice(0, 100) || '';
  const archived = c.req.query('archived') === '1' ? 1 : 0;
  let where = 'archived = ?1';
  const params: unknown[] = [archived];
  if (search) {
    params.push(search);
    const text = `?${params.length}`;
    where += ` AND (${containsText('name', text)} OR ${containsText('contact_name', text)} OR ${containsText('email', text)} OR ${containsText('website', text)})`;
  }
  const [, rows, unpaid] = await db.batch([
    markOverdue(db, now),
    db.prepare(`SELECT * FROM clients WHERE ${where} ORDER BY name COLLATE NOCASE`).bind(...params),
    db.prepare(`SELECT client_id, total, payments, status FROM invoices WHERE client_id IS NOT NULL AND ${UNPAID}`),
  ]);
  const services = await loadServices(db, { active: true });
  const byClient = new Map<string, { names: string[]; next: number | null; what: string | null }>();
  for (const s of services) {
    const entry = byClient.get(s.client_id) ?? { names: [], next: null, what: null };
    entry.names.push(s.name);
    for (const d of datesOf(s)) {
      if (entry.next === null || d.date < entry.next) {
        entry.next = d.date;
        entry.what = `${s.name} ${d.what === 'due' ? 'due' : d.what === 'renews' ? 'renews' : 'scheduled'}`;
      }
    }
    byClient.set(s.client_id, entry);
  }
  const owed = new Map<string, { amount: number; overdue: number }>();
  for (const inv of unpaid.results as (Pick<InvoiceRow, 'total' | 'payments' | 'status'> & { client_id: string })[]) {
    const entry = owed.get(inv.client_id) ?? { amount: 0, overdue: 0 };
    entry.amount += unpaidOf([inv]);
    if (inv.status === 'overdue') entry.overdue += 1;
    owed.set(inv.client_id, entry);
  }
  const list: ClientSummary[] = (rows.results as ClientRow[]).map((client) => {
    const s = byClient.get(client.id);
    const o = owed.get(client.id);
    return {
      ...client,
      service_names: s?.names ?? [],
      next_date: s?.next ?? null,
      next_what: s?.what ?? null,
      unpaid: round2(o?.amount ?? 0),
      overdue_invoices: o?.overdue ?? 0,
    };
  });
  return c.json({ clients: list });
});

/** Runs today's reminders and invoice drafts now (admins). Reminders already sent today are not sent again. */
clients.post('/daily-run', requireAdmin, async (c) => c.json(await dailyRun(c.env)));

/** Every client's open work and renewal / scheduled dates, soonest first (the Due dates page). */
clients.get('/due', async (c) => {
  const db = c.env.DB;
  const [services, names] = await Promise.all([
    loadServices(db, { active: true }),
    db.prepare('SELECT id, name FROM clients WHERE archived = 0').all<{ id: string; name: string }>(),
  ]);
  const clientName = new Map(names.results.map((r) => [r.id, r.name]));
  const rows: DueRow[] = [];
  for (const s of services) {
    const name = clientName.get(s.client_id);
    if (name === undefined) continue;
    for (const d of datesOf(s)) rows.push({ service: s, client_name: name, date: d.date, what: d.what });
  }
  rows.sort((a, b) => a.date - b.date);
  return c.json({ rows });
});

clients.post('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseClientInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  if (!input.name) return c.json({ error: 'A client name is required' }, 400);
  const rawServices = body.services === undefined ? [] : body.services;
  if (!Array.isArray(rawServices) || rawServices.length > MAX_SERVICES_PER_SAVE) {
    return c.json({ error: `Services must be a list of up to ${MAX_SERVICES_PER_SAVE}` }, 400);
  }
  const db = c.env.DB;
  const user = c.var.user;
  const now = Date.now();
  const [settings, types] = await Promise.all([getSettings(db), loadTypes(db)]);
  const rule = clientRules(settings).jobInvoice;
  const id = `cli_${nanoid(10)}`;
  const client: ClientRow = {
    id,
    name: input.name,
    contact_name: input.contact_name ?? '',
    email: input.email ?? '',
    phone: input.phone ?? '',
    whatsapp: input.whatsapp === false ? 0 : 1,
    whatsapp_number: input.whatsapp === false ? input.whatsapp_number ?? '' : '',
    website: input.website ?? '',
    status: input.status ?? 'active',
    notes: input.notes ?? '',
    service_notes: input.service_notes ?? '',
    logins: input.logins ?? '',
    billing_address: input.billing_address ?? '',
    tax_id: input.tax_id ?? '',
    archived: 0,
    created_at: now,
    updated_at: now,
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO clients (id, name, contact_name, email, phone, whatsapp, whatsapp_number, website, status, notes, service_notes, logins,
          billing_address, tax_id, created_at, updated_at, created_by, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16, ?16)`
      )
      .bind(id, client.name, client.contact_name, client.email, client.phone, client.whatsapp, client.whatsapp_number, client.website,
        client.status, client.notes, client.service_notes, client.logins, client.billing_address, client.tax_id, now, user.email),
  ];
  const names: string[] = [];
  for (const [index, raw] of rawServices.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return c.json({ error: `Service ${index + 1} is invalid` }, 400);
    const sInput = parseServiceInput(raw as Record<string, unknown>);
    if (!sInput.ok) return c.json({ error: sInput.error }, 400);
    const made = insertService(db, types, id, sInput.value, settings, user, now);
    if (!made.ok) return c.json({ error: made.error }, 400);
    statements.push(...made.statements);
    names.push(made.service.name);
    if (workNeedsDraft(made.service, null, made.service.status, rule)) {
      const draft = await draftWork(db, settings, user, client, made.service, now);
      if (!draft) return c.json({ error: NO_NUMBER }, 409);
      statements.push(...draft.statements);
    }
  }
  statements.push(activity(db, user, { action: 'created', type: 'client', id, label: client.name, detail: names.join(', ') }, now));
  await db.batch(statements);
  return c.json({ client: await db.prepare('SELECT * FROM clients WHERE id = ?1').bind(id).first<ClientRow>() }, 201);
});

function insertService(
  db: D1Database,
  types: Map<string, ServiceTypeRow>,
  clientId: string,
  input: Partial<ServiceInput>,
  settings: SettingsMap,
  user: CurrentUser,
  now: number
): { ok: true; service: ServiceRow; statements: D1PreparedStatement[] } | { ok: false; error: string } {
  const type = input.type_id ? types.get(input.type_id) : undefined;
  if (!type) return { ok: false, error: 'Pick what kind of service it is' };
  const shaped = shape(type, input, null);
  if (!shaped.ok) return shaped;
  const v = shaped.value;
  const service: ServiceRow = {
    id: `svc_${nanoid(10)}`,
    client_id: clientId,
    type_id: type.id,
    name: v.name,
    details: v.details,
    recurs: v.recurs,
    repeats: v.repeats,
    next_at: v.next_at,
    due_at: v.due_at,
    status: v.status,
    amount: v.amount,
    quantity: v.quantity,
    currency: input.currency ?? currencyCode(settings.inv_default_currency),
    ended_at: v.status === 'cancelled' ? now : null,
    created_at: now,
    updated_at: now,
    parts: v.parts,
    type_part: type.part,
    invoiced: [],
  };
  return {
    ok: true,
    service,
    statements: [
      db
        .prepare(
          `INSERT INTO client_services (id, client_id, type_id, name, details, recurs, repeats, next_at, due_at, status, amount, quantity, currency,
            ended_at, created_at, updated_at, created_by, updated_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16, ?16)`
        )
        .bind(service.id, clientId, type.id, v.name, v.details, v.recurs, v.repeats, v.next_at, v.due_at, v.status, v.amount, v.quantity,
          service.currency, service.ended_at, now, user.email),
      ...partStatements(db, service.id, v.parts).slice(1),
    ],
  };
}

clients.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const now = Date.now();
  const [, found, invoices, notes] = await db.batch([
    markOverdue(db, now),
    db.prepare('SELECT * FROM clients WHERE id = ?1').bind(id),
    db.prepare('SELECT * FROM invoices WHERE client_id = ?1 ORDER BY issued_at DESC, created_at DESC LIMIT 50').bind(id),
    db.prepare('SELECT * FROM client_notes WHERE client_id = ?1 ORDER BY at DESC LIMIT 50').bind(id),
  ]);
  const client = (found.results as ClientRow[])[0];
  if (!client) return c.json({ error: 'Client not found' }, 404);
  const [settings, types, services] = await Promise.all([getSettings(db), loadTypes(db), loadServices(db, { client: id })]);
  const invoiceRows = invoices.results as InvoiceRow[];
  const year = new Date(now).getUTCFullYear();
  const billed = invoiceRows.filter((inv) => inv.status !== 'draft' && inv.status !== 'cancelled' && new Date(inv.issued_at).getUTCFullYear() === year);
  return c.json({
    client,
    services,
    invoices: invoiceRows,
    notes: notes.results as ClientNote[],
    coming_up: comingUp(services, types, clientRules(settings), now),
    totals: {
      unpaid: unpaidOf(invoiceRows.filter((inv) => ['sent', 'overdue', 'partially-paid'].includes(inv.status))),
      overdue_invoices: invoiceRows.filter((inv) => inv.status === 'overdue').length,
      billed_this_year: round2(billed.reduce((sum, inv) => sum + Number(inv.total), 0)),
      invoices_this_year: billed.length,
    },
  });
});

const CLIENT_FIELDS: Record<string, string> = {
  name: 'name',
  contact_name: 'contact',
  email: 'email',
  phone: 'phone',
  whatsapp: 'WhatsApp',
  whatsapp_number: 'WhatsApp number',
  website: 'website',
  status: 'status',
  notes: 'notes',
  service_notes: 'service notes',
  logins: 'logins',
  billing_address: 'billing address',
  tax_id: 'tax ID',
};

clients.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseClientInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  const db = c.env.DB;
  const user = c.var.user;
  const now = Date.now();
  const existing = await db.prepare('SELECT * FROM clients WHERE id = ?1').bind(id).first<ClientRow>();
  if (!existing) return c.json({ error: 'Client not found' }, 404);
  if (input.name !== undefined && !input.name) return c.json({ error: 'A client name is required' }, 400);
  const archived = body.archived === undefined ? existing.archived : body.archived === true ? 1 : 0;
  const whatsapp = input.whatsapp === undefined ? existing.whatsapp : input.whatsapp ? 1 : 0;
  const next: Record<keyof ClientInput, unknown> = {
    name: input.name ?? existing.name,
    contact_name: input.contact_name ?? existing.contact_name,
    email: input.email ?? existing.email,
    phone: input.phone ?? existing.phone,
    whatsapp,
    whatsapp_number: whatsapp ? '' : input.whatsapp_number ?? existing.whatsapp_number,
    website: input.website ?? existing.website,
    status: input.status ?? existing.status,
    notes: input.notes ?? existing.notes,
    service_notes: input.service_notes ?? existing.service_notes,
    logins: input.logins ?? existing.logins,
    billing_address: input.billing_address ?? existing.billing_address,
    tax_id: input.tax_id ?? existing.tax_id,
  };
  const statements = [
    db
      .prepare(
        `UPDATE clients SET name = ?1, contact_name = ?2, email = ?3, phone = ?4, whatsapp = ?5, whatsapp_number = ?6, website = ?7, status = ?8,
          notes = ?9, service_notes = ?10, logins = ?11, billing_address = ?12, tax_id = ?13, archived = ?14, updated_at = ?15, updated_by = ?16
         WHERE id = ?17`
      )
      .bind(next.name, next.contact_name, next.email, next.phone, next.whatsapp, next.whatsapp_number, next.website, next.status, next.notes,
        next.service_notes, next.logins, next.billing_address, next.tax_id, archived, now, user.email, id),
  ];
  const fields = changedFields(existing as unknown as Record<string, unknown>, next, CLIENT_FIELDS);
  if (archived !== existing.archived) {
    statements.push(activity(db, user, { action: archived ? 'archived' : 'restored', type: 'client', id, label: String(next.name) }, now));
  } else if (fields) {
    statements.push(activity(db, user, { action: 'updated', type: 'client', id, label: String(next.name), detail: fields }, now));
  }
  await db.batch(statements);
  return c.json({ client: await db.prepare('SELECT * FROM clients WHERE id = ?1').bind(id).first<ClientRow>() });
});

clients.delete('/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT name FROM clients WHERE id = ?1').bind(id).first<{ name: string }>();
  if (!existing) return c.json({ success: true });
  // Their invoices stay (they are financial records); they just stop pointing at the client.
  await db.batch([
    db.prepare('DELETE FROM service_reminders WHERE service_id IN (SELECT id FROM client_services WHERE client_id = ?1)').bind(id),
    db.prepare('DELETE FROM service_parts WHERE service_id IN (SELECT id FROM client_services WHERE client_id = ?1)').bind(id),
    db.prepare('DELETE FROM client_services WHERE client_id = ?1').bind(id),
    db.prepare('DELETE FROM client_notes WHERE client_id = ?1').bind(id),
    db.prepare('UPDATE invoices SET client_id = NULL, service_id = NULL, service_for = NULL WHERE client_id = ?1').bind(id),
    db.prepare('DELETE FROM clients WHERE id = ?1').bind(id),
    activity(db, c.var.user, { action: 'deleted', type: 'client', id, label: existing.name }),
  ]);
  return c.json({ success: true });
});

// ------------------------------------------------------------------------------------------------
// A client's services
// ------------------------------------------------------------------------------------------------

clients.post('/:id/services', async (c) => {
  const id = c.req.param('id');
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseServiceInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const db = c.env.DB;
  const user = c.var.user;
  const now = Date.now();
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?1').bind(id).first<ClientRow>();
  if (!client) return c.json({ error: 'Client not found' }, 404);
  const [settings, types] = await Promise.all([getSettings(db), loadTypes(db)]);
  const made = insertService(db, types, id, parsed.value, settings, user, now);
  if (!made.ok) return c.json({ error: made.error }, 400);
  const statements = [...made.statements];
  let invoice: { id: string; number: string } | null = null;
  if (workNeedsDraft(made.service, null, made.service.status, clientRules(settings).jobInvoice)) {
    const draft = await draftWork(db, settings, user, client, made.service, now);
    if (!draft) return c.json({ error: NO_NUMBER }, 409);
    statements.push(...draft.statements);
    invoice = { id: draft.id, number: draft.number };
  }
  statements.push(
    db.prepare('UPDATE clients SET updated_at = ?1, updated_by = ?2 WHERE id = ?3').bind(now, user.email, id),
    activity(db, user, { action: 'added service', type: 'client', id, label: client.name, detail: made.service.name }, now)
  );
  await db.batch(statements);
  return c.json({ service: await serviceById(db, made.service.id), invoice }, 201);
});

async function serviceAndClient(c: Ctx) {
  const db = c.env.DB;
  const service = await serviceById(db, c.req.param('sid') ?? '');
  if (!service) return null;
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?1').bind(service.client_id).first<ClientRow>();
  return client ? { service, client } : null;
}

const SERVICE_FIELDS: Record<string, string> = {
  name: 'name',
  recurs: 'how it works',
  repeats: 'how often',
  next_at: 'renewal date',
  due_at: 'due date',
  status: 'status',
  amount: 'charge',
  quantity: 'quantity',
  details: 'details',
  parts: 'includes',
};

clients.patch('/services/:sid', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseServiceInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const found = await serviceAndClient(c);
  if (!found) return c.json({ error: 'Service not found' }, 404);
  const { service, client } = found;
  const db = c.env.DB;
  const user = c.var.user;
  const now = Date.now();
  const [settings, types] = await Promise.all([getSettings(db), loadTypes(db)]);
  const type = types.get(service.type_id);
  if (!type) return c.json({ error: 'This service type no longer exists' }, 400);
  const shaped = shape(type, parsed.value, service);
  if (!shaped.ok) return c.json({ error: shaped.error }, 400);
  const v = shaped.value;
  let endedAt = service.ended_at;
  if (body.ended === true && endedAt === null) endedAt = now;
  if (body.ended === false) endedAt = null;
  if (v.status === 'cancelled' && service.status !== 'cancelled') endedAt = now;
  if (v.status !== 'cancelled' && service.status === 'cancelled') endedAt = null;
  const next: ServiceRow = { ...service, ...v, ended_at: endedAt };

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE client_services SET name = ?1, details = ?2, recurs = ?3, repeats = ?4, next_at = ?5, due_at = ?6, status = ?7, amount = ?8,
          quantity = ?9, ended_at = ?10, updated_at = ?11, updated_by = ?12 WHERE id = ?13`
      )
      .bind(v.name, v.details, v.recurs, v.repeats, v.next_at, v.due_at, v.status, v.amount, v.quantity, endedAt, now, user.email, service.id),
  ];
  if (parsed.value.parts !== undefined) statements.push(...partStatements(db, service.id, v.parts));
  let invoice: { id: string; number: string } | null = null;
  if (workNeedsDraft(next, service.status, v.status, clientRules(settings).jobInvoice)) {
    const draft = await draftWork(db, settings, user, client, next, now);
    if (!draft) return c.json({ error: NO_NUMBER }, 409);
    statements.push(...draft.statements);
    invoice = { id: draft.id, number: draft.number };
  }
  const action =
    v.status !== service.status && (v.status === 'delivered' || v.status === 'cancelled')
      ? v.status
      : endedAt !== service.ended_at
        ? endedAt ? 'ended service' : 'restored service'
        : 'updated service';
  const before = { ...service, parts: JSON.stringify(service.parts ?? []) } as unknown as Record<string, unknown>;
  const after = { ...next, parts: JSON.stringify(v.parts) } as unknown as Record<string, unknown>;
  const fields = changedFields(before, after, SERVICE_FIELDS);
  if (fields || action !== 'updated service') {
    statements.push(activity(db, user, { action, type: 'client', id: client.id, label: client.name, detail: `${v.name}${fields && action === 'updated service' ? `: ${fields}` : ''}` }, now));
  }
  await db.batch(statements);
  return c.json({ service: await serviceById(db, service.id), invoice });
});

clients.delete('/services/:sid', requireAdmin, async (c) => {
  const found = await serviceAndClient(c);
  if (!found) return c.json({ success: true });
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM service_reminders WHERE service_id = ?1').bind(found.service.id),
    db.prepare('DELETE FROM service_parts WHERE service_id = ?1').bind(found.service.id),
    db.prepare('UPDATE invoices SET service_id = NULL, service_for = NULL WHERE service_id = ?1').bind(found.service.id),
    db.prepare('DELETE FROM client_services WHERE id = ?1').bind(found.service.id),
    activity(db, c.var.user, { action: 'removed service', type: 'client', id: found.client.id, label: found.client.name, detail: found.service.name }),
  ]);
  return c.json({ success: true });
});

/**
 * Renew: move the renewal date one period on (from the old date, not today) and, if asked, draft the invoice for the
 * period. A period that already has its invoice (drafted ahead of time) is not drafted twice.
 */
clients.post('/services/:sid/renew', async (c) => {
  const body = (await readJsonObject(c)) ?? {};
  const found = await serviceAndClient(c);
  if (!found) return c.json({ error: 'Service not found' }, 404);
  const { service, client } = found;
  if (service.recurs !== 'renews' || service.next_at === null) return c.json({ error: 'Add the renewal date first' }, 400);
  if (!isActive(service)) return c.json({ error: 'This service has ended. Restore it first.' }, 400);
  const parsed = parseServiceInput(body.amount === undefined ? {} : { amount: body.amount });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  return moveOn(c, service, client, parsed.value.amount ?? service.amount, body.invoice === true, 'renewed');
});

/** A scheduled service is done: the next date is one period on. Its invoice is drafted ahead by the daily run. */
clients.post('/services/:sid/done', async (c) => {
  const found = await serviceAndClient(c);
  if (!found) return c.json({ error: 'Service not found' }, 404);
  const { service, client } = found;
  if (service.recurs !== 'scheduled' || service.next_at === null) return c.json({ error: 'Only scheduled services can be marked done this way' }, 400);
  if (!isActive(service)) return c.json({ error: 'This service has ended. Restore it first.' }, 400);
  const body = (await readJsonObject(c)) ?? {};
  const done = Math.max(0, Math.min(50, Math.floor(Number(body.done_steps) || 0)));
  const total = Math.max(0, Math.min(50, Math.floor(Number(body.total_steps) || 0)));
  const note = parseMultiline(body.note ?? '', 'Note');
  if (!note.ok) return c.json({ error: note.error }, 400);
  const extra = note.value ? [noteInsert(c.env.DB, client.id, c.var.user.email, `${service.name}: ${note.value}`, null, Date.now())] : [];
  return moveOn(c, service, client, service.amount, false, 'schedule done', total ? ` · ${done} of ${total} steps done` : '', extra);
});

async function moveOn(c: Ctx, service: ServiceRow, client: ClientRow, amount: number, invoice: boolean, action: string, suffix = '', extra: D1PreparedStatement[] = []) {
  const db = c.env.DB;
  const user = c.var.user;
  const now = Date.now();
  const from = service.next_at as number;
  const to = addPeriod(from, service.repeats);
  const settings = await getSettings(db);
  const statements: D1PreparedStatement[] = [
    db.prepare('UPDATE client_services SET next_at = ?1, amount = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?5').bind(to, amount, now, user.email, service.id),
  ];
  let made: { id: string; number: string } | null = null;
  const already = (service.invoiced ?? []).includes(from);
  if (invoice && !already) {
    if (!(amount > 0)) return c.json({ error: 'Add a charge first, or only move the date' }, 400);
    const draft = await draftInvoiceStatements(db, settings, user, {
      client,
      serviceId: service.id,
      serviceFor: from,
      items: itemsFor({ ...service, amount }, client, settings, from),
      currency: service.currency,
    }, now);
    if (!draft) return c.json({ error: NO_NUMBER }, 409);
    statements.push(...draft.statements);
    made = { id: draft.id, number: draft.number };
  }
  statements.push(
    activity(db, user, {
      action,
      type: 'client',
      id: client.id,
      label: client.name,
      detail: `${service.name}, next ${formatDate(to, settings.date_format)}${made ? ` · ${made.number} drafted (${fmtMoney(amount, service.currency)})` : ''}${suffix}`,
    }, now),
    ...extra
  );
  await db.batch(statements);
  return c.json({ service: await serviceById(db, service.id), invoice: made, already_invoiced: invoice && already });
}

// ------------------------------------------------------------------------------------------------
// Notes and activity on a client's page
// ------------------------------------------------------------------------------------------------

function noteInsert(db: D1Database, clientId: string, author: string, text: string, remindAt: number | null, now: number) {
  return db
    .prepare('INSERT INTO client_notes (id, client_id, at, author, text, remind_at, done) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)')
    .bind(`note_${nanoid(10)}`, clientId, now, author, text.slice(0, 2000), remindAt);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

clients.post('/:id/notes', async (c) => {
  const id = c.req.param('id');
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const text = parseMultiline(body.text ?? '', 'Note');
  if (!text.ok) return c.json({ error: text.error }, 400);
  if (!text.value) return c.json({ error: 'Write something first' }, 400);
  let remindAt: number | null = null;
  if (body.remind_at !== undefined && body.remind_at !== null && body.remind_at !== '') {
    if (typeof body.remind_at !== 'string' || !DAY_RE.test(body.remind_at)) return c.json({ error: 'The reminder date must look like 2026-12-01' }, 400);
    remindAt = Date.parse(`${body.remind_at}T00:00:00Z`);
    if (Number.isNaN(remindAt)) return c.json({ error: 'The reminder date is not a real date' }, 400);
  }
  const db = c.env.DB;
  const client = await db.prepare('SELECT id, name FROM clients WHERE id = ?1').bind(id).first<{ id: string; name: string }>();
  if (!client) return c.json({ error: 'Client not found' }, 404);
  await db.batch([
    noteInsert(db, id, c.var.user.email, text.value, remindAt, Date.now()),
    db.prepare('UPDATE clients SET updated_at = ?1, updated_by = ?2 WHERE id = ?3').bind(Date.now(), c.var.user.email, id),
  ]);
  const { results } = await db.prepare('SELECT * FROM client_notes WHERE client_id = ?1 ORDER BY at DESC LIMIT 50').bind(id).all<ClientNote>();
  return c.json({ notes: results }, 201);
});

clients.patch('/notes/:nid', async (c) => {
  const body = (await readJsonObject(c)) ?? {};
  const db = c.env.DB;
  const note = await db.prepare('SELECT * FROM client_notes WHERE id = ?1').bind(c.req.param('nid')).first<ClientNote>();
  if (!note) return c.json({ error: 'Note not found' }, 404);
  await db.prepare('UPDATE client_notes SET done = ?1 WHERE id = ?2').bind(body.done === true ? 1 : 0, note.id).run();
  return c.json({ note: { ...note, done: body.done === true ? 1 : 0 } });
});

/** The person who wrote a note, or an admin, can delete it. */
clients.delete('/notes/:nid', async (c) => {
  const db = c.env.DB;
  const note = await db.prepare('SELECT * FROM client_notes WHERE id = ?1').bind(c.req.param('nid')).first<ClientNote>();
  if (!note) return c.json({ success: true });
  if (note.author !== c.var.user.email && c.var.user.role !== 'admin') return c.json({ error: 'Only the person who wrote it, or an admin, can delete a note' }, 403);
  await db.prepare('DELETE FROM client_notes WHERE id = ?1').bind(note.id).run();
  return c.json({ success: true });
});

// ------------------------------------------------------------------------------------------------
// Import clients from existing invoices (admins)
// ------------------------------------------------------------------------------------------------

interface Candidate {
  name: string;
  email: string;
  address: string;
  invoices: number;
  last_issued: number;
}

/** Client names on invoices that are not linked to a client yet and match no client by name. */
async function importCandidates(db: D1Database): Promise<Candidate[]> {
  const { results } = await db
    .prepare(
      `SELECT i.client_name AS name, i.client_email AS email, i.client_address AS address, i.issued_at
       FROM invoices i WHERE i.client_id IS NULL AND trim(i.client_name) != ''
       AND NOT EXISTS (SELECT 1 FROM clients c WHERE lower(c.name) = lower(trim(i.client_name)))
       ORDER BY i.issued_at DESC`
    )
    .all<{ name: string; email: string; address: string; issued_at: number }>();
  const byName = new Map<string, Candidate>();
  for (const row of results) {
    const key = row.name.trim().toLowerCase();
    const found = byName.get(key);
    if (found) found.invoices += 1;
    else byName.set(key, { name: row.name.trim(), email: row.email ?? '', address: row.address ?? '', invoices: 1, last_issued: row.issued_at });
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

clients.get('/import/candidates', requireAdmin, async (c) => c.json({ candidates: await importCandidates(c.env.DB) }));

clients.post('/import', requireAdmin, async (c) => {
  const body = await readJsonObject(c);
  if (!body || !Array.isArray(body.names) || body.names.length > 200) return c.json({ error: 'Pick up to 200 names' }, 400);
  const wanted = new Set<string>();
  for (const name of body.names) {
    const parsed = parseText(name, 'Name');
    if (!parsed.ok || !parsed.value) return c.json({ error: 'Every name must be text' }, 400);
    wanted.add(parsed.value.toLowerCase());
  }
  const db = c.env.DB;
  const user = c.var.user;
  const now = Date.now();
  const picked = (await importCandidates(db)).filter((cand) => wanted.has(cand.name.toLowerCase()));
  const statements: D1PreparedStatement[] = [];
  for (const cand of picked) {
    const id = `cli_${nanoid(10)}`;
    const email = parseEmailLoose(cand.email);
    statements.push(
      db
        .prepare(
          `INSERT INTO clients (id, name, email, billing_address, status, created_at, updated_at, created_by, updated_by)
           VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5, ?6, ?6)`
        )
        .bind(id, cand.name, email, cand.address.slice(0, 2000), now, user.email),
      db.prepare("UPDATE invoices SET client_id = ?1 WHERE client_id IS NULL AND lower(trim(client_name)) = lower(?2)").bind(id, cand.name),
      activity(db, user, { action: 'created', type: 'client', id, label: cand.name, detail: `imported from ${cand.invoices} ${cand.invoices === 1 ? 'invoice' : 'invoices'}` }, now)
    );
  }
  // D1 batches are capped; 200 clients is 600 statements, so send them in slices.
  for (let i = 0; i < statements.length; i += 90) await db.batch(statements.slice(i, i + 90));
  return c.json({ imported: picked.length });
});

const parseEmailLoose = (value: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : '');

export default clients;
