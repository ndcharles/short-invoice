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
  /** Server only (the raw copy of what the destination says about itself); never in API responses. */
  dest_meta?: string | null;
  /** What the destination says about itself, as stored on the server; only on a single link, not in lists. */
  preview?: {
    title: string | null;
    description: string | null;
    image: string | null;
    siteName: string | null;
    state: 'ok' | 'failed' | 'pending';
    fetched_at: number;
  } | null;
  archived: number;
  clicks: number;
  last_clicked_at: number | null;
  avatar: string;
  created_at: number;
  updated_at: number;
  /** Emails of who created / last changed it; null for rows from before sign-in. */
  created_by?: string | null;
  updated_by?: string | null;
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
  /** Emails of who created / last changed it; null for rows from before sign-in. */
  created_by?: string | null;
  updated_by?: string | null;
}

export interface InvoiceRow {
  id: string;
  workspace_id: string;
  number: string;
  client_name: string;
  client_email: string;
  client_address: string;
  issued_at: number;
  due_at: number;
  currency: string;
  status: string;
  items: string;
  payments: string;
  subtotal: number;
  tax_rate: number;
  discount: number;
  discount_type: string;
  charges: number;
  payment_method: string;
  equivalent_amount: number;
  exchange_rate: number;
  total: number;
  notes: string;
  terms: string;
  folder: string;
  tag: string | null;
  avatar: string;
  created_at: number;
  updated_at: number;
  /** Emails of who created / last changed it; null for rows from before sign-in. */
  created_by?: string | null;
  updated_by?: string | null;
}
