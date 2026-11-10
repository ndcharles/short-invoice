import type { ServicePart, ServiceRow } from '../../src/lib/clients';

const SERVICE_SELECT = 'SELECT s.*, t.part AS type_part FROM client_services s LEFT JOIN service_types t ON t.id = s.type_id';

/**
 * Services (one, one client's, or every active one) with what they include (`parts`) and the dates that already
 * have an invoice (`invoiced`: a renewal / scheduled date, or 'due' for the work itself). Three reads in one batch.
 */

export async function loadServices(db: D1Database, filter: { client?: string; service?: string; active?: boolean }): Promise<ServiceRow[]> {
  const where = filter.service ? 's.id = ?1' : filter.client ? 's.client_id = ?1' : "s.ended_at IS NULL AND s.status != 'cancelled'";
  const binds = filter.service ? [filter.service] : filter.client ? [filter.client] : [];
  const partWhere = filter.service ? 'p.service_id = ?1' : filter.client ? 's.client_id = ?1' : "s.ended_at IS NULL AND s.status != 'cancelled'";
  const invWhere = filter.service ? 'service_id = ?1' : filter.client ? 'client_id = ?1 AND service_id IS NOT NULL' : 'service_id IS NOT NULL';
  const [services, parts, invoiced] = await db.batch([
    db.prepare(`${SERVICE_SELECT} WHERE ${where} ORDER BY s.created_at`).bind(...binds),
    db.prepare(`SELECT p.* FROM service_parts p JOIN client_services s ON s.id = p.service_id WHERE ${partWhere}`).bind(...binds),
    db.prepare(`SELECT service_id, service_for FROM invoices WHERE ${invWhere} AND status != 'cancelled'`).bind(...binds),
  ]);
  const partsBy = new Map<string, ServicePart[]>();
  for (const p of parts.results as (ServicePart & { service_id: string })[]) {
    partsBy.set(p.service_id, [...(partsBy.get(p.service_id) ?? []), { part: p.part, provider: p.provider, count: p.count }]);
  }
  const invoicedBy = new Map<string, (number | 'due')[]>();
  for (const i of invoiced.results as { service_id: string; service_for: number | null }[]) {
    invoicedBy.set(i.service_id, [...(invoicedBy.get(i.service_id) ?? []), i.service_for ?? 'due']);
  }
  return (services.results as ServiceRow[]).map((s) => ({ ...s, parts: partsBy.get(s.id) ?? [], invoiced: invoicedBy.get(s.id) ?? [] }));
}

export const serviceById = async (db: D1Database, id: string) => (await loadServices(db, { service: id }))[0] ?? null;
