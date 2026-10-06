import type { DocumentAccount, DocumentProfile } from '../../src/lib/invoice-document';
import type { SettingsMap } from './settings';

function parseAccounts(value: string | undefined): DocumentAccount[] {
  try {
    const list = JSON.parse(value || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter((a) => a && typeof a === 'object')
      .map((a) => ({
        title: String(a.title ?? ''),
        currency: String(a.currency ?? ''),
        bank: String(a.bank ?? ''),
        accountName: String(a.accountName ?? ''),
        accountNumber: String(a.accountNumber ?? ''),
        extraLabel: String(a.extraLabel ?? ''),
        extraValue: String(a.extraValue ?? ''),
      }));
  } catch {
    return [];
  }
}

/** The "pay to" side of every invoice, from Settings → Invoice. */
export function invoiceProfile(settings: SettingsMap): DocumentProfile {
  return {
    name: settings.inv_legal_name || settings.workspace_name || '',
    address1: settings.inv_address_1 ?? '',
    address2: settings.inv_address_2 ?? '',
    email: settings.inv_contact_email ?? '',
    taxId: settings.inv_tax_id ?? '',
    logo: settings.inv_logo || '',
    accounts: parseAccounts(settings.inv_accounts),
    tagline: {
      on: settings.inv_tagline_on === 'true',
      text: settings.inv_tagline_text ?? '',
      color: settings.inv_tagline_color ?? '#1d4ed8',
    },
    dateFormat: settings.date_format ?? '19 Mar 2026',
  };
}
