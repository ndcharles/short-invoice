import { Hono, type Context } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import type { InvoiceRow } from '../../src/lib/types';
import {
  addCycle,
  clientRules,
  comingUp,
  jobInvoiceWhen,
  parseTags,
  renewalLine,
  type ClientRow,
  type ClientRules,
  type ClientNote,
  type ClientSummary,
  type DueRow,
  type JobStatus,
  type ServiceRow,
  type ServiceTypeRow,
} from '../../src/lib/clients';
import { currencyCode, fmtMoney, paidTotal, parsePayments, round2, type InvoiceItem } from '../../src/lib/invoices';
import { formatDate } from '../../src/lib/dates';
import { getSettings, type SettingsMap } from '../lib/settings';
import { readJsonObject } from '../lib/request';
import { activity, changedFields } from '../lib/activity';
import { requireAdmin, type CurrentUser } from '../lib/auth';
import { findByName } from '../lib/collections';
import { containsText } from '../lib/search';
import { parseClientInput, parseServiceInput, type ClientInput, type ServiceInput } from '../lib/client-input';
import { parseMultiline, parseText } from '../../src/lib/validate';
import { draftInvoiceStatements, markOverdue } from '../lib/invoice-create';
import { dailyRun } from '../lib/client-reminders';

const clients = new Hono<AppEnv>();

const UNPAID = "status IN ('sent', 'overdue', 'partially-paid')";
const MAX_SERVICES_PER_SAVE = 30;

type Ctx = Context<AppEnv>;

async function loadTypes(db: D1Database): Promise<Map<string, ServiceTypeRow>> {
  const { results } = await db.prepare('SELECT * FROM service_types').all<ServiceTypeRow>();
  return new Map(results.map((t) => [t.id, t]));
}

/** Members pick tags from the list admins keep; a tag the client already has is always accepted. */
async function unknownTag(db: D1Database, user: CurrentUser, tags: string[] | undefined, current: string[] = []): Promise<string | null> {
  if (!tags || user.role === 'admin') return null;
  for (const tag of tags) {
    if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
    if (!(await findByName(db, 'tags', tag))) return `Tag "${tag}" does not exist. Ask an admin to add it first.`;
  }
  return null;
}

const unpaidOf = (rows: Pick<InvoiceRow, 'total' | 'payments'>[]) =>
  round2(rows.reduce((sum, inv) => sum + Math.max(0, Number(inv.total) - paidTotal(parsePayments(inv.payments))), 0));

// ------------------------------------------------------------------------------------------------
// Services: building a row from input, and the invoices they draft
// ------------------------------------------------------------------------------------------------

type BuiltService = { row: ServiceRow; insert: D1PreparedStatement };

function buildService(
  db: D1Database,
  types: Map<string, ServiceTypeRow>,
  clientId: string,
  input: Partial<ServiceInput>,
  settings: SettingsMap,
  user: CurrentUser,
  now: number
): { ok: true; value: BuiltService } | { ok: false; error: string } {
  const type = input.type_id ? types.get(input.type_id) : undefined;
  if (!type) return { ok: false, error: 'Pick what kind of service it is' };
  const kind = type.kind === 'any' ? input.kind ?? 'job' : type.kind;
  const name = (type.kind === 'any' ? input.name : input.name || type.name) || '';
  if (!name) return { ok: false, error: 'Give the service a name' };
  let cycle = input.cycle ?? (kind === 'job' ? 'once' : type.cycle === 'once' ? (kind === 'visits' ? 'monthly' : 'yearly') : type.cycle);
  if (kind === 'job') cycle = 'once';
  else if (cycle === 'once') return { ok: false, error: `${name}: pick yearly or monthly` };
  const row: ServiceRow = {
    id: `svc_${nanoid(10)}`,
    client_id: clientId,
    type_id: type.id,
    name,
    kind,
    details: input.details ?? '',
    meta: JSON.stringify(input.meta ?? {}),
    cycle,
    next_date: input.next_date ?? null,
    price: input.price ?? Number(type.price) ?? 0,
    quantity: input.quantity ?? 1,
    currency: input.currency ?? currencyCode(settings.inv_default_currency),
    job_status: kind === 'job' ? input.job_status ?? 'not_started' : '',
    invoice_when: kind === 'job' ? input.invoice_when ?? '' : '',
    invoice_id: null,
    invoiced_for: null,
    ended_at: kind === 'job' && input.job_status === 'delivered' ? now : null,
    created_at: now,
    updated_at: now,
    created_by: user.email,
    updated_by: user.email,
  };
  const insert = db
    .prepare(
      `INSERT INTO client_services (id, client_id, type_id, name, kind, details, meta, cycle, next_date, price, quantity, currency,
        job_status, invoice_when, ended_at, created_at, updated_at, created_by, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16, ?17, ?17)`
    )
    .bind(
      row.id,
      row.client_id,
      row.type_id,
      row.name,
      row.kind,
      row.details,
      row.meta,
      row.cycle,
      row.next_date,
      row.price,
      row.quantity,
      row.currency,
      row.job_status,
      row.invoice_when,
      row.ended_at,
      now,
      user.email
    );
  return { ok: true, value: { row, insert } };
}

