-- Demo invoices covering every stage and scenario. Fictional clients only.
--
--   Local:  npm run db:demo:invoices:local
--   Remote: npm run db:demo:invoices        (your deployed database)
--   Remove: npm run db:demo:invoices:clean  (or :clean:local)
--
-- Safe to run against a real database: it only inserts rows whose ids start
-- with inv_demo_ and numbers start with DEMO-, uses INSERT OR IGNORE (running
-- it twice changes nothing) and never touches your settings or sequence.
-- Dates are relative to today, so statuses such as Overdue are always current.
--
--  #   Client                          Scenario
--  01  Kola & Daughters Bakery         Draft, 3 lines, 7.5% VAT
--  02  Adebayo Logistics Ltd           Sent, due in 20 days, client has viewed it (Retainer)
--  03  Mainland Pharmacy               Sent, 12 days overdue, nothing paid
--  04  Zenith Events Co.               50% deposit paid, balance due in 10 days
--  05  Ibadan Agro Cooperative         Part paid AND overdue, flat discount
--  06  Lekki Dental Clinic             Paid in full over two payments (receipt)
--  07  Northbridge Studio Ltd (UK)     Naira invoice with USD equivalent, zero-rated VAT
--  08  Harbor & Pine Inc. (Canada)     Billed in USD with naira equivalent, paid by wire
--  09  Surulere Fitness Hub            Cancelled
--  10  Abuja Tech Hub                  15% discount + travel charges, no VAT, due in 5 days
--  11  Yaba Coffee Roasters            Overpaid: paid with a ₦6,500 credit
--  12  Ikoyi Interiors                 Due today

INSERT OR IGNORE INTO folders (id, name, color, created_at) VALUES ('fld_demo_retainers', 'Retainers', 'blue', 0);
INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES
  ('tag_demo_project', 'Project', 'blue', 0),
  ('tag_demo_retainer', 'Retainer', 'green', 0),
  ('tag_demo_international', 'International', 'yellow', 0);

