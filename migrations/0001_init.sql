-- Initial schema for Cloudflare D1.
--
-- Free-tier notes (D1 bills rows read and rows written, including index rows):
--   * Every index is extra writes on insert/update, so only indexes that back
--     a real query are kept. UNIQUE(domain, alias) already gives the redirect
--     lookup its index.
--   * Clicks are rolled up per link/day/dimension in `link_clicks_daily`
--     instead of one row per click. A click is one upsert plus one counter
--     update, and analytics reads stay bounded no matter how many clicks
--     accumulate.

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'ws_default',
  domain TEXT NOT NULL DEFAULT '4th.link',
  alias TEXT NOT NULL,
  dest TEXT NOT NULL,
  tag TEXT,
  folder TEXT NOT NULL DEFAULT 'Links',
  comments TEXT DEFAULT '',
  cloak INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  expires_at INTEGER,
  expires_url TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  utm_referral TEXT,
  custom_preview INTEGER NOT NULL DEFAULT 0,
  og_title TEXT,
  og_description TEXT,
  og_image TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_clicked_at INTEGER,
  avatar TEXT NOT NULL DEFAULT 'NC',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (domain, alias)
);

CREATE INDEX idx_links_list ON links (archived, created_at);

CREATE TABLE link_clicks_daily (
  link_id TEXT NOT NULL,
  day TEXT NOT NULL,        -- UTC, YYYY-MM-DD
  country TEXT NOT NULL,    -- ISO code from cf.country, 'XX' when unknown
  device TEXT NOT NULL,
  browser TEXT NOT NULL,
  os TEXT NOT NULL,
  referer TEXT NOT NULL,    -- referring host only, or 'Direct'
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day, country, device, browser, os, referer)
) WITHOUT ROWID;

CREATE INDEX idx_clicks_daily_day ON link_clicks_daily (day);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT 'green',
  created_at INTEGER NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT 'blue',
  created_at INTEGER NOT NULL
);

-- Key/value overrides. Anything missing falls back to DEFAULT_SETTINGS in
-- worker/lib/settings.ts, so a fresh database needs no rows here.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE utms (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'ws_default',
  website TEXT NOT NULL,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  campaign_id TEXT,
  term TEXT,
  content TEXT,
  comments TEXT DEFAULT '',
  folder TEXT NOT NULL DEFAULT 'Campaigns',
  archived INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  avatar TEXT NOT NULL DEFAULT 'NC',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_utms_list ON utms (archived, created_at);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'ws_default',
  number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT DEFAULT '',
  client_address TEXT DEFAULT '',
  issued_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'draft',
  items TEXT NOT NULL DEFAULT '[]',
  payments TEXT NOT NULL DEFAULT '[]',
  subtotal REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'value',
  charges REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT '',
  equivalent_amount REAL NOT NULL DEFAULT 0,
  exchange_rate REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  terms TEXT DEFAULT '',
  folder TEXT NOT NULL DEFAULT 'Invoices',
  tag TEXT,
  avatar TEXT NOT NULL DEFAULT 'NC',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_invoices_issued ON invoices (issued_at);

-- Folders each module falls back to.
INSERT INTO folders (id, name, color, created_at) VALUES
  ('fld_links', 'Links', 'green', 0),
  ('fld_campaigns', 'Campaigns', 'green', 0),
  ('fld_invoices', 'Invoices', 'green', 0);
