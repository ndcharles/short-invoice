-- One row per invoice/receipt email attempt (sent or failed). Shown on the
-- invoice, and counted for the daily sending cap. The message body and the
-- PDFs are not stored.
CREATE TABLE invoice_emails (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  recipients TEXT NOT NULL,      -- comma-separated To + Cc
  subject TEXT NOT NULL,
  attachments TEXT NOT NULL,     -- e.g. "invoice,receipt"
  status TEXT NOT NULL,          -- 'sent' | 'failed'
  error TEXT
);

-- Backs the per-invoice history query.
CREATE INDEX idx_invoice_emails_invoice ON invoice_emails (invoice_id, sent_at);
