-- Lean client tracker: one Website service (domain and hosting are ticks inside it), and a normalised shape.
--
--   service_parts      what a service includes / looks after: website, domain, hosting, email, other, each with
--                      its provider (built with, registrar, host, email provider, "what else") and, for email,
--                      the number of mailboxes. Replaces the per-type JSON in client_services.meta.
--   client_services    one row per service: a due date (the work), a next date (renewal or schedule) with how
--                      often it repeats, a status, an amount. Replaces kind/cycle/next_date/job_status/meta/
--                      invoice_id/invoiced_for/invoice_when.
--   invoices.service_for  the renewal or scheduled date an invoice covers (NULL: the work itself), so "has this
--                      period been invoiced?" is answered from invoices instead of a copy on the service.
--   service_types      no longer decide how a service works or its billing cycle (picked on each service);
--                      Domain, Hosting and SSL certificate are folded into Website.
--   clients            tags are gone; a separate WhatsApp number when the phone is not on WhatsApp.

CREATE TABLE service_parts (
  service_id TEXT NOT NULL,
  part TEXT NOT NULL,                       -- website | domain | hosting | email | other
  provider TEXT NOT NULL DEFAULT '',
  count INTEGER,                            -- email: mailboxes
  PRIMARY KEY (service_id, part)
) WITHOUT ROWID;

-- 1. What existing services already include.
INSERT OR IGNORE INTO service_parts (service_id, part, provider)
  SELECT s.id, 'website', coalesce(json_extract(s.meta, '$.built_with'), '')
  FROM client_services s JOIN service_types t ON t.id = s.type_id WHERE t.part = 'website';
INSERT OR IGNORE INTO service_parts (service_id, part, provider, count)
  SELECT s.id, 'email', coalesce(json_extract(s.meta, '$.provider'), ''), CAST(nullif(json_extract(s.meta, '$.mailboxes'), '') AS INTEGER)
  FROM client_services s JOIN service_types t ON t.id = s.type_id WHERE t.part = 'email';
INSERT OR IGNORE INTO service_parts (service_id, part)
  SELECT s.id, lower(j.value) FROM client_services s, json_each(s.meta, '$.looks_after') j
  WHERE lower(j.value) IN ('website', 'domain', 'hosting', 'email', 'other');

-- 2. Which period each invoice covers (taken from the copy kept on the service until now).
ALTER TABLE invoices ADD COLUMN service_for INTEGER;
UPDATE invoices SET service_for = (SELECT s.invoiced_for FROM client_services s WHERE s.invoice_id = invoices.id)
  WHERE service_id IS NOT NULL;
CREATE INDEX idx_invoices_service ON invoices (service_id) WHERE service_id IS NOT NULL;

-- 3. Fold Domain, Hosting and SSL certificate services into each client's Website service.
CREATE TABLE _fold AS
  SELECT id, client_id, type_id AS old_type, meta, next_date, price, created_at FROM client_services
  WHERE type_id IN ('st_domain', 'st_hosting', 'st_ssl');

-- A client with no Website service: their earliest folded service becomes it.
UPDATE client_services SET type_id = 'st_website', name = 'Website'
  WHERE id IN (
    SELECT (SELECT f2.id FROM _fold f2 WHERE f2.client_id = c.client_id ORDER BY f2.created_at LIMIT 1)
    FROM (SELECT DISTINCT client_id FROM _fold) c
    WHERE NOT EXISTS (SELECT 1 FROM client_services w WHERE w.client_id = c.client_id AND w.type_id = 'st_website')
  );

CREATE TABLE _target AS
  SELECT f.id AS old_id, (
    SELECT w.id FROM client_services w WHERE w.client_id = f.client_id AND w.type_id = 'st_website'
    ORDER BY (w.ended_at IS NOT NULL), w.created_at LIMIT 1
  ) AS target_id, f.*
  FROM _fold f;

INSERT OR IGNORE INTO service_parts (service_id, part, provider)
  SELECT target_id,
    CASE old_type WHEN 'st_domain' THEN 'domain' WHEN 'st_hosting' THEN 'hosting' ELSE 'other' END,
    CASE old_type
      WHEN 'st_domain' THEN coalesce(json_extract(meta, '$.registrar'), '')
      WHEN 'st_hosting' THEN trim(coalesce(json_extract(meta, '$.provider'), '') || ' ' || coalesce(json_extract(meta, '$.plan'), ''))
      ELSE 'SSL certificate' END
  FROM _target;

