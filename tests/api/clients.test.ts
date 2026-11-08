import { beforeAll, describe, expect, it } from 'vitest';
import { api } from './helpers';
import type { ClientRow, ServiceRow, ServiceTypeRow } from '@/lib/clients';
import type { InvoiceRow } from '@/lib/types';

const DAY = 86_400_000;
const todayUtc = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const MEMBER_EMAIL = `member-clients-${Date.now()}@test.example`;
const MEMBER = { 'x-dev-user': MEMBER_EMAIL };

beforeAll(async () => {
  expect((await api('POST', '/api/team/invites', { email: MEMBER_EMAIL })).status).toBe(201);
});

let counter = 0;
async function createClient(body: Record<string, unknown> = {}) {
  counter += 1;
  const res = await api('POST', '/api/clients', { name: `Client tracker ${counter}`, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.client as ClientRow;
}
async function detail(id: string) {
  const res = await api('GET', `/api/clients/${id}`);
  expect(res.status).toBe(200);
  return res.body as { client: ClientRow; services: ServiceRow[]; invoices: InvoiceRow[]; coming_up: { kind: string; text: string }[] };
}

describe('clients', () => {
  it('logs a client with only the parts they have with us', async () => {
    const renews = todayUtc() + 200 * DAY;
    const client = await createClient({
      website: 'lagosfresh.example',
      status: 'active',
      services: [
        { type_id: 'st_website', meta: { built_with: 'WordPress' } },
        { type_id: 'st_hosting', next_date: renews, price: 45_000, meta: { provider: 'Hetzner', plan: 'Business' } },
        { type_id: 'st_maintenance', next_date: todayUtc() + 20 * DAY, price: 15_000, meta: { looks_after: ['Website', 'Hosting', 'Nope'] } },
      ],
    });
    const { services, coming_up } = await detail(client.id);
    expect(services.map((s) => s.name).sort()).toEqual(['Hosting', 'Maintenance plan', 'Website']);
    const hosting = services.find((s) => s.type_id === 'st_hosting')!;
    expect(hosting).toMatchObject({ kind: 'renews', cycle: 'yearly', price: 45_000, next_date: renews, part: 'hosting' });
    const plan = services.find((s) => s.type_id === 'st_maintenance')!;
    expect(plan).toMatchObject({ kind: 'visits', cycle: 'monthly' });
    expect(JSON.parse(plan.meta).looks_after).toEqual(['Website', 'Hosting']);
    expect(coming_up.some((e) => e.kind === 'visit')).toBe(true);
  });

  it('requires a name, and a name for "Something else"', async () => {
    expect((await api('POST', '/api/clients', { name: '' })).status).toBe(400);
    const res = await api('POST', '/api/clients', { name: 'X', services: [{ type_id: 'st_other', kind: 'job' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('lists clients with their next date and services', async () => {
    const soon = todayUtc() + 3 * DAY;
    const client = await createClient({ services: [{ type_id: 'st_domain', next_date: soon, price: 22_000 }] });
    const res = await api('GET', `/api/clients?search=${encodeURIComponent(client.name)}`);
    expect(res.status).toBe(200);
    const row = res.body.clients.find((c: { id: string }) => c.id === client.id);
    expect(row).toMatchObject({ services: 1, next_date: soon, next_name: 'Domain', parts: ['domain'] });
    const due = await api('GET', '/api/clients/due');
    expect(due.body.services.some((s: { client_id: string }) => s.client_id === client.id)).toBe(true);
  });

  it('renews from the old date and drafts the renewal invoice once', async () => {
    const date = todayUtc() - 5 * DAY;
    const client = await createClient({ website: 'renew.example', services: [{ type_id: 'st_domain', next_date: date, price: 22_000 }] });
    const service = (await detail(client.id)).services[0];
    const res = await api('POST', `/api/clients/services/${service.id}/renew`, { invoice: true, price: 24_000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.invoice.number).toBeTruthy();
    const moved = res.body.service as ServiceRow;
    expect(new Date(moved.next_date!).getUTCFullYear()).toBe(new Date(date).getUTCFullYear() + 1);
    expect(moved.price).toBe(24_000);
    const invoice = (await api('GET', `/api/invoices/${res.body.invoice.id}`)).body.invoice as InvoiceRow;
    expect(invoice).toMatchObject({ status: 'draft', client_name: client.name, subtotal: 24_000 });
    expect(JSON.parse(invoice.items)[0].name).toMatch(/^Domain renewal: renew\.example, /);
    expect((await detail(client.id)).invoices.map((i) => i.id)).toContain(invoice.id);
  });

  it('marks a visit done and moves to the next month', async () => {
    const date = Date.UTC(2026, 0, 31);
    const client = await createClient({ services: [{ type_id: 'st_maintenance', next_date: date, price: 1 }] });
    const service = (await detail(client.id)).services[0];
    const res = await api('POST', `/api/clients/services/${service.id}/visit`);
    expect(res.status).toBe(200);
    expect(res.body.service.next_date).toBe(Date.UTC(2026, 1, 28));
  });

  it('drafts a job invoice when the job is delivered, and only once', async () => {
    const client = await createClient({
      services: [{ type_id: 'st_other', name: 'Staff training day', kind: 'job', quantity: 2, price: 120_000, next_date: todayUtc() + 10 * DAY }],
    });
    const job = (await detail(client.id)).services[0];
    expect(job).toMatchObject({ kind: 'job', job_status: 'not_started', cycle: 'once' });
    const started = await api('PATCH', `/api/clients/services/${job.id}`, { job_status: 'in_progress' });
    expect(started.body.invoice).toBeNull();
    const delivered = await api('PATCH', `/api/clients/services/${job.id}`, { job_status: 'delivered' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.service.ended_at).toBeTruthy();
    const invoice = (await api('GET', `/api/invoices/${delivered.body.invoice.id}`)).body.invoice as InvoiceRow;
    expect(JSON.parse(invoice.items)[0]).toMatchObject({ name: 'Staff training day', qty: 2, unitPrice: 120_000 });
    await api('PATCH', `/api/clients/services/${job.id}`, { job_status: 'in_progress' });
    const again = await api('PATCH', `/api/clients/services/${job.id}`, { job_status: 'delivered' });
    expect(again.body.invoice).toBeNull();
  });

  it('keeps how a service works fixed', async () => {
    const client = await createClient({ services: [{ type_id: 'st_hosting', next_date: todayUtc() + 30 * DAY }] });
    const service = (await detail(client.id)).services[0];
    expect((await api('PATCH', `/api/clients/services/${service.id}`, { kind: 'job' })).status).toBe(400);
    expect((await api('PATCH', `/api/clients/services/${service.id}`, { cycle: 'once' })).status).toBe(400);
  });

  it('lets members add and edit clients but not delete them or invent tags', async () => {
    const res = await api('POST', '/api/clients', { name: 'By a member' }, MEMBER);
    expect(res.status).toBe(201);
    expect((await api('POST', '/api/clients', { name: 'Tagged', tags: ['No such tag xyz'] }, MEMBER)).status).toBe(400);
    expect((await api('DELETE', `/api/clients/${res.body.client.id}`, undefined, MEMBER)).status).toBe(403);
    expect((await api('DELETE', `/api/clients/${res.body.client.id}`)).status).toBe(200);
    expect((await api('GET', `/api/clients/${res.body.client.id}`)).status).toBe(404);
  });
});

describe('service types', () => {
  it('lists the built-ins and lets admins add their own', async () => {
    const list = (await api('GET', '/api/service-types', undefined, MEMBER)).body.types as ServiceTypeRow[];
    expect(list.map((t) => t.id)).toEqual(expect.arrayContaining(['st_website', 'st_domain', 'st_hosting', 'st_email', 'st_maintenance', 'st_other']));
    expect((await api('POST', '/api/service-types', { name: 'LMS setup', kind: 'job' }, MEMBER)).status).toBe(403);
    const made = await api('POST', '/api/service-types', { name: `LMS setup ${Date.now()}`, kind: 'job', price: 450_000, reminder_days: '7, 1, 7' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.type).toMatchObject({ kind: 'job', cycle: 'once', reminder_days: '7,1', used: 0 });
  });

  it('fixes how a type works once it is used, and refuses to delete it', async () => {
    const made = (await api('POST', '/api/service-types', { name: `Bulk certs ${Date.now()}`, kind: 'job', price: 200, price_unit: 'each' })).body.type;
    await createClient({ services: [{ type_id: made.id, quantity: 350 }] });
    expect((await api('PATCH', `/api/service-types/${made.id}`, { kind: 'renews' })).status).toBe(400);
    const renamed = await api('PATCH', `/api/service-types/${made.id}`, { name: `${made.name} v2`, show_in_add: false });
    expect(renamed.body.type).toMatchObject({ show_in_add: 0, used: 1 });
    expect((await api('DELETE', `/api/service-types/${made.id}`)).status).toBe(400);
    expect((await api('DELETE', '/api/service-types/st_domain')).status).toBe(400);
  });
});

describe('daily run', () => {
  it('drafts renewal invoices ahead of time, once', async () => {
    const client = await createClient({ services: [{ type_id: 'st_domain', next_date: todayUtc() + 10 * DAY, price: 18_000 }] });
    const first = await api('POST', '/api/clients/daily-run');
    expect(first.status).toBe(200);
    expect(first.body.drafted.some((d: { client: string }) => d.client === client.name)).toBe(true);
    const second = await api('POST', '/api/clients/daily-run');
    expect(second.body.drafted.some((d: { client: string }) => d.client === client.name)).toBe(false);
    const service = (await detail(client.id)).services[0];
    expect(service.invoiced_for).toBe(service.next_date);
    // Renewing that period does not draft a second invoice for it.
    const renewed = await api('POST', `/api/clients/services/${service.id}/renew`, { invoice: true });
    expect(renewed.body.invoice).toBeNull();
    expect(renewed.body.already_invoiced).toBe(service.invoice_id);
  });

  it('collects today\'s reminders (no mail server in tests)', async () => {
    const client = await createClient({ services: [{ type_id: 'st_hosting', next_date: todayUtc() + 7 * DAY }] });
    const res = await api('POST', '/api/clients/daily-run');
    expect(res.body.reminders.some((r: { client: string; days_before: number }) => r.client === client.name && r.days_before === 7), JSON.stringify(res.body)).toBe(true);
    expect(res.body.email).toBe('not set up');
    expect((await api('POST', '/api/clients/daily-run', {}, MEMBER)).status).toBe(403);
  });
});

describe('notes, visits and import', () => {
  it('keeps notes, and a note with a reminder date shows up in the daily run until it is done', async () => {
    const client = await createClient();
    const today = new Date(todayUtc()).toISOString().slice(0, 10);
    const res = await api('POST', `/api/clients/${client.id}/notes`, { text: 'Promised to pay by Friday', remind_at: today });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const note = res.body.notes[0];
    expect(note).toMatchObject({ text: 'Promised to pay by Friday', remind_at: todayUtc(), done: 0 });
    expect((await api('POST', `/api/clients/${client.id}/notes`, { text: '' })).status).toBe(400);
    const run = await api('POST', '/api/clients/daily-run');
    expect(run.body.reminders.some((r: { text: string; client: string }) => r.client === client.name && r.text.startsWith('Note: Promised'))).toBe(true);
    await api('PATCH', `/api/clients/notes/${note.id}`, { done: true });
    const after = await api('POST', '/api/clients/daily-run');
    expect(after.body.reminders.some((r: { client: string }) => r.client === client.name)).toBe(false);
    // Someone else's note: a member cannot delete it.
    expect((await api('DELETE', `/api/clients/notes/${note.id}`, undefined, MEMBER)).status).toBe(403);
    expect((await api('DELETE', `/api/clients/notes/${note.id}`)).status).toBe(200);
  });

  it('records a visit with its checklist result and note', async () => {
    const client = await createClient({ services: [{ type_id: 'st_maintenance', next_date: todayUtc(), price: 1, meta: { looks_after: ['Domain', 'Email'] } }] });
    const plan = (await detail(client.id)).services[0];
    const res = await api('POST', `/api/clients/services/${plan.id}/visit`, { done_steps: 2, total_steps: 3, note: 'DNS fine' });
    expect(res.status).toBe(200);
    const notes = (await api('GET', `/api/clients/${client.id}`)).body.notes;
    expect(notes[0].text).toBe('Visit: DNS fine');
  });

  it('imports clients from invoices and links their invoices', async () => {
    const name = `Invoice-only client ${Date.now()}`;
    const inv = await api('POST', '/api/invoices', { client_name: name, client_email: 'billing@invoiceonly.example', items: [{ name: 'Work', desc: '', qty: 1, unitPrice: 1000 }] });
    expect(inv.status).toBe(201);
    const list = await api('GET', '/api/clients/import/candidates');
    expect(list.body.candidates.some((c: { name: string }) => c.name === name)).toBe(true);
    expect((await api('GET', '/api/clients/import/candidates', undefined, MEMBER)).status).toBe(403);
    const done = await api('POST', '/api/clients/import', { names: [name] });
    expect(done.body.imported).toBe(1);
    const found = (await api('GET', `/api/clients?search=${encodeURIComponent(name)}`)).body.clients[0];
    expect(found.email).toBe('billing@invoiceonly.example');
    expect((await detail(found.id)).invoices.map((i) => i.id)).toContain(inv.body.invoice.id);
    const again = await api('GET', '/api/clients/import/candidates');
    expect(again.body.candidates.some((c: { name: string }) => c.name === name)).toBe(false);
  });
});