/** The invoice line for one service: a renewal period, a month of visits, or the job itself. */
function itemsFor(service: ServiceRow, client: ClientRow, settings: SettingsMap, from: number | null): InvoiceItem[] {
  const fmt = (ms: number) => formatDate(ms, settings.date_format);
  const name = from === null ? service.name : renewalLine(service, client.website, from, fmt);
  const qty = service.kind === 'job' ? Number(service.quantity) || 1 : 1;
  return [{ name: name.slice(0, 200), desc: service.details.slice(0, 2000), qty, unitPrice: Number(service.price) || 0 }];
}

/** Does this change of job status draft the job's invoice (once)? */
function jobNeedsDraft(service: ServiceRow, from: JobStatus | '', to: JobStatus | '', type: ServiceTypeRow | null, rules: ClientRules): boolean {
  if (service.kind !== 'job' || service.invoice_id || from === to || !(Number(service.price) > 0)) return false;
  const when = jobInvoiceWhen(service, type, rules);
  if (when === 'delivered') return to === 'delivered';
  if (when === 'start') return to === 'in_progress' || (to === 'delivered' && from === 'not_started');
  return false;
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
  const [, rows, services, unpaid] = await db.batch([
    markOverdue(db, now),
    db.prepare(`SELECT * FROM clients WHERE ${where} ORDER BY name COLLATE NOCASE`).bind(...params),
    db.prepare(
      `SELECT s.client_id, s.name, s.next_date, t.part FROM client_services s
       LEFT JOIN service_types t ON t.id = s.type_id WHERE s.ended_at IS NULL`
    ),
    db.prepare(`SELECT client_id, total, payments, status FROM invoices WHERE client_id IS NOT NULL AND ${UNPAID}`),
  ]);

  const byClient = new Map<string, { count: number; parts: Set<string>; next: number | null; nextName: string | null }>();
  for (const s of services.results as { client_id: string; name: string; next_date: number | null; part: string | null }[]) {
    const entry = byClient.get(s.client_id) ?? { count: 0, parts: new Set<string>(), next: null, nextName: null };
    entry.count += 1;
    entry.parts.add(s.part ?? 'other');
    if (s.next_date !== null && (entry.next === null || s.next_date < entry.next)) {
      entry.next = s.next_date;
      entry.nextName = s.name;
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
      services: s?.count ?? 0,
      parts: s ? Array.from(s.parts) : [],
      next_date: s?.next ?? null,
      next_name: s?.nextName ?? null,
      unpaid: round2(o?.amount ?? 0),
      overdue_invoices: o?.overdue ?? 0,
    };
  });
  const counts: Record<string, number> = { all: list.length, prospect: 0, active: 0, past: 0 };
  for (const client of list) counts[client.status] = (counts[client.status] ?? 0) + 1;
  return c.json({ clients: list, counts });
});

/** Runs today's reminders and invoice drafts now (admins). Reminders already sent today are not sent again. */
clients.post('/daily-run', requireAdmin, async (c) => c.json(await dailyRun(c.env)));

