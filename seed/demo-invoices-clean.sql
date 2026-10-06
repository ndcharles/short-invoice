-- Removes everything seed/demo-invoices.sql added. Your own invoices are untouched.
-- The demo tags and folder are kept if anything else still uses them.
DELETE FROM invoices WHERE id LIKE 'inv_demo_%';
DELETE FROM tags WHERE id IN ('tag_demo_project', 'tag_demo_retainer', 'tag_demo_international')
  AND name NOT IN (SELECT tag FROM invoices WHERE tag IS NOT NULL UNION SELECT tag FROM links WHERE tag IS NOT NULL);
DELETE FROM folders WHERE id = 'fld_demo_retainers'
  AND name NOT IN (SELECT folder FROM invoices UNION SELECT folder FROM links UNION SELECT folder FROM utms);
