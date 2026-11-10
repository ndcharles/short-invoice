-- Client billing details in the same shape as an invoice's "Invoiced To": contact person (clients.contact_name),
-- street address, "City, State, Postal code" and country, plus the email. Replaces the free-text billing_address.
--
-- Existing billing addresses are split by line:
--   copied from an invoice (first line is the client's name): name, contact, street, city, country
--   typed by hand: street, city, then everything else as the country

ALTER TABLE clients ADD COLUMN address_street TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN address_city TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN address_country TEXT NOT NULL DEFAULT '';

-- Each billing address as a JSON array of its lines: j keeps empty lines (positions matter when copied from an
-- invoice), jc drops them (typed by hand).
CREATE TABLE _addr AS
  SELECT id, raw,
    '["' || replace(esc, char(10), '","') || '"]' AS j,
    '["' || replace(replace(replace(replace(trim(esc, char(10)), char(10) || char(10), char(10)), char(10) || char(10), char(10)),
      char(10) || char(10), char(10)), char(10), '","') || '"]' AS jc
  FROM (
    SELECT id, billing_address AS raw,
      replace(replace(replace(replace(rtrim(billing_address, char(10) || char(13) || ' '), '\', '\\'), '"', '\"'), char(13), ''), char(9), ' ') AS esc
    FROM clients WHERE trim(billing_address) != ''
  );

UPDATE clients SET
  contact_name = CASE WHEN contact_name = '' THEN trim(coalesce(json_extract(a.j, '$[1]'), '')) ELSE contact_name END,
  address_street = trim(coalesce(json_extract(a.j, '$[2]'), '')),
  address_city = trim(coalesce(json_extract(a.j, '$[3]'), '')),
  address_country = coalesce((SELECT group_concat(trim(value), ', ') FROM json_each(a.j) WHERE key >= 4 AND trim(value) != ''), '')
  FROM _addr a
  WHERE a.id = clients.id AND json_valid(a.j) AND lower(trim(json_extract(a.j, '$[0]'))) = lower(trim(clients.name));

UPDATE clients SET
  address_street = trim(coalesce(json_extract(a.jc, '$[0]'), '')),
  address_city = trim(coalesce(json_extract(a.jc, '$[1]'), '')),
  address_country = coalesce((SELECT group_concat(trim(value), ', ') FROM json_each(a.jc) WHERE key >= 2 AND trim(value) != ''), '')
  FROM _addr a
  WHERE a.id = clients.id AND json_valid(a.jc) AND NOT (json_valid(a.j) AND lower(trim(json_extract(a.j, '$[0]'))) = lower(trim(clients.name)));

-- Anything that could not be read line by line keeps its text on the street line.
UPDATE clients SET address_street = trim(replace(replace(a.raw, char(13), ''), char(10), ', '))
  FROM _addr a WHERE a.id = clients.id AND NOT json_valid(a.jc);

DROP TABLE _addr;
ALTER TABLE clients DROP COLUMN billing_address;