/** Every client's active services that have a date, soonest first (the Due dates page). */
clients.get('/due', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, c.name AS client_name, t.part FROM client_services s
     JOIN clients c ON c.id = s.client_id
     LEFT JOIN service_types t ON t.id = s.type_id
     WHERE s.ended_at IS NULL AND s.next_date IS NOT NULL AND c.archived = 0
     ORDER BY s.next_date ASC`
  ).all<DueRow>();
  return c.json({ services: results });
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
  const tagProblem = await unknownTag(db, user, input.tags);
  if (tagProblem) return c.json({ error: tagProblem }, 400);
  const [settings, types] = await Promise.all([getSettings(db), loadTypes(db)]);
  const rules = clientRules(settings);
  const id = `cli_${nanoid(10)}`;
  const client: ClientRow = {
    id,
    name: input.name,
    contact_name: input.contact_name ?? '',
    email: input.email ?? '',
    phone: input.phone ?? '',
    whatsapp: input.whatsapp ? 1 : 0,
    website: input.website ?? '',
    status: input.status ?? 'active',
    tags: JSON.stringify(input.tags ?? []),
    notes: input.notes ?? '',
    service_notes: input.service_notes ?? '',
    logins: input.logins ?? '',
    billing_address: input.billing_address ?? '',
    tax_id: input.tax_id ?? '',
    archived: 0,
    created_at: now,
    updated_at: now,
  };

  const built: ServiceRow[] = [];
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO clients (id, name, contact_name, email, phone, whatsapp, website, status, tags, notes, service_notes, logins,
          billing_address, tax_id, created_at, updated_at, created_by, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16, ?16)`
      )
      .bind(id, client.name, client.contact_name, client.email, client.phone, client.whatsapp, client.website, client.status, client.tags,
        client.notes, client.service_notes, client.logins, client.billing_address, client.tax_id, now, user.email),
  ];
  for (const [index, raw] of rawServices.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return c.json({ error: `Service ${index + 1} is invalid` }, 400);
    const input = parseServiceInput(raw as Record<string, unknown>);
    if (!input.ok) return c.json({ error: input.error }, 400);
    const service = buildService(db, types, id, input.value, settings, user, now);
    if (!service.ok) return c.json({ error: service.error }, 400);
    built.push(service.value.row);
    statements.push(service.value.insert);
  }
  // A job saved already started or delivered drafts its invoice now, as if its status had moved.
  const drafts = await jobDrafts(db, settings, user, client, built, types, rules, now);
  if ('error' in drafts) return c.json({ error: drafts.error }, 409);
  statements.push(...drafts.statements);
  statements.push(
    activity(db, user, {
      action: 'created',
      type: 'client',
      id,
      label: client.name,
      detail: built.length ? built.map((s) => s.name).join(', ') : '',
    }, now)
  );
  await db.batch(statements);
  return c.json({ client: await db.prepare('SELECT * FROM clients WHERE id = ?1').bind(id).first<ClientRow>() }, 201);
});

async function jobDrafts(
  db: D1Database,
  settings: SettingsMap,
  user: CurrentUser,
  client: ClientRow,
  services: ServiceRow[],
  types: Map<string, ServiceTypeRow>,
  rules: ClientRules,
  now: number
): Promise<{ statements: D1PreparedStatement[] } | { error: string }> {
  const statements: D1PreparedStatement[] = [];
  for (const service of services) {
    if (!jobNeedsDraft(service, 'not_started', service.job_status, types.get(service.type_id) ?? null, rules)) continue;
    // Each draft takes the next number; several in one save must not collide.
    const draft = await draftInvoiceStatements(db, settings, user, {
      client,
      serviceId: service.id,
      items: itemsFor(service, client, settings, null),
      currency: service.currency,
    }, now);
    if (!draft) return { error: 'Could not find a free invoice number. Check "Next number" in Settings → Invoice.' };
    settings.inv_next_number = String(draft.advanceTo);
    statements.push(...draft.statements, db.prepare('UPDATE client_services SET invoice_id = ?1 WHERE id = ?2').bind(draft.id, service.id));
  }
  return { statements };
}

