export type SettingsMap = Record<string, string>;

/**
 * Defaults for every setting. The `settings` table only stores overrides, so
 * a fresh database needs no seed rows and new keys need no migration.
 * Business details here are placeholders: real values are entered in
 * Settings and live in D1, never in the repo.
 */
export const DEFAULT_SETTINGS: Record<string, string> = {
  workspace_name: 'Acme Inc.',
  workspace_logo: '',
  timezone: 'Africa / Lagos (GMT+1)',
  date_format: 'Mar 19, 2026',
  language: 'English (United Kingdom)',
  profile_name: 'ndcharles',
  profile_email: 'nd@acme.co',

  // URL shortener
  default_domain: '4th.link',
  root_redirect: '',
  default_folder: 'Links',
  default_expiration: 'Never expire',
  default_tags: '[]',
  default_cloak: 'false',
  custom_preview_fallback: 'true',
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
  inv_default_currency: 'NGN (₦)',
  inv_enabled_currencies: JSON.stringify(['NGN (₦)', 'USD ($)', 'EUR (€)', 'GBP (£)']),
  inv_currency_options: JSON.stringify(['NGN (₦)', 'USD ($)', 'EUR (€)', 'GBP (£)', 'CAD (C$)', 'ZAR (R)', 'KES (KSh)']),
  inv_tax_rate: '7.5',
  inv_usd_rate: '1500',
  inv_accounts: JSON.stringify([
    {
      id: 'acc_ngn',
      title: 'Naira account',
      symbol: '₦',
      currency: 'NGN',
      bank: 'Guaranty Trust Bank',
      accountName: 'Your Company Ltd',
      accountNumber: '0123456789',
      extraLabel: 'Sort code / Branch',
      extraValue: 'GTB · Ikeja',
    },
    {
      id: 'acc_usd',
      title: 'USD account',
      symbol: '$',
      currency: 'USD',
      bank: 'Wise (US)',
      accountName: 'Your Company Ltd',
      accountNumber: '9600 0000 0000 12',
      extraLabel: 'Routing / SWIFT',
      extraValue: 'CMFGUS33',
    },
    {
      id: 'acc_gbp',
      title: 'GBP account',
      symbol: '£',
      currency: 'GBP',
      bank: 'Wise (UK)',
      accountName: 'Your Company Ltd',
      accountNumber: 'GB29 NWBK 6016 1331 9268 19',
      extraLabel: 'Routing / SWIFT',
      extraValue: 'NWBKGB2L',
    },
    {
      id: 'acc_eur',
      title: 'Euro account',
      symbol: '€',
      currency: 'EUR',
      bank: 'Wise (EU)',
      accountName: 'Your Company Ltd',
      accountNumber: 'BE71 0961 2345 6769',
      extraLabel: 'IBAN / BIC',
      extraValue: 'TRWIBEB1XXX',
    },
  ]),
  inv_methods: JSON.stringify([
    { id: 'mth_cash', name: 'Cash', uses: 32, enabled: true },
    { id: 'mth_transfer', name: 'Bank transfer', uses: 18, enabled: true },
    { id: 'mth_card', name: 'Card', uses: 11, enabled: true },
    { id: 'mth_paystack', name: 'Paystack', uses: 7, enabled: true },
    { id: 'mth_wire', name: 'Wire transfer', uses: 4, enabled: true },
    { id: 'mth_cheque', name: 'Cheque', uses: 2, enabled: true },
    { id: 'mth_other', name: 'Other', uses: 0, enabled: false },
  ]),
  inv_payment_terms: 'Net 30',
  inv_terms_note: 'Net 30. Late payments accrue 1.5% interest per month.',
  inv_number_prefix: '4th-',
  inv_number_padding: '6',
  inv_next_number: '435431',
  inv_tagline_on: 'true',
  inv_tagline_text: 'May the 4th be with you!',
  inv_tagline_color: '#1d4ed8',
  inv_email_invoice_subject: 'Your invoice from Your Company Ltd',
  inv_email_invoice_body:
    'Hi {client},\n\nPlease find invoice {number} attached, due on {due}. Total amount: {amount}.\n\nPayment details are inside the invoice. Reply to this email with any questions.\n\nThanks,\nYour Company Ltd',
  inv_email_receipt_subject: 'Receipt for your recent payment',
  inv_email_receipt_body:
    'Hi {client},\n\nThanks for your payment of {amount} on {payment_date}. Attached is your receipt for invoice {number}.\n\nBest,\nYour Company Ltd',
};
