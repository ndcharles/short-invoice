-- People who can use the app, and who did what.
--
-- Cloudflare Access proves who someone is; the Worker decides whether they
-- may use the app: admins come from the ADMIN_EMAILS secret, members from an
-- allowed email domain (Settings → Team) or an invite. A removed person keeps
-- a row with status 'removed' so a domain rule cannot let them back in.
CREATE TABLE users (
  email TEXT PRIMARY KEY,           -- lower-case
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',   -- 'admin' | 'member' (admins: ADMIN_EMAILS)
  status TEXT NOT NULL DEFAULT 'active', -- 'invited' | 'active' | 'removed'
  source TEXT NOT NULL DEFAULT 'invite', -- 'admin' | 'domain' | 'invite'
  invited_by TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- Who created and last changed each record (emails; NULL for older rows).
ALTER TABLE links ADD COLUMN created_by TEXT;
ALTER TABLE links ADD COLUMN updated_by TEXT;
ALTER TABLE utms ADD COLUMN created_by TEXT;
ALTER TABLE utms ADD COLUMN updated_by TEXT;
ALTER TABLE invoices ADD COLUMN created_by TEXT;
ALTER TABLE invoices ADD COLUMN updated_by TEXT;
ALTER TABLE invoice_emails ADD COLUMN sent_by TEXT;

-- One row per change, newest first in Settings → Team.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,              -- email
  action TEXT NOT NULL,             -- created | updated | deleted | archived | restored | payment | emailed | …
  entity_type TEXT NOT NULL,        -- link | utm | invoice | settings | team | folder | tag | domain
  entity_id TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',   -- e.g. "4th.link/launch" or "INV-000123"
  detail TEXT NOT NULL DEFAULT ''   -- e.g. "destination, tag" or "₦50,000.00"
);

-- Backs the feed (newest first) and its per-person filter.
CREATE INDEX idx_activity_at ON activity (at);
CREATE INDEX idx_activity_actor ON activity (actor, at);