clients.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const now = Date.now();
  const [, found, services, invoices, notes] = await db.batch([
    markOverdue(db, now),
    db.prepare('SELECT * FROM clients WHERE id = ?1').bind(id),
    db.prepare(
      `SELECT s.*, t.part FROM client_services s LEFT JOIN service_types t ON t.id = s.type_id
       WHERE s.client_id = ?1 ORDER BY s.ended_at IS NOT NULL, s.next_date IS NULL, s.next_date, s.created_at`
    ).bind(id),
    db.prepare('SELECT * FROM invoices WHERE client_id = ?1 ORDER BY issued_at DESC, created_at DESC LIMIT 50').bind(id),
    db.prepare('SELECT * FROM client_notes WHERE client_id = ?1 ORDER BY at DESC LIMIT 50').bind(id),
  ]);
  const client = (found.results as ClientRow[])[0];
  if (!client) return c.json({ error: 'Client not found' }, 404);
  const [settings, types] = await Promise.all([getSettings(db), loadTypes(db)]);
  const rows = services.results as ServiceRow[];
  const invoiceRows = invoices.results as InvoiceRow[];
  const year = new Date(now).getUTCFullYear();
  const billed = invoiceRows.filter((inv) => inv.status !== 'draft' && inv.status !== 'cancelled' && new Date(inv.issued_at).getUTCFullYear() === year);
  return c.json({
    client,
    services: rows,
    invoices: invoiceRows,
    notes: notes.results as ClientNote[],
    coming_up: comingUp(rows, types, clientRules(settings), now),
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
  website: 'website',
  status: 'status',
  tags: 'tags',
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
  const tagProblem = await unknownTag(db, user, input.tags, parseTags(existing.tags));
  if (tagProblem) return c.json({ error: tagProblem }, 400);
  const archived = body.archived === undefined ? existing.archived : body.archived === true ? 1 : 0;

  const next: Record<keyof ClientInput, unknown> = {
    name: input.name ?? existing.name,
    contact_name: input.contact_name ?? existing.contact_name,
    email: input.email ?? existing.email,
    phone: input.phone ?? existing.phone,
    whatsapp: input.whatsapp === undefined ? existing.whatsapp : input.whatsapp ? 1 : 0,
    website: input.website ?? existing.website,
    status: input.status ?? existing.status,
    tags: input.tags === undefined ? existing.tags : JSON.stringify(input.tags),
    notes: input.notes ?? existing.notes,
    service_notes: input.service_notes ?? existing.service_notes,
    logins: input.logins ?? existing.logins,
    billing_address: input.billing_address ?? existing.billing_address,
    tax_id: input.tax_id ?? existing.tax_id,
  };
  const statements = [
    db
      .prepare(
        `UPDATE clients SET name = ?1, contact_name = ?2, email = ?3, phone = ?4, whatsapp = ?5, website = ?6, status = ?7, tags = ?8,
          notes = ?9, service_notes = ?10, logins = ?11, billing_address = ?12, tax_id = ?13, archived = ?14, updated_at = ?15, updated_by = ?16
         WHERE id = ?17`
      )
      .bind(next.name, next.contact_name, next.email, next.phone, next.whatsapp, next.website, next.status, next.tags, next.notes,
        next.service_notes, next.logins, next.billing_address, next.tax_id, archived, now, user.email, id),
  ];
  const fields = changedFields(existing as unknown as Record<string, unknown>, { ...next, whatsapp: next.whatsapp } as Record<string, unknown>, CLIENT_FIELDS);
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
    db.prepare('DELETE FROM client_services WHERE client_id = ?1').bind(id),
    db.prepare('DELETE FROM client_notes WHERE client_id = ?1').bind(id),
    db.prepare('UPDATE invoices SET client_id = NULL, service_id = NULL WHERE client_id = ?1').bind(id),
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
  const built = buildService(db, types, id, parsed.value, settings, user, now);
  if (!built.ok) return c.json({ error: built.error }, 400);
  const drafts = await jobDrafts(db, settings, user, client, [built.value.row], types, clientRules(settings), now);
  if ('error' in drafts) return c.json({ error: drafts.error }, 409);
  await db.batch([
    built.value.insert,
    ...drafts.statements,
    db.prepare('UPDATE clients SET updated_at = ?1, updated_by = ?2 WHERE id = ?3').bind(now, user.email, id),
    activity(db, user, { action: 'added service', type: 'client', id, label: client.name, detail: built.value.row.name }, now),
  ]);
  return c.json({ service: await serviceById(db, built.value.row.id) }, 201);
});

const serviceById = (db: D1Database, id: string) =>
  db.prepare('SELECT s.*, t.part FROM client_services s LEFT JOIN service_types t ON t.id = s.type_id WHERE s.id = ?1').bind(id).first<ServiceRow>();

async function serviceAndClient(c: Ctx) {
  const db = c.env.DB;
  const service = await serviceById(db, c.req.param('sid') ?? '');
  if (!service) return null;
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?1').bind(service.client_id).first<ClientRow>();
  return client ? { service, client } : null;
}

