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
  it('logs a client with a website (domain and hosting ticked) and a maintenance plan', async () => {
    const renews = todayUtc() + 200 * DAY;
    const client = await createClient({
      website: 'lagosfresh.example',
      status: 'active',
      services: [
        {
          type_id: 'st_website',
          next_at: renews,
          amount: 45_000,
          parts: [
            { part: 'website', provider: 'WordPress' },
            { part: 'domain', provider: 'Namecheap' },
            { part: 'hosting', provider: 'Hetzner' },
            { part: 'email', provider: 'not allowed on a website' },
          ],
        },
        { type_id: 'st_maintenance', next_at: todayUtc() + 20 * DAY, amount: 15_000, parts: [{ part: 'website' }, { part: 'hosting' }] },
      ],
    });
    const { services, coming_up } = await detail(client.id);
    expect(services.map((s) => s.name).sort()).toEqual(['Maintenance plan', 'Website']);
    const site = services.find((s) => s.type_id === 'st_website')!;
    expect(site).toMatchObject({ recurs: 'renews', repeats: 'yearly', amount: 45_000, next_at: renews, type_part: 'website', status: 'not_started' });
    expect(site.parts!.map((p) => `${p.part}:${p.provider}`).sort()).toEqual(['domain:Namecheap', 'hosting:Hetzner', 'website:WordPress']);
    const plan = services.find((s) => s.type_id === 'st_maintenance')!;
    expect(plan).toMatchObject({ recurs: 'scheduled', repeats: 'monthly' });
    expect(plan.parts!.map((p) => p.part).sort()).toEqual(['hosting', 'website']);
    expect(coming_up.some((e) => e.kind === 'scheduled')).toBe(true);
  });

  it('keeps a separate WhatsApp number, and has no tags', async () => {
    const client = await createClient({ phone: '+234 801 000 0000', whatsapp: false, whatsapp_number: '+234 901 222 3344' });
    expect(client).toMatchObject({ whatsapp: 0, whatsapp_number: '+234 901 222 3344' });
    expect('tags' in client).toBe(false);
  });

  it('requires a name, a name for "Something else", and a next date for a schedule', async () => {
    expect((await api('POST', '/api/clients', { name: '' })).status).toBe(400);
    const res = await api('POST', '/api/clients', { name: 'X', services: [{ type_id: 'st_other', mode: 'oneoff' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
    const plan = await api('POST', '/api/clients', { name: 'X', services: [{ type_id: 'st_maintenance', mode: 'scheduled' }] });
    expect(plan.status).toBe(400);
    expect(plan.body.error).toMatch(/next date/i);
    // Website and Email have no "how it works": they renew when a renewal date is set.
    const site = await api('POST', '/api/clients', { name: 'X', services: [{ type_id: 'st_website', mode: 'scheduled' }] });
    expect(site.status).toBe(201);
    expect((await detail(site.body.client.id)).services[0]).toMatchObject({ recurs: null, next_at: null });
  });

  it('lists clients with their services as words and the next date', async () => {
    const soon = todayUtc() + 3 * DAY;
    const client = await createClient({ services: [{ type_id: 'st_website', next_at: soon, amount: 22_000 }, { type_id: 'st_email' }] });
    const res = await api('GET', `/api/clients?search=${encodeURIComponent(client.name)}`);
    expect(res.status).toBe(200);
    const row = res.body.clients.find((c: { id: string }) => c.id === client.id);
    expect(row).toMatchObject({ service_names: ['Website', 'Email'], next_date: soon });
    expect(row.next_what).toMatch(/Website renews/);
    const due = await api('GET', '/api/clients/due');
    expect(due.body.rows.some((r: { service: ServiceRow; what: string }) => r.service.client_id === client.id && r.what === 'renews')).toBe(true);
  });

  it('renews from the old date and drafts the renewal invoice once', async () => {
    const date = todayUtc() - 5 * DAY;
    const client = await createClient({
      website: 'renew.example',
      services: [{ type_id: 'st_website', next_at: date, amount: 22_000, status: 'delivered', parts: [{ part: 'domain', provider: 'Namecheap' }] }],
    });
    const service = (await detail(client.id)).services[0];
    const res = await api('POST', `/api/clients/services/${service.id}/renew`, { invoice: true, amount: 24_000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.invoice.number).toBeTruthy();
    const moved = res.body.service as ServiceRow;
    expect(new Date(moved.next_at!).getUTCFullYear()).toBe(new Date(date).getUTCFullYear() + 1);
    expect(moved.amount).toBe(24_000);
    expect(moved.invoiced).toContain(date);
    const invoice = (await api('GET', `/api/invoices/${res.body.invoice.id}`)).body.invoice as InvoiceRow & { service_for: number };
    expect(invoice).toMatchObject({ status: 'draft', client_name: client.name, subtotal: 24_000, service_for: date });
    expect(JSON.parse(invoice.items)[0].name).toMatch(/^Website \(domain\) renewal: renew\.example, /);
    expect((await detail(client.id)).invoices.map((i) => i.id)).toContain(invoice.id);
  });

  it('marks a scheduled date done and moves on one period', async () => {
    const date = Date.UTC(2026, 0, 31);
    const client = await createClient({ services: [{ type_id: 'st_maintenance', next_at: date, amount: 1 }] });
    const service = (await detail(client.id)).services[0];
    const res = await api('POST', `/api/clients/services/${service.id}/done`);
    expect(res.status).toBe(200);
    expect(res.body.service.next_at).toBe(Date.UTC(2026, 1, 28));
    const quarterly = await api('PATCH', `/api/clients/services/${service.id}`, { repeats: 'quarterly' });
    expect(quarterly.body.service).toMatchObject({ recurs: 'scheduled', repeats: 'quarterly' });
    const again = await api('POST', `/api/clients/services/${service.id}/done`);
    expect(again.body.service.next_at).toBe(Date.UTC(2026, 4, 28));
    expect((await api('POST', `/api/clients/services/${service.id}/renew`, {})).status).toBe(400);
  });

  it('drafts the invoice for the work when it is delivered, and only once', async () => {
    const client = await createClient({
      services: [{ type_id: 'st_other', name: 'Staff training day', mode: 'oneoff', amount: 120_000, due_at: todayUtc() + 10 * DAY }],
    });
    const job = (await detail(client.id)).services[0];
    expect(job).toMatchObject({ recurs: null, status: 'not_started', quantity: 1 });
    const started = await api('PATCH', `/api/clients/services/${job.id}`, { status: 'in_progress' });
    expect(started.body.invoice).toBeNull();
    const delivered = await api('PATCH', `/api/clients/services/${job.id}`, { status: 'delivered' });
    expect(delivered.status).toBe(200);
    const invoice = (await api('GET', `/api/invoices/${delivered.body.invoice.id}`)).body.invoice as InvoiceRow;
    expect(JSON.parse(invoice.items)[0]).toMatchObject({ name: 'Staff training day', qty: 1, unitPrice: 120_000 });
    await api('PATCH', `/api/clients/services/${job.id}`, { status: 'in_progress' });
    const again = await api('PATCH', `/api/clients/services/${job.id}`, { status: 'delivered' });
    expect(again.body.invoice).toBeNull();
  });

  it('builds a website with a due date and then renews it yearly; cancelling ends it', async () => {
    const client = await createClient({
      services: [{ type_id: 'st_website', due_at: todayUtc() + 14 * DAY, amount: 300_000, next_at: todayUtc() + 380 * DAY }],
    });
    const site = (await detail(client.id)).services[0];
    expect(site).toMatchObject({ recurs: 'renews', status: 'not_started' });
    const delivered = await api('PATCH', `/api/clients/services/${site.id}`, { status: 'delivered' });
    expect(delivered.body.invoice.number).toBeTruthy();
    expect(delivered.body.service.invoiced).toContain('due');
    // No renewal date any more: a one-off website.
    const oneoff = await api('PATCH', `/api/clients/services/${site.id}`, { next_at: null });
    expect(oneoff.body.service).toMatchObject({ recurs: null, next_at: null });
    const cancelled = await api('PATCH', `/api/clients/services/${site.id}`, { status: 'cancelled' });
    expect(cancelled.body.service.ended_at).toBeTruthy();
  });

  it('prices "each" types by quantity', async () => {
    const made = (await api('POST', '/api/service-types', { name: `Bulk certs ${Date.now()}`, price: 200, price_unit: 'each' })).body.type as ServiceTypeRow;
    const client = await createClient({ services: [{ type_id: made.id, mode: 'oneoff', quantity: 350 }] });
    expect((await detail(client.id)).services[0]).toMatchObject({ quantity: 350, amount: 200, recurs: null });
  });

  it('lets members add and edit clients but not delete them', async () => {
    const res = await api('POST', '/api/clients', { name: 'By a member' }, MEMBER);
    expect(res.status).toBe(201);
    expect((await api('DELETE', `/api/clients/${res.body.client.id}`, undefined, MEMBER)).status).toBe(403);
    expect((await api('DELETE', `/api/clients/${res.body.client.id}`)).status).toBe(200);
    expect((await api('GET', `/api/clients/${res.body.client.id}`)).status).toBe(404);
  });
});

describe('service types', () => {
  it('lists the built-ins (domain and hosting are part of Website) and lets admins add their own', async () => {
    const list = (await api('GET', '/api/service-types', undefined, MEMBER)).body.types as ServiceTypeRow[];
    const ids = list.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['st_website', 'st_email', 'st_maintenance', 'st_other']));
    expect(ids).not.toContain('st_domain');
    expect(ids).not.toContain('st_hosting');
    expect((await api('POST', '/api/service-types', { name: 'LMS setup' }, MEMBER)).status).toBe(403);
    const made = await api('POST', '/api/service-types', { name: `LMS setup ${Date.now()}`, price: 450_000, reminder_days: '7, 1, 7' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.type).toMatchObject({ price: 450_000, reminder_days: '7,1', used: 0, show_in_add: 1 });
    expect('kind' in made.body.type).toBe(false);
  });

  it('hides a type from the Add list, and refuses to delete one in use or built in', async () => {
    const made = (await api('POST', '/api/service-types', { name: `Bulk email ${Date.now()}` })).body.type as ServiceTypeRow;
    await createClient({ services: [{ type_id: made.id, mode: 'renews', next_at: todayUtc() + 40 * DAY }] });
    const renamed = await api('PATCH', `/api/service-types/${made.id}`, { name: `${made.name} v2`, show_in_add: false });
    expect(renamed.body.type).toMatchObject({ show_in_add: 0, used: 1 });
    expect((await api('DELETE', `/api/service-types/${made.id}`)).status).toBe(400);
    expect((await api('DELETE', '/api/service-types/st_website')).status).toBe(400);
  });
});

describe('daily run', () => {
  it('drafts renewal invoices ahead of time, once', async () => {
    const client = await createClient({ services: [{ type_id: 'st_website', next_at: todayUtc() + 10 * DAY, amount: 18_000, status: 'delivered' }] });
    const first = await api('POST', '/api/clients/daily-run');
    expect(first.status).toBe(200);
    expect(first.body.drafted.some((d: { client: string }) => d.client === client.name)).toBe(true);
    const second = await api('POST', '/api/clients/daily-run');
    expect(second.body.drafted.some((d: { client: string }) => d.client === client.name)).toBe(false);
    const service = (await detail(client.id)).services[0];
    expect(service.invoiced).toContain(service.next_at);
    // Renewing that period does not draft a second invoice for it.
    const renewed = await api('POST', `/api/clients/services/${service.id}/renew`, { invoice: true });
    expect(renewed.body.invoice).toBeNull();
    expect(renewed.body.already_invoiced).toBe(true);
  });

  it('collects today\'s reminders (no mail server in tests)', async () => {
    const client = await createClient({ services: [{ type_id: 'st_email', next_at: todayUtc() + 7 * DAY, status: 'delivered' }] });
    const res = await api('POST', '/api/clients/daily-run');
    expect(res.body.reminders.some((r: { client: string; days_before: number }) => r.client === client.name && r.days_before === 7), JSON.stringify(res.body)).toBe(true);
    expect(res.body.email).toBe('not set up');
    expect((await api('POST', '/api/clients/daily-run', {}, MEMBER)).status).toBe(403);
  });
});

describe('notes, schedules and import', () => {
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

  it('records a scheduled date done with its checklist result and note', async () => {
    const client = await createClient({ services: [{ type_id: 'st_maintenance', next_at: todayUtc(), amount: 1, parts: [{ part: 'domain' }, { part: 'email' }] }] });
    const plan = (await detail(client.id)).services[0];
    const res = await api('POST', `/api/clients/services/${plan.id}/done`, { done_steps: 2, total_steps: 3, note: 'DNS fine' });
    expect(res.status).toBe(200);
    const notes = (await api('GET', `/api/clients/${client.id}`)).body.notes;
    expect(notes[0].text).toBe('Maintenance plan: DNS fine');
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
