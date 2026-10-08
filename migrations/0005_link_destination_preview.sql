-- What a cloaked link's destination says about itself (its title, description and image), kept so the
-- cloak page and social previews can show them without fetching the destination on every click.
-- JSON written by worker/lib/dest-preview.ts; NULL until fetched, and cleared when the destination changes.
ALTER TABLE links ADD COLUMN dest_meta TEXT;