const SERVICE_FIELDS: Record<string, string> = {
  name: 'name',
  details: 'details',
  meta: 'details',
  cycle: 'billing cycle',
  next_date: 'date',
  price: 'price',
  quantity: 'quantity',
  currency: 'currency',
  job_status: 'status',
  invoice_when: 'invoice choice',
};

clients.patch('/services/:sid', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseServiceInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  const found = await serviceAndClient(c);
  if (!found) return c.json({ error: 'Service not found' }, 404);
  const { service, client } = found;
  const db = c.env.DB;
  const user = c.var.user;
  const now = Date.now();
  if (input.kind !== undefined && input.kind !== service.kind) {
    return c.json({ error: 'How a service works cannot change. Remove it and add it again.' }, 400);
  }
  if (input.name !== undefined && !input.name) return c.json({ error: 'Give the service a name' }, 400);
  if (service.kind !== 'job' && input.cycle === 'once') return c.json({ error: 'Pick yearly or monthly' }, 400);

  const jobStatus = service.kind === 'job' ? input.job_status ?? service.job_status : '';
  let endedAt = service.ended_at;
  if (body.ended === true && endedAt === null) endedAt = now;
  if (body.ended === false) endedAt = null;
  if (service.kind === 'job' && jobStatus !== service.job_status) endedAt = jobStatus === 'delivered' ? now : null;

  const next: ServiceRow = {
    ...service,
    name: input.name ?? service.name,
    details: input.details ?? service.details,
    meta: input.meta === undefined ? service.meta : JSON.stringify(input.meta),
    cycle: service.kind === 'job' ? 'once' : input.cycle ?? service.cycle,
    next_date: input.next_date === undefined ? service.next_date : input.next_date,
    price: input.price ?? service.price,
    quantity: input.quantity ?? service.quantity,
    currency: input.currency ?? service.currency,
    job_status: jobStatus,
    invoice_when: service.kind === 'job' ? input.invoice_when ?? service.invoice_when : '',
    ended_at: endedAt,
  };

  const statements: D1PreparedStatement[] = [];
  let invoice: { id: string; number: string } | null = null;
  const [settings, types] = await Promise.all([getSettings(db), loadTypes(db)]);
  if (jobNeedsDraft(next, service.job_status, jobStatus, types.get(service.type_id) ?? null, clientRules(settings))) {
    const draft = await draftInvoiceStatements(db, settings, user, {
      client,
      serviceId: service.id,
      items: itemsFor(next, client, settings, null),
      currency: next.currency,
    }, now);
    if (!draft) return c.json({ error: 'Could not find a free invoice number. Check "Next number" in Settings → Invoice.' }, 409);
    next.invoice_id = draft.id;
    invoice = { id: draft.id, number: draft.number };
    statements.push(...draft.statements);
  }
  statements.unshift(
    db
      .prepare(
        `UPDATE client_services SET name = ?1, details = ?2, meta = ?3, cycle = ?4, next_date = ?5, price = ?6, quantity = ?7, currency = ?8,
          job_status = ?9, invoice_when = ?10, ended_at = ?11, invoice_id = ?12, updated_at = ?13, updated_by = ?14
         WHERE id = ?15`
      )
      .bind(next.name, next.details, next.meta, next.cycle, next.next_date, next.price, next.quantity, next.currency, next.job_status,
        next.invoice_when, next.ended_at, next.invoice_id, now, user.email, service.id)
  );
  const action =
    jobStatus !== service.job_status && jobStatus === 'delivered'
      ? 'delivered'
      : endedAt !== service.ended_at
        ? endedAt
          ? 'ended service'
          : 'restored service'
        : 'updated service';
  const fields = changedFields(service as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, SERVICE_FIELDS);
  if (fields || action !== 'updated service') {
    statements.push(activity(db, user, { action, type: 'client', id: client.id, label: client.name, detail: `${next.name}${fields && action === 'updated service' ? `: ${fields}` : ''}` }, now));
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
    db.prepare('UPDATE invoices SET service_id = NULL WHERE service_id = ?1').bind(found.service.id),
    db.prepare('DELETE FROM client_services WHERE id = ?1').bind(found.service.id),
    activity(db, c.var.user, { action: 'removed service', type: 'client', id: found.client.id, label: found.client.name, detail: found.service.name }),
  ]);
  return c.json({ success: true });
});