INSERT OR IGNORE INTO invoices (
  id, number, client_name, client_contact, client_email, client_address, reference,
  issued_at, due_at, currency, status, items, payments,
  subtotal, tax_rate, discount, discount_type, charges, total, exchange_rate,
  notes, terms, folder, tag, avatar, share_token, sent_at, viewed_at, created_at, updated_at
) VALUES
-- 01 Draft
('inv_demo_01', 'DEMO-0001', 'Kola & Daughters Bakery', 'Mrs. Funke Kola', 'funke@kola-bakery.example',
  '14 Adeniran Ogunsanya Street' || char(10) || 'Surulere, Lagos' || char(10) || 'Nigeria', '',
  CAST(strftime('%s', date('now', '-1 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '+29 days')) AS INTEGER) * 1000,
  'NGN', 'draft',
  json_array(
    json_object('name', 'Website redesign', 'desc', 'Five-page responsive site with online menu', 'qty', 1, 'unitPrice', 850000),
    json_object('name', 'Product photography', 'desc', '20 edited photos', 'qty', 20, 'unitPrice', 7500),
    json_object('name', 'Hosting & maintenance', 'desc', '12 months', 'qty', 12, 'unitPrice', 15000)),
  '[]', 1180000, 0.075, 0, 'value', 0, 1268500, 0,
  'Thank you for choosing us.', 'Payment is due within 30 days of the invoice date. Please quote the invoice number as your transfer reference.',
  'Invoices', 'Project', 'NC', lower(hex(randomblob(16))), NULL, NULL,
  CAST(strftime('%s', 'now', '-1 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-1 days') AS INTEGER) * 1000),

-- 02 Sent, not yet due, viewed
('inv_demo_02', 'DEMO-0002', 'Adebayo Logistics Ltd', 'Tunde Adebayo', 'accounts@adebayo-logistics.example',
  'Plot 7, Trans-Amadi Industrial Layout' || char(10) || 'Port Harcourt, Rivers' || char(10) || 'Nigeria', 'RET-OCT',
  CAST(strftime('%s', date('now', '-10 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '+20 days')) AS INTEGER) * 1000,
  'NGN', 'sent',
  json_array(
    json_object('name', 'Social media management', 'desc', 'Monthly retainer: 3 platforms, 20 posts', 'qty', 1, 'unitPrice', 450000),
    json_object('name', 'Paid ads management', 'desc', 'Campaign setup and weekly optimisation', 'qty', 1, 'unitPrice', 120000)),
  '[]', 570000, 0.075, 0, 'value', 0, 612750, 0,
  '', 'Monthly retainer, payable within 30 days.',
  'Retainers', 'Retainer', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-10 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-8 days') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now', '-10 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-10 days') AS INTEGER) * 1000),

-- 03 Overdue, unpaid
('inv_demo_03', 'DEMO-0003', 'Mainland Pharmacy', 'Dr. Chika Obi', 'chika@mainlandpharmacy.example',
  '22 Herbert Macaulay Way' || char(10) || 'Yaba, Lagos', 'PO-4471',
  CAST(strftime('%s', date('now', '-42 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '-12 days')) AS INTEGER) * 1000,
  'NGN', 'sent',
  json_array(json_object('name', 'Brand identity', 'desc', 'Logo, colour palette and brand guidelines', 'qty', 1, 'unitPrice', 600000)),
  '[]', 600000, 0.075, 0, 'value', 0, 645000, 0,
  '', 'Payment is due within 30 days of the invoice date.',
  'Invoices', 'Project', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-42 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-40 days') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now', '-42 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-42 days') AS INTEGER) * 1000),

-- 04 Deposit paid, balance not yet due
('inv_demo_04', 'DEMO-0004', 'Zenith Events Co.', 'Amaka Nwosu', 'finance@zenithevents.example',
  '3 Bourdillon Road' || char(10) || 'Ikoyi, Lagos', '',
  CAST(strftime('%s', date('now', '-20 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '+10 days')) AS INTEGER) * 1000,
  'NGN', 'partially-paid',
  json_array(
    json_object('name', 'Event microsite', 'desc', 'Design and build, including speaker pages', 'qty', 1, 'unitPrice', 900000),
    json_object('name', 'Ticketing integration', 'desc', 'Paystack checkout and QR tickets', 'qty', 1, 'unitPrice', 250000)),
  json_array(json_object('id', 'pay_demo_04a', 'amount', 618125, 'date', date('now', '-6 days'), 'method', 'Bank transfer', 'note', '50% deposit')),
  1150000, 0.075, 0, 'value', 0, 1236250, 0,
  '50% deposit received with thanks. Balance due on launch.', 'Balance payable within 30 days of the invoice date.',
  'Invoices', 'Project', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-20 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-19 days') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now', '-20 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-6 days') AS INTEGER) * 1000),

-- 05 Part paid and overdue, flat discount
('inv_demo_05', 'DEMO-0005', 'Ibadan Agro Cooperative', 'Mr. Segun Afolabi', 'segun@ibadanagro.example',
  'Km 5, Ibadan–Oyo Road' || char(10) || 'Ibadan, Oyo', 'PHASE-1',
  CAST(strftime('%s', date('now', '-50 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '-5 days')) AS INTEGER) * 1000,
  'NGN', 'partially-paid',
  json_array(json_object('name', 'Mobile app, phase 1', 'desc', 'Farmer registration and produce listings (Android)', 'qty', 1, 'unitPrice', 1500000)),
  json_array(json_object('id', 'pay_demo_05a', 'amount', 500000, 'date', date('now', '-30 days'), 'method', 'Bank transfer', 'note', 'First instalment')),
  1500000, 0.075, 100000, 'value', 0, 1505000, 0,
  'Cooperative discount of ₦100,000 applied.', 'Payment due within 45 days.',
  'Invoices', 'Project', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-50 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-49 days') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now', '-50 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-30 days') AS INTEGER) * 1000),

-- 06 Paid in full over two payments
('inv_demo_06', 'DEMO-0006', 'Lekki Dental Clinic', 'Dr. Ife Balogun', 'admin@lekkidental.example',
  '45 Admiralty Way' || char(10) || 'Lekki Phase 1, Lagos', '',
  CAST(strftime('%s', date('now', '-28 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '+2 days')) AS INTEGER) * 1000,
  'NGN', 'paid',
  json_array(
    json_object('name', 'SEO audit', 'desc', 'Technical and content audit with action plan', 'qty', 1, 'unitPrice', 250000),
    json_object('name', 'Content writing', 'desc', 'Blog articles, 1,000 words each', 'qty', 8, 'unitPrice', 25000)),
  json_array(
    json_object('id', 'pay_demo_06a', 'amount', 200000, 'date', date('now', '-20 days'), 'method', 'Paystack', 'note', ''),
    json_object('id', 'pay_demo_06b', 'amount', 283750, 'date', date('now', '-8 days'), 'method', 'Bank transfer', 'note', 'Balance')),
  450000, 0.075, 0, 'value', 0, 483750, 0,
  '', 'Payment is due within 30 days of the invoice date.',
  'Invoices', 'Project', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-28 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-27 days') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now', '-28 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-8 days') AS INTEGER) * 1000),

-- 07 Naira invoice for a UK client, with USD equivalent (₦1,550 = $1)
('inv_demo_07', 'DEMO-0007', 'Northbridge Studio Ltd', 'Hannah Clarke', 'ap@northbridge.example',
  '12 Shoreditch High Street' || char(10) || 'London E1 6PJ' || char(10) || 'United Kingdom', 'NB-2026-031',
  CAST(strftime('%s', date('now', '-3 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '+27 days')) AS INTEGER) * 1000,
  'NGN', 'sent',
  json_array(
    json_object('name', 'UX research sprint', 'desc', 'Two-week discovery: interviews, synthesis, report', 'qty', 1, 'unitPrice', 2325000),
    json_object('name', 'Usability testing sessions', 'desc', 'Remote moderated sessions with Nigerian users', 'qty', 6, 'unitPrice', 155000)),
  '[]', 3255000, 0, 0, 'value', 0, 3255000, 1550,
  'Zero-rated: export of services. USD figures are for reference at the rate shown; payment by international wire to our dollar account is welcome.',
  'Payment is due within 30 days of the invoice date.',
  'Invoices', 'International', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-3 days') AS INTEGER) * 1000, NULL,
  CAST(strftime('%s', 'now', '-3 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-3 days') AS INTEGER) * 1000),

-- 08 Billed in USD for a Canadian client, naira equivalent, paid by wire
('inv_demo_08', 'DEMO-0008', 'Harbor & Pine Inc.', 'Marcus Lee', 'billing@harborpine.example',
  '200 Bay Street, Suite 1400' || char(10) || 'Toronto, ON M5J 2J2' || char(10) || 'Canada', 'HP-PO-889',
  CAST(strftime('%s', date('now', '-15 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '+15 days')) AS INTEGER) * 1000,
  'USD', 'paid',
  json_array(
    json_object('name', 'Landing page design', 'desc', 'Responsive design in Figma, two rounds of revisions', 'qty', 1, 'unitPrice', 1200),
    json_object('name', 'Copywriting', 'desc', 'Hero, features and FAQ sections', 'qty', 1, 'unitPrice', 450)),
  json_array(json_object('id', 'pay_demo_08a', 'amount', 1650, 'date', date('now', '-4 days'), 'method', 'International wire', 'note', 'SWIFT ref HP889-2026')),
  1650, 0, 0, 'value', 0, 1650, 1550,
  '', 'Payment by international wire within 30 days.',
  'Invoices', 'International', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-15 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-14 days') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now', '-15 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-4 days') AS INTEGER) * 1000),

-- 09 Cancelled
('inv_demo_09', 'DEMO-0009', 'Surulere Fitness Hub', 'Coach Emeka', 'hello@surulerefit.example',
  '9 Bode Thomas Street' || char(10) || 'Surulere, Lagos', '',
  CAST(strftime('%s', date('now', '-35 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '-5 days')) AS INTEGER) * 1000,
  'NGN', 'cancelled',
  json_array(json_object('name', 'Gym app prototype', 'desc', 'Clickable prototype for member bookings', 'qty', 1, 'unitPrice', 700000)),
  '[]', 700000, 0.075, 0, 'value', 0, 752500, 0,
  'Cancelled: the client put the project on hold.', '',
  'Invoices', 'Project', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-35 days') AS INTEGER) * 1000, NULL,
  CAST(strftime('%s', 'now', '-35 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-20 days') AS INTEGER) * 1000),

-- 10 Percentage discount, travel charges, no VAT
('inv_demo_10', 'DEMO-0010', 'Abuja Tech Hub', 'Zainab Bello', 'programs@abujatechhub.example',
  '5 Aminu Kano Crescent' || char(10) || 'Wuse 2, Abuja', 'GRANT-WS-02',
  CAST(strftime('%s', date('now', '-9 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '+5 days')) AS INTEGER) * 1000,
  'NGN', 'sent',
  json_array(
    json_object('name', 'Workshop facilitation', 'desc', 'Product design bootcamp (per day)', 'qty', 2, 'unitPrice', 300000),
    json_object('name', 'Training materials', 'desc', 'Printed workbooks', 'qty', 30, 'unitPrice', 5000)),
  '[]', 750000, 0, 15, 'percent', 85000, 722500, 0,
  '15% non-profit discount applied. Additional charges cover travel and logistics.', 'Payment due within 14 days.',
  'Invoices', 'Project', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-9 days') AS INTEGER) * 1000, NULL,
  CAST(strftime('%s', 'now', '-9 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-9 days') AS INTEGER) * 1000),

-- 11 Overpaid (client has a credit)
('inv_demo_11', 'DEMO-0011', 'Yaba Coffee Roasters', 'Bisi Ade', 'bisi@yabacoffee.example',
  '31 Commercial Avenue' || char(10) || 'Yaba, Lagos', '',
  CAST(strftime('%s', date('now', '-12 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now', '+2 days')) AS INTEGER) * 1000,
  'NGN', 'paid',
  json_array(json_object('name', 'Logo refresh', 'desc', 'Updated wordmark and cup stamp', 'qty', 1, 'unitPrice', 180000)),
  json_array(json_object('id', 'pay_demo_11a', 'amount', 200000, 'date', date('now', '-3 days'), 'method', 'Cash', 'note', 'Paid ₦200,000; ₦6,500 credit toward next job')),
  180000, 0.075, 0, 'value', 0, 193500, 0,
  '', 'Payment due within 14 days.',
  'Invoices', NULL, 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-12 days') AS INTEGER) * 1000, NULL,
  CAST(strftime('%s', 'now', '-12 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-3 days') AS INTEGER) * 1000),

-- 12 Due today
('inv_demo_12', 'DEMO-0012', 'Ikoyi Interiors', 'Kemi Hassan', 'kemi@ikoyiinteriors.example',
  '17 Glover Road' || char(10) || 'Ikoyi, Lagos', '',
  CAST(strftime('%s', date('now', '-14 days')) AS INTEGER) * 1000, CAST(strftime('%s', date('now')) AS INTEGER) * 1000,
  'NGN', 'sent',
  json_array(json_object('name', 'Instagram content shoot', 'desc', 'Half-day shoot, 30 edited images', 'qty', 1, 'unitPrice', 320000)),
  '[]', 320000, 0.075, 0, 'value', 0, 344000, 0,
  '', 'Payment due within 14 days.',
  'Retainers', 'Retainer', 'NC', lower(hex(randomblob(16))),
  CAST(strftime('%s', 'now', '-14 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-1 days') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now', '-14 days') AS INTEGER) * 1000, CAST(strftime('%s', 'now', '-14 days') AS INTEGER) * 1000);
