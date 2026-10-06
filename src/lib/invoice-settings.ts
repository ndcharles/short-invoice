'use client';

import { useMemo } from 'react';
import { useSettings } from '@/lib/collections';
import { parseList } from '@/lib/settings-json';
import { DEFAULT_DATE_FORMAT, startOfDay } from '@/lib/dates';
import type { InvoiceRow } from '@/lib/types';
import {
  BASE_CURRENCY,
  currencyCode,
  dueDateFor,
  joinAddress,
  parseItems,
  splitAddress,
  type InvoiceStatus,
} from '@/lib/invoices';
import type { CanvasAccount, InvoiceDraft } from '@/components/invoices/invoice-canvas';

const settingOrNull = (value: string | undefined) => (!value || value === 'None' ? null : value);

/** Everything the invoice canvas reads from Settings → Invoice (and General → date format). */
export function useInvoiceSettings() {
  const settings = useSettings();
  return useMemo(() => {
    const s = settings ?? {};
    const methods = parseList<{ name: string; enabled?: boolean }>(s.inv_methods, [])
      .filter((m) => m && m.enabled !== false && m.name)
      .map((m) => m.name);
    const currencyLabels = parseList<string>(s.inv_enabled_currencies, []);
    const currencies = Array.from(new Set(currencyLabels.map((label) => currencyCode(label, '')).filter(Boolean)));
    const defaultCurrency = currencyCode(s.inv_default_currency);
    const taxPercent = Number(s.inv_tax_rate);
    const rate = Number(s.inv_usd_rate);
    return {
      loaded: settings !== null,
      accounts: parseList<CanvasAccount>(s.inv_accounts, []),
      tagline: { on: s.inv_tagline_on === 'true', text: s.inv_tagline_text ?? '', color: s.inv_tagline_color ?? '#1d4ed8' },
      logo: s.inv_logo || '',
      dateFormat: s.date_format || DEFAULT_DATE_FORMAT,
      methods,
      currencies: currencies.includes(defaultCurrency) ? currencies : [defaultCurrency, ...currencies],
      defaultCurrency,
      defaultMethod: methods.includes(s.inv_default_method ?? '') ? (s.inv_default_method as string) : methods[0] ?? 'Bank transfer',
      defaultRate: Number.isFinite(rate) && rate > 0 ? rate : 0,
      defaultTaxRate: Number.isFinite(taxPercent) && taxPercent >= 0 ? taxPercent / 100 : 0,
      defaultTerms: s.inv_terms_note ?? '',
      paymentTerms: s.inv_payment_terms ?? 'Net 30',
      defaultFolder: settingOrNull(s.inv_default_folder) ?? 'Invoices',
      defaultTag: settingOrNull(s.inv_default_tag),
      numberPreview: `${s.inv_number_prefix ?? ''}${String(Number(s.inv_next_number) || 1).padStart(
        Math.min(12, Math.max(1, Number(s.inv_number_padding) || 6)),
        '0'
      )}`,
      payTo: {
        name: s.inv_legal_name ?? '',
        addr1: s.inv_address_1 ?? '',
        addr2: s.inv_address_2 ?? '',
        email: s.inv_contact_email ?? '',
        taxId: s.inv_tax_id ?? '',
      },
      /** SMTP is set up when a host and a sender address are saved. */
      emailReady: !!(s.smtp_host && s.smtp_from_email),
      copyEmail: s.smtp_reply_to || s.inv_contact_email || '',
      emails: {
        invoiceSubject: s.inv_email_invoice_subject ?? '',
        invoiceBody: s.inv_email_invoice_body ?? '',
        receiptSubject: s.inv_email_receipt_subject ?? '',
        receiptBody: s.inv_email_receipt_body ?? '',
      },
      raw: s,
    };
  }, [settings]);
}

export type InvoiceSettings = ReturnType<typeof useInvoiceSettings>;

