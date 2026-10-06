'use client';

import { parseList } from '@/lib/settings-json';
import { currencyCode, dueDateFromTerms, formatInvoiceNumber } from '@/lib/invoices';
import { startOfDay } from '@/lib/dates';
import type { DocumentAccount } from '@/lib/invoice-document';
import type { InvoiceDraft, PayToProfile } from '@/components/invoices/invoice-editor';
import type { InvoiceView } from '@/lib/types';

type Settings = Record<string, string> | null;

export function payToFrom(settings: Settings): PayToProfile {
  return {
    name: settings?.inv_legal_name || settings?.workspace_name || '',
    address1: settings?.inv_address_1 ?? '',
    address2: settings?.inv_address_2 ?? '',
    email: settings?.inv_contact_email ?? '',
    taxId: settings?.inv_tax_id ?? '',
    logo: settings?.inv_logo ?? '',
  };
}

export const accountsFrom = (settings: Settings) => parseList<DocumentAccount>(settings?.inv_accounts, []);

export const methodsFrom = (settings: Settings) =>
  parseList<{ name: string; enabled?: boolean }>(settings?.inv_methods, [])
    .filter((m) => m.enabled !== false && m.name)
    .map((m) => m.name);

export const defaultRateFrom = (settings: Settings) => Number(settings?.inv_usd_rate) || 0;

export function nextNumberPreview(settings: Settings): string {
  return formatInvoiceNumber(
    settings?.inv_number_prefix ?? '',
    Number(settings?.inv_number_padding) || 6,
    Number(settings?.inv_next_number) || 1
  );
}

/** A blank invoice with every default from Settings → Invoice applied. */
export function newDraft(settings: Settings, now = Date.now()): InvoiceDraft {
  const issued = startOfDay(now);
  const folder = settings?.inv_default_folder;
  const tag = settings?.inv_default_tag;
  return {
    number: '',
    client_name: '',
    client_contact: '',
    client_email: '',
    client_address: '',
    reference: '',
    issued_at: issued,
    due_at: startOfDay(dueDateFromTerms(settings?.inv_payment_terms, issued)),
    currency: currencyCode(settings?.inv_default_currency),
    items: [{ name: '', desc: '', qty: 1, unitPrice: 0 }],
    discount: 0,
    discount_type: 'value',
    charges: 0,
    tax_rate: (Number(settings?.inv_tax_rate ?? 7.5) || 0) / 100,
    exchange_rate: 0,
    notes: '',
    terms: settings?.inv_terms_note ?? '',
    folder: folder && folder !== 'None' ? folder : 'Invoices',
    tag: tag && tag !== 'None' ? tag : null,
  };
}

export function draftFromInvoice(invoice: InvoiceView): InvoiceDraft {
  let items: InvoiceDraft['items'] = [];
  try {
    items = JSON.parse(invoice.items || '[]');
  } catch {
    items = [];
  }
  return {
    number: invoice.number,
    client_name: invoice.client_name,
    client_contact: invoice.client_contact ?? '',
    client_email: invoice.client_email ?? '',
    client_address: invoice.client_address ?? '',
    reference: invoice.reference ?? '',
    issued_at: invoice.issued_at,
    due_at: invoice.due_at,
    currency: invoice.currency,
    items,
    discount: Number(invoice.discount) || 0,
    discount_type: invoice.discount_type === 'percent' ? 'percent' : 'value',
    charges: Number(invoice.charges) || 0,
    tax_rate: Number(invoice.tax_rate) || 0,
    exchange_rate: Number(invoice.exchange_rate) || 0,
    notes: invoice.notes ?? '',
    terms: invoice.terms ?? '',
    folder: invoice.folder,
    tag: invoice.tag,
  };
}

/** The draft as an API payload; a blank number lets the server assign one. */
export function payloadFromDraft(draft: InvoiceDraft): Record<string, unknown> {
  const { number, items, ...rest } = draft;
  return {
    ...rest,
    ...(number.trim() ? { number: number.trim() } : {}),
    // Blank trailing lines are dropped rather than saved as empty rows.
    items: items.filter((item) => item.name.trim() || item.desc.trim() || item.unitPrice > 0),
  };
}
