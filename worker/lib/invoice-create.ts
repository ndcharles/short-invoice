import { nanoid } from 'nanoid';
import { currencyCode, draftTotals, dueDateFor, fmtMoney, type InvoiceItem } from '../../src/lib/invoices';
import { startOfDay } from '../../src/lib/dates';
import { invoiceAddressOf, type ClientRow } from '../../src/lib/clients';
import type { SettingsMap } from './settings';
import type { CurrentUser } from './auth';
import { activity } from './activity';

/**
 * Issued invoices become overdue the day after their due date. One UPDATE
 * that only writes rows that actually change, run before every read so lists,
 * counts and the status filter always agree.
 */
export const markOverdue = (db: D1Database, now: number) =>
  db
    .prepare("UPDATE invoices SET status = 'overdue', updated_at = ?1 WHERE status = 'sent' AND due_at < ?2")
    .bind(now, startOfDay(now));

const settingOrNull = (value: string | undefined) => (!value || value === 'None' ? null : value);

/** Defaults for a new invoice, all taken from Settings → Invoice. */
export function invoiceDefaults(settings: SettingsMap, now: number) {
  const methods = (() => {
    try {
      const list = JSON.parse(settings.inv_methods || '[]') as { name?: string; enabled?: boolean }[];
      return list.filter((m) => m && m.enabled !== false && m.name).map((m) => String(m.name));
    } catch {
      return [];
    }
  })();
  const taxPercent = Number(settings.inv_tax_rate);
  const issuedAt = startOfDay(now);
  return {
    issued_at: issuedAt,
    due_at: dueDateFor(issuedAt, settings.inv_payment_terms),
    currency: currencyCode(settings.inv_default_currency),
    tax_rate: Number.isFinite(taxPercent) && taxPercent >= 0 && taxPercent <= 100 ? taxPercent / 100 : 0,
    terms: settings.inv_terms_note ?? '',
    payment_method: methods.includes(settings.inv_default_method) ? settings.inv_default_method : methods[0] ?? 'Bank transfer',
    folder: settingOrNull(settings.inv_default_folder) ?? 'Invoices',
    tag: settingOrNull(settings.inv_default_tag),
  };
}

export async function numberTaken(db: D1Database, number: string, exceptId = ''): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM invoices WHERE number = ?1 AND id != ?2 LIMIT 1').bind(number, exceptId).first();
  return !!row;
}

/**
 * The next free number in the configured sequence (skipping any already in use) and the value
 * "Next number" moves to. Null when 20 tries in a row are taken.
 */
export async function nextInvoiceNumber(db: D1Database, settings: SettingsMap): Promise<{ number: string; advanceTo: number } | null> {
  const padding = Math.min(12, Math.max(1, Number(settings.inv_number_padding) || 6));
  let next = Math.max(1, Math.floor(Number(settings.inv_next_number) || 1));
  for (let attempt = 0; attempt < 20; attempt += 1, next += 1) {
    const number = `${settings.inv_number_prefix ?? ''}${String(next).padStart(padding, '0')}`;
    if (!(await numberTaken(db, number))) return { number, advanceTo: next + 1 };
  }
  return null;
}

export const advanceNumberStatement = (db: D1Database, advanceTo: number, now: number) =>
  db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('inv_next_number', ?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(String(advanceTo), now);

export interface DraftFor {
  client: Pick<ClientRow, 'id' | 'name' | 'contact_name' | 'email' | 'address_street' | 'address_city' | 'address_country'>;
  serviceId: string;
  /** The renewal or scheduled date this invoice covers; null for the work itself. */
  serviceFor: number | null;
  items: InvoiceItem[];
  currency: string;
}

/**
 * A draft invoice for a client's service, with every default from Settings → Invoice. Returns the
 * statements to run in the caller's batch (so the service update and the invoice land together), or
 * null when no invoice number is free. `user` null means the daily run made it.
 */
export async function draftInvoiceStatements(
  db: D1Database,
  settings: SettingsMap,
  user: CurrentUser | null,
  draft: DraftFor,
  now: number
): Promise<{ id: string; number: string; advanceTo: number; statements: D1PreparedStatement[] } | null> {
  const allocated = await nextInvoiceNumber(db, settings);
  if (!allocated) return null;
  const defaults = invoiceDefaults(settings, now);
  const totals = draftTotals({ items: draft.items, discount: 0, discountType: 'value', charges: 0, taxRate: defaults.tax_rate });
  const id = `inv_${nanoid(10)}`;
  const by = user?.email ?? null;
  const statements = [
    db
      .prepare(
        `INSERT INTO invoices (id, number, client_name, client_email, client_address, issued_at, due_at, currency, status,
          items, payments, subtotal, tax_rate, discount, total, notes, terms, folder, tag, avatar, created_at, updated_at,
          discount_type, charges, payment_method, equivalent_amount, exchange_rate, created_by, updated_by, client_id, service_id, service_for)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', ?9, '[]', ?10, ?11, 0, ?12, '', ?13, ?14, ?15, ?16, ?17, ?17,
          'value', 0, ?18, 0, 0, ?19, ?19, ?20, ?21, ?22)`
      )
      .bind(
        id,
        allocated.number,
        draft.client.name,
        draft.client.email,
        invoiceAddressOf(draft.client),
        defaults.issued_at,
        defaults.due_at,
        draft.currency,
        JSON.stringify(draft.items),
        totals.subtotal,
        defaults.tax_rate,
        totals.grand,
        defaults.terms,
        defaults.folder,
        defaults.tag,
        user?.initials ?? 'CT',
        now,
        defaults.payment_method,
        by,
        draft.client.id,
        draft.serviceId,
        draft.serviceFor
      ),
    advanceNumberStatement(db, allocated.advanceTo, now),
  ];
  if (user) {
    statements.push(
      activity(db, user, {
        action: 'created',
        type: 'invoice',
        id,
        label: allocated.number,
        detail: `${draft.client.name} · ${fmtMoney(totals.grand, draft.currency)} (draft)`,
      }, now)
    );
  }
  return { id, number: allocated.number, advanceTo: allocated.advanceTo, statements };
}