/** A blank invoice with every default from Settings applied. */
export function newInvoiceDraft(cfg: InvoiceSettings, now = Date.now()): InvoiceDraft {
  const issuedAt = startOfDay(now);
  return {
    number: cfg.numberPreview,
    clientName: '',
    clientContact: '',
    clientAddr1: '',
    clientAddr2: '',
    clientCountry: '',
    clientEmail: '',
    issuedAt,
    dueAt: dueDateFor(issuedAt, cfg.paymentTerms),
    currency: cfg.defaultCurrency || BASE_CURRENCY,
    status: 'draft' as InvoiceStatus,
    items: [{ name: '', desc: '', qty: 1, unitPrice: 0 }],
    charges: 0,
    discount: 0,
    discountType: 'value',
    equivalentAmount: 0,
    exchangeRate: 0,
    taxRate: cfg.defaultTaxRate,
    terms: cfg.defaultTerms,
    notes: '',
    paymentMethod: cfg.defaultMethod,
    folder: cfg.defaultFolder,
    tag: cfg.defaultTag,
  };
}

/** Editable draft for a stored invoice. */
export function draftFromInvoice(invoice: InvoiceRow): InvoiceDraft {
  const address = splitAddress(invoice.client_address);
  const items = parseItems(invoice.items);
  const rate = Number(invoice.tax_rate ?? 0);
  // Older rows store a grand total with no line items: show it as one
  // "Services" line so the canvas totals match what was billed.
  const effectiveItems =
    items.length > 0
      ? items
      : Number(invoice.total) > 0
        ? [{ name: 'Services', desc: '', qty: 1, unitPrice: Math.round((Number(invoice.total) / (1 + rate)) * 100) / 100 }]
        : [{ name: '', desc: '', qty: 1, unitPrice: 0 }];

  return {
    number: invoice.number,
    clientName: invoice.client_name,
    clientContact: address.contact,
    clientAddr1: address.addr1,
    clientAddr2: address.addr2,
    clientCountry: address.country,
    clientEmail: invoice.client_email ?? '',
    issuedAt: invoice.issued_at,
    dueAt: invoice.due_at,
    currency: invoice.currency,
    status: invoice.status as InvoiceStatus,
    items: effectiveItems,
    charges: Number(invoice.charges ?? 0),
    discount: Number(invoice.discount ?? 0),
    discountType: invoice.discount_type === 'percent' ? 'percent' : 'value',
    equivalentAmount: Number(invoice.equivalent_amount ?? 0),
    exchangeRate: Number(invoice.exchange_rate ?? 0),
    taxRate: rate,
    terms: invoice.terms ?? '',
    notes: invoice.notes ?? '',
    paymentMethod: invoice.payment_method ?? '',
    folder: invoice.folder || 'Invoices',
    tag: invoice.tag ?? null,
  };
}

/** API body for a draft. Totals and status are derived on the server. */
export function invoicePayload(draft: InvoiceDraft) {
  return {
    number: draft.number.trim(),
    client_name: draft.clientName.trim(),
    client_email: draft.clientEmail.trim(),
    client_address: joinAddress({
      name: draft.clientName,
      contact: draft.clientContact,
      addr1: draft.clientAddr1,
      addr2: draft.clientAddr2,
      country: draft.clientCountry,
    }),
    issued_at: draft.issuedAt,
    due_at: draft.dueAt,
    currency: draft.currency,
    status: draft.status,
    items: draft.items,
    tax_rate: draft.taxRate,
    discount: draft.discount,
    discount_type: draft.discountType,
    charges: draft.charges,
    payment_method: draft.paymentMethod,
    equivalent_amount: draft.exchangeRate > 0 ? draft.equivalentAmount : 0,
    exchange_rate: draft.exchangeRate,
    notes: draft.notes,
    terms: draft.terms,
    folder: draft.folder,
    tag: draft.tag,
  };
}

/** Client-side check before saving; the server repeats every rule. */
export function draftProblem(draft: InvoiceDraft): string | null {
  if (!draft.clientName.trim()) return 'Add the client name under "Invoiced To".';
  if (!draft.number.trim()) return 'The invoice needs a number.';
  if (draft.dueAt < draft.issuedAt) return 'The due date cannot be before the invoice date.';
  if (draft.clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.clientEmail.trim())) {
    return 'The client email does not look right.';
  }
  if (draft.discountType === 'percent' && draft.discount > 100) return 'A percentage discount cannot exceed 100%.';
  return null;
}
