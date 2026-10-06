-- Invoice fields for a standard invoice and the public client view.
--   client_contact  person to address, separate from the company name
--   reference       PO / project reference printed on the invoice
--   share_token     unguessable token for the public /s/i/<token> view
--   sent_at         first time the invoice was marked sent
--   viewed_at       first time the client opened the public view
-- The unique index backs the public lookup by token (NULLs are allowed).

ALTER TABLE invoices ADD COLUMN client_contact TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN reference TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN share_token TEXT;
ALTER TABLE invoices ADD COLUMN sent_at INTEGER;
ALTER TABLE invoices ADD COLUMN viewed_at INTEGER;

CREATE UNIQUE INDEX idx_invoices_share_token ON invoices (share_token);

UPDATE invoices SET share_token = lower(hex(randomblob(16))) WHERE share_token IS NULL;

-- The old editor stored "client name\n..." at the top of the address; drop
-- the duplicated name line.
UPDATE invoices
SET client_address = substr(client_address, length(client_name) + 2)
WHERE client_address LIKE client_name || char(10) || '%';
UPDATE invoices SET client_address = '' WHERE client_address = client_name;

-- Statuses are now derived from payments and the due date.
UPDATE invoices SET status = 'sent' WHERE status = 'overdue';
