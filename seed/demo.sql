-- Demo data for local development only: `npm run db:seed:local`.
-- Never run against the production database.

INSERT OR IGNORE INTO folders (id, name, color, created_at) VALUES
  ('fld_marketing', 'Marketing', 'blue', 0),
  ('fld_internal', 'Internal', 'yellow', 0),
  ('fld_client', 'Client work', 'blue', 0);

INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES
  ('tag_client', 'Client', 'yellow', 0),
  ('tag_campaign', 'Campaign', 'blue', 0),
  ('tag_internal', 'Internal', 'green', 0);

INSERT OR IGNORE INTO links (id, domain, alias, dest, tag, folder, clicks, avatar, created_at, updated_at) VALUES
  ('lnk_demo1', '4th.link', 'curriculum', 'https://example.com/docs/curriculum', NULL, 'Links', 0, 'NC', CAST(strftime('%s','now','-2 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-2 days') AS INTEGER) * 1000),
  ('lnk_demo2', '4th.link', 'signup', 'https://example.com/forms/signup', NULL, 'Links', 174, 'NC', CAST(strftime('%s','now','-15 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-15 days') AS INTEGER) * 1000),
  ('lnk_demo3', '4th.link', 'feedback', 'https://example.com/forms/feedback', NULL, 'Links', 40, 'NC', CAST(strftime('%s','now','-30 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-30 days') AS INTEGER) * 1000),
  ('lnk_demo4', '4th.link', 'proposal', 'https://example.com/docs/proposal', 'Client', 'Client work', 2, 'NC', CAST(strftime('%s','now','-35 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-35 days') AS INTEGER) * 1000),
  ('lnk_demo5', '4th.link', 'ama', 'https://example.com/forms/ama', NULL, 'Links', 28, 'NC', CAST(strftime('%s','now','-50 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-50 days') AS INTEGER) * 1000),
  ('lnk_demo6', '4th.link', 'launch', 'https://example.com/community/launch', 'Campaign', 'Marketing', 892, 'NC', CAST(strftime('%s','now','-120 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-120 days') AS INTEGER) * 1000),
  ('lnk_demo7', '4th.link', 'onboarding', 'https://example.com/docs/onboarding', 'Internal', 'Internal', 47, 'JD', CAST(strftime('%s','now','-140 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-140 days') AS INTEGER) * 1000);

INSERT OR IGNORE INTO utms (id, website, source, medium, campaign, campaign_id, term, content, folder, clicks, avatar, created_at, updated_at) VALUES
  ('utm_demo1', 'https://example.com', 'bio', 'profile', 'footer', '', '', 'profile_link', 'Campaigns', 412, 'NC', CAST(strftime('%s','now','-60 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-60 days') AS INTEGER) * 1000),
  ('utm_demo2', 'https://example.com/pricing', 'newsletter', 'email', 'q3_launch', '', '', 'header_cta', 'Campaigns', 289, 'NC', CAST(strftime('%s','now','-62 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-62 days') AS INTEGER) * 1000),
  ('utm_demo3', 'https://example.com', 'google', 'cpc', 'brand_search', '', 'example software', 'ad_var_a', 'Campaigns', 1024, 'JD', CAST(strftime('%s','now','-65 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-65 days') AS INTEGER) * 1000),
  ('utm_demo4', 'https://example.com/webinar', 'x', 'social', 'sept_webinar', '', '', 'thread', 'Campaigns', 58, 'JD', CAST(strftime('%s','now','-81 days') AS INTEGER) * 1000, CAST(strftime('%s','now','-81 days') AS INTEGER) * 1000);

-- Demo invoices live in seed/demo-invoices.sql (run by the same npm script).
