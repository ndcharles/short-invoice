-- Client tracker: clients, the services each one has with us, and the service types they are made from.
--
-- Free-tier notes: only indexes that back a real query. The due list reads active services by date
-- (partial index, ended rows are not in it); a client's page reads its services by client_id.

-- What you sell. Every type works one of three ways (`kind`): it renews on a date, it is visited on a
-- schedule, or it is a one-off job. "Something else" (`kind = 'any'`) lets each service pick its own way.
CREATE TABLE service_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- renews | visits | job | any
  part TEXT,                                -- built-ins: website | domain | hosting | email | maintenance | ssl | other
  cycle TEXT NOT NULL DEFAULT 'yearly',     -- yearly | monthly | once
  price REAL NOT NULL DEFAULT 0,            -- default price for new services (0 = not set)
  price_unit TEXT NOT NULL DEFAULT 'once',  -- jobs: once | each
  reminder_days TEXT NOT NULL DEFAULT '',   -- "60,30,14,7"; empty = the workspace default for its kind
  invoice_when TEXT NOT NULL DEFAULT '',    -- jobs: delivered | start | none; empty = workspace default
  show_in_add INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  updated_by TEXT
);

INSERT INTO service_types (id, name, kind, part, cycle, sort, created_at, updated_at) VALUES
  ('st_website', 'Website', 'renews', 'website', 'yearly', 10, 0, 0),
  ('st_domain', 'Domain', 'renews', 'domain', 'yearly', 20, 0, 0),
  ('st_hosting', 'Hosting', 'renews', 'hosting', 'yearly', 30, 0, 0),
  ('st_email', 'Email', 'renews', 'email', 'yearly', 40, 0, 0),
  ('st_maintenance', 'Maintenance plan', 'visits', 'maintenance', 'monthly', 50, 0, 0),
  ('st_ssl', 'SSL certificate', 'renews', 'ssl', 'yearly', 60, 0, 0),
  ('st_other', 'Something else', 'any', 'other', 'once', 1000, 0, 0);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp INTEGER NOT NULL DEFAULT 0,      -- the phone number is also on WhatsApp
  website TEXT NOT NULL DEFAULT '',         -- main website or domain, typed once for every service
  status TEXT NOT NULL DEFAULT 'active',    -- prospect | active | past
  tags TEXT NOT NULL DEFAULT '[]',          -- JSON list of tag names (Settings → General tags)
  notes TEXT NOT NULL DEFAULT '',           -- about the client
  service_notes TEXT NOT NULL DEFAULT '',   -- about their services
  logins TEXT NOT NULL DEFAULT '',          -- where the logins are kept (never a password)
  billing_address TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE client_services (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  name TEXT NOT NULL,                       -- the type's name, or the name typed for "Something else"
  kind TEXT NOT NULL,                       -- renews | visits | job (fixed when the service is added)
  details TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',          -- per part: registrar, provider, plan, mailboxes, built_with, looks_after
  cycle TEXT NOT NULL DEFAULT 'yearly',     -- yearly | monthly | once
  next_date INTEGER,                        -- renews on / next visit / due date (UTC midnight)
  price REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 1,
  currency TEXT NOT NULL DEFAULT 'NGN',
  job_status TEXT NOT NULL DEFAULT '',      -- jobs: not_started | in_progress | delivered
  invoice_when TEXT NOT NULL DEFAULT '',    -- jobs: delivered | start | none
  invoice_id TEXT,                          -- the last invoice drafted for it
  invoiced_for INTEGER,                     -- the date that invoice covers, so it is drafted once
  ended_at INTEGER,                         -- ended (or delivered): off the due list
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX idx_services_client ON client_services (client_id);
CREATE INDEX idx_services_due ON client_services (next_date) WHERE ended_at IS NULL;

-- Invoices drafted for a client's service point back to both.
ALTER TABLE invoices ADD COLUMN client_id TEXT;
ALTER TABLE invoices ADD COLUMN service_id TEXT;
CREATE INDEX idx_invoices_client ON invoices (client_id) WHERE client_id IS NOT NULL;

-- One row per reminder email sent by the daily run, so a reminder is never sent twice.
CREATE TABLE service_reminders (
  service_id TEXT NOT NULL,
  for_date INTEGER NOT NULL,                -- the service date it is about
  days_before INTEGER NOT NULL,             -- 60, 30, ... ; negative = overdue nudge (days after)
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (service_id, for_date, days_before)
) WITHOUT ROWID;

-- Notes and activity on a client's page. A note can carry a "remind me on" date: the daily run puts it in that
-- morning's email until someone ticks it done.
CREATE TABLE client_notes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  author TEXT NOT NULL,                     -- email
  text TEXT NOT NULL,
  remind_at INTEGER,                        -- UTC midnight, or NULL
  done INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_client_notes_client ON client_notes (client_id, at);
CREATE INDEX idx_client_notes_remind ON client_notes (remind_at) WHERE remind_at IS NOT NULL AND done = 0;