-- The website takes the soonest renewal date it lacked, and the folded prices (noted in its details).
UPDATE client_services SET
  next_date = coalesce(next_date, (SELECT min(t.next_date) FROM _target t WHERE t.target_id = client_services.id AND t.old_id != client_services.id)),
  kind = CASE WHEN kind = 'job' THEN kind ELSE 'renews' END,
  -- A folded service that became the website carries all the folded prices; a real website keeps its own and notes them.
  price = CASE WHEN price > 0 AND id NOT IN (SELECT id FROM _fold) THEN price
    ELSE price + coalesce((SELECT sum(t.price) FROM _target t WHERE t.target_id = client_services.id AND t.old_id != client_services.id), 0) END,
  details = trim(details || CASE WHEN price > 0 AND id NOT IN (SELECT id FROM _fold) AND (SELECT count(*) FROM _target t WHERE t.target_id = client_services.id AND t.old_id != client_services.id AND t.price > 0) > 0
    THEN char(10) || 'Merged in: ' || (SELECT group_concat(
      CASE t.old_type WHEN 'st_domain' THEN 'domain' WHEN 'st_hosting' THEN 'hosting' ELSE 'SSL' END || ' ' || t.price, ', ')
      FROM _target t WHERE t.target_id = client_services.id AND t.old_id != client_services.id AND t.price > 0)
    ELSE '' END, char(10) || ' ')
  WHERE id IN (SELECT target_id FROM _target);

UPDATE invoices SET service_id = (SELECT t.target_id FROM _target t WHERE t.old_id = invoices.service_id)
  WHERE service_id IN (SELECT old_id FROM _target WHERE old_id != target_id);
DELETE FROM service_reminders WHERE service_id IN (SELECT old_id FROM _target WHERE old_id != target_id);
DELETE FROM service_parts WHERE service_id IN (SELECT old_id FROM _target WHERE old_id != target_id);
DELETE FROM client_services WHERE id IN (SELECT old_id FROM _target WHERE old_id != target_id);
DROP TABLE _target;
DROP TABLE _fold;

-- 4. The new shape of a service.
CREATE TABLE client_services_new (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  name TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  recurs TEXT,                              -- renews | scheduled | NULL (one-off)
  repeats TEXT NOT NULL DEFAULT 'yearly',   -- monthly | quarterly | yearly
  next_at INTEGER,                          -- next renewal or scheduled date (UTC midnight)
  due_at INTEGER,                           -- when the work itself is due
  status TEXT NOT NULL DEFAULT 'not_started', -- not_started | in_progress | delivered | cancelled
  amount REAL NOT NULL DEFAULT 0,           -- charge per period, or the price of the work
  quantity REAL NOT NULL DEFAULT 1,         -- only for types priced "each"
  currency TEXT NOT NULL DEFAULT 'NGN',
  ended_at INTEGER,                         -- ended or cancelled: off the due list
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  updated_by TEXT
);

INSERT INTO client_services_new (id, client_id, type_id, name, details, recurs, repeats, next_at, due_at, status, amount, quantity,
  currency, ended_at, created_at, updated_at, created_by, updated_by)
SELECT id, client_id, type_id, name, details,
  CASE WHEN kind = 'renews' AND next_date IS NOT NULL THEN 'renews' WHEN kind = 'visits' THEN 'scheduled' ELSE NULL END,
  CASE cycle WHEN 'monthly' THEN 'monthly' ELSE 'yearly' END,
  CASE WHEN kind = 'job' THEN NULL ELSE next_date END,
  CASE WHEN kind = 'job' THEN next_date ELSE NULL END,
  CASE WHEN kind = 'job' THEN coalesce(nullif(job_status, ''), 'not_started') ELSE 'delivered' END,
  price, quantity, currency, ended_at, created_at, updated_at, created_by, updated_by
FROM client_services;

DROP TABLE client_services;
ALTER TABLE client_services_new RENAME TO client_services;
CREATE INDEX idx_services_client ON client_services (client_id);

-- 5. Service types: names, prices, reminder days and the Add list only.
DELETE FROM service_types WHERE id IN ('st_domain', 'st_hosting', 'st_ssl');
ALTER TABLE service_types DROP COLUMN kind;
ALTER TABLE service_types DROP COLUMN cycle;
ALTER TABLE service_types DROP COLUMN invoice_when;

-- 6. Clients: no tags; a WhatsApp number of its own when the phone is not on WhatsApp.
ALTER TABLE clients DROP COLUMN tags;
ALTER TABLE clients ADD COLUMN whatsapp_number TEXT NOT NULL DEFAULT '';