/**
 * Renew: move the date one cycle on (from the old date, not today) and, if asked, draft the renewal
 * invoice. A period that already has its invoice (drafted ahead of time) is not drafted twice.
 */
clients.post('/services/:sid/renew', async (c) => {
  const body = (await readJsonObject(c)) ?? {};
  const found = await serviceAndClient(c);
  if (!found) return c.json({ error: 'Service not found' }, 404);
  const { service, client } = found;
  if (service.kind !== 'renews') return c.json({ error: 'Only services that renew can be renewed' }, 400);
  if (service.next_date === null) return c.json({ error: 'Set the renewal date first' }, 400);
  if (service.ended_at) return c.json({ error: 'This service has ended. Restore it first.' }, 400);
  const parsed = parseServiceInput(body.price === undefined ? {} : { price: body.price });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  return moveOn(c, service, client, parsed.value.price ?? service.price, body.invoice === true, 'renewed');
});

/** A maintenance visit is done: the next one is a cycle on. Its invoice is drafted ahead of time by the daily run. */
clients.post('/services/:sid/visit', async (c) => {
  const found = await serviceAndClient(c);
  if (!found) return c.json({ error: 'Service not found' }, 404);
  const { service, client } = found;
  if (service.kind !== 'visits') return c.json({ error: 'Only maintenance plans have visits' }, 400);
  if (service.ended_at) return c.json({ error: 'This plan has ended. Restore it first.' }, 400);
  if (service.next_date === null) return c.json({ error: 'Set the next visit date first' }, 400);
  const body = (await readJsonObject(c)) ?? {};
  const done = Math.max(0, Math.min(50, Math.floor(Number(body.done_steps) || 0)));
  const total = Math.max(0, Math.min(50, Math.floor(Number(body.total_steps) || 0)));
  const note = parseMultiline(body.note ?? '', 'Note');
  if (!note.ok) return c.json({ error: note.error }, 400);
  const extra = note.value ? [noteInsert(c.env.DB, client.id, c.var.user.email, `Visit: ${note.value}`, null, Date.now())] : [];
  return moveOn(c, service, client, service.price, false, 'visit done', total ? ` · ${done} of ${total} steps done` : '', extra);
});

async function moveOn(c: Ctx, service: ServiceRow, client: ClientRow, price: number, invoice: boolean, action: string, suffix = '', extra: D1PreparedStatement[] = []) {
  const db = c.env.DB;
  const user = c.var.user;
  const now = Date.now();
  const from = service.next_date as number;
  const to = addCycle(from, service.cycle);
  const statements: D1PreparedStatement[] = [];
  let made: { id: string; number: string } | null = null;
  let invoiceId = service.invoice_id;
  let invoicedFor = service.invoiced_for;
  if (invoice && service.invoiced_for !== from) {
    if (!(price > 0)) return c.json({ error: 'Set a price first, or only move the date' }, 400);
    const settings = await getSettings(db);
    const draft = await draftInvoiceStatements(db, settings, user, {
      client,
      serviceId: service.id,
      items: itemsFor({ ...service, price }, client, settings, from),
      currency: service.currency,
    }, now);
    if (!draft) return c.json({ error: 'Could not find a free invoice number. Check "Next number" in Settings → Invoice.' }, 409);
    statements.push(...draft.statements);
    made = { id: draft.id, number: draft.number };
    invoiceId = draft.id;
    invoicedFor = from;
  }
  statements.unshift(
    db
      .prepare('UPDATE client_services SET next_date = ?1, price = ?2, invoice_id = ?3, invoiced_for = ?4, updated_at = ?5, updated_by = ?6 WHERE id = ?7')
      .bind(to, price, invoiceId, invoicedFor, now, user.email, service.id)
  );
  const settings = await getSettings(db);
  statements.push(
    activity(db, user, {
      action,
      type: 'client',
      id: client.id,
      label: client.name,
      detail: `${service.name}, next ${formatDate(to, settings.date_format)}${made ? ` · ${made.number} drafted (${fmtMoney(price, service.currency)})` : ''}${suffix}`,
    }, now),
    ...extra
  );
  await db.batch(statements);
  return c.json({ service: await serviceById(db, service.id), invoice: made, already_invoiced: invoice && !made ? service.invoice_id : null });
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
