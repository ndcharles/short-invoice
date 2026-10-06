/**
 * Row shapes returned by the API. Shared by the Worker (worker/) and the
 * static UI (src/), so this file must stay free of runtime imports.
 */

export interface LinkItem {
  id: string;
  workspace_id: string;
  domain: string;
  alias: string;
  dest: string;
  tag: string | null;
  folder: string;
  comments: string;
  cloak: number;
  /** Always null in API responses; `has_password` says whether one is set. */
  password_hash: string | null;
  has_password?: boolean;
  expires_at: number | null;
  expires_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  utm_referral: string | null;
  custom_preview: number;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  archived: number;
  clicks: number;
  last_clicked_at: number | null;
  avatar: string;
  created_at: number;
  updated_at: number;
}

export interface UtmCampaign {
  id: string;
  workspace_id: string;
  website: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  campaign_id: string | null;
  term: string | null;
  content: string | null;
  comments: string;
  folder: string;
  archived: number;
  clicks: number;
  avatar: string;
  created_at: number;
  updated_at: number;
}

export interface InvoiceRow {
  id: string;
  workspace_id: string;
  number: string;
  client_name: string;
  client_contact: string;
  client_email: string;
  client_address: string;
  reference: string;
  issued_at: number;
  due_at: number;
  currency: string;
  /** Stored status: draft | sent | partially-paid | paid | cancelled. */
  status: string;
  /** JSON array of InvoiceItem. */
  items: string;
  /** JSON array of InvoicePayment. */
  payments: string;
  subtotal: number;
  /** Fraction, e.g. 0.075. */
  tax_rate: number;
  discount: number;
  discount_type: string;
  charges: number;
  payment_method: string;
  /** Unused since the equivalent is always derived from exchange_rate. */
  equivalent_amount: number;
  /** Naira per 1 unit of the foreign currency; 0 = no equivalent shown. */
  exchange_rate: number;
  total: number;
  notes: string;
  terms: string;
  folder: string;
  tag: string | null;
  avatar: string;
  share_token: string | null;
  sent_at: number | null;
  viewed_at: number | null;
  created_at: number;
  updated_at: number;
}

/** An invoice as the API returns it: the row plus derived values. */
export interface InvoiceView extends InvoiceRow {
  display_status: 'draft' | 'sent' | 'partially-paid' | 'paid' | 'overdue' | 'cancelled';
  totals: {
    subtotal: number;
    discount: number;
    charges: number;
    tax: number;
    total: number;
    paid: number;
    balance: number;
    overpaid: number;
  };
  /** Present when an exchange rate is set. */
  equivalent: { currency: string; rate: number; total: number; balance: number } | null;
}
