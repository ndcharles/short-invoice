export type SettingsMap = Record<string, string>;

/**
 * Defaults for every setting. The `settings` table only stores overrides, so
 * a fresh database needs no seed rows and new keys need no migration.
 * Business details here are placeholders: real values are entered in
 * Settings and live in D1, never in the repo.
 */
export const DEFAULT_SETTINGS: Record<string, string> = {
  workspace_name: 'My workspace',
  workspace_logo: '',
  date_format: '19 Mar 2026',
  profile_name: '',
  profile_email: '',

  // URL shortener
  default_domain: '4th.link',
  root_redirect: '',
  default_folder: 'Links',
  default_expiration: 'Never expire',
  default_tags: '[]',
  default_cloak: 'false',
  // Short-link domains. A domain starts "pending" and becomes "active" once
  // it is attached to the Worker and Settings → Verify succeeds.
  shortener_domains: JSON.stringify([{ id: 'dom_4th', name: '4th.link', status: 'pending', added: 0 }]),

  // UTM builder
  utm_default_source: 'newsletter',
  utm_default_medium: 'email',
  utm_default_campaign: '',
  utm_default_folder: 'Campaigns',
  utm_default_tag: 'None',
  utm_presets: JSON.stringify([
    { id: 'pre_google', badge: 'G', color: '#4285F4', name: 'Google Ads', source: 'google', medium: 'cpc', campaign: '', content: '{ad_id}' },
    { id: 'pre_linkedin', badge: 'L', color: '#0a66c2', name: 'LinkedIn Sponsored', source: 'linkedin', medium: 'social', campaign: '{name}', content: '' },
    { id: 'pre_newsletter', badge: 'N', color: '#d97706', name: 'Newsletter', source: 'newsletter', medium: 'email', campaign: '', content: '{position}' },
    { id: 'pre_x', badge: 'X', color: '#000000', name: 'X / Twitter', source: 'x', medium: 'social', campaign: '{name}', content: '' },
  ]),
  utm_encoding: 'Standard (RFC 3986)',
  utm_space: '%20',
  utm_lowercase: 'true',
  utm_strip_existing: 'false',

  // Invoicing
  inv_legal_name: 'Your Company Ltd',
  inv_tax_id: '',
  inv_address_1: '1 Example Street',
  inv_address_2: 'Ikeja, Lagos',
  inv_contact_email: 'billing@example.com',
  inv_logo: '',
  inv_default_folder: 'None',
  inv_default_tag: 'None',
  inv_default_currency: 'NGN',
  inv_tax_rate: '7.5',
  inv_usd_rate: '1500',
  inv_accounts: JSON.stringify([
    {
      id: 'acc_ngn',
      title: 'Naira account',
      currency: 'NGN',
      bank: 'Your bank',
      accountName: 'Your Company Ltd',
      accountNumber: '0000000000',
      extraLabel: 'Sort code / Branch',
      extraValue: '',
    },
    {
      id: 'acc_usd',
      title: 'Dollar account',
      currency: 'USD',
      bank: 'Your bank',
      accountName: 'Your Company Ltd',
      accountNumber: '0000000000',
      extraLabel: 'SWIFT / BIC',
      extraValue: '',
    },
  ]),
  inv_methods: JSON.stringify([
    { id: 'mth_transfer', name: 'Bank transfer', enabled: true },
    { id: 'mth_paystack', name: 'Paystack', enabled: true },
    { id: 'mth_card', name: 'Card', enabled: true },
    { id: 'mth_cash', name: 'Cash', enabled: true },
    { id: 'mth_wire', name: 'International wire', enabled: true },
    { id: 'mth_cheque', name: 'Cheque', enabled: false },
  ]),
  inv_payment_terms: 'Net 30',
  inv_terms_note: 'Payment is due within 30 days of the invoice date. Please quote the invoice number as your transfer reference.',
  inv_number_prefix: 'INV-',
  inv_number_padding: '5',
  inv_next_number: '1',
  inv_tagline_on: 'false',
  inv_tagline_text: 'Thank you for your business',
  inv_tagline_color: '#1d4ed8',
  inv_email_invoice_subject: 'Invoice {number}',
  inv_email_invoice_body:
    'Hi {client},\n\nPlease find invoice {number} for {amount}, due on {due}.\n\nView it and download a PDF here: {link}\nPayment details are on the invoice. Reply to this email with any questions.\n\nThank you.',
  inv_email_receipt_subject: 'Receipt for invoice {number}',
  inv_email_receipt_body:
    'Hi {client},\n\nThank you for your payment on {payment_date}. Your receipt for invoice {number} is here: {link}\n\nBalance remaining: {balance}.\n\nThank you.',
};
