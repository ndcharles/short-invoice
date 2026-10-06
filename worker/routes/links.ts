import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { LinkItem } from '../../src/lib/types';
import { hashPassword } from '../lib/password';
import { pickUtm } from '../../src/lib/links/utm';
import { randomAlias } from '../../src/lib/links/fields';
import { parseLinkInput } from '../lib/link-input';
import { getSettings } from '../lib/settings';
import { knownDomains } from '../lib/domains';
import { readJsonObject } from '../lib/request';
import { activity, changedFields } from '../lib/activity';
import { requireAdmin } from '../lib/auth';

const links = new Hono<AppEnv>();

/** Never send password hashes to the browser; the UI only needs to know one is set. */
function publicLink(link: LinkItem | null) {
  if (!link) return null;
  const { password_hash, ...rest } = link;
  return { ...rest, password_hash: null, has_password: !!password_hash };
}

links.get('/', async (c) => {
  const search = c.req.query('search')?.trim().slice(0, 200) || '';
  const archived = c.req.query('archived') === '1' ? 1 : 0;
  const folder = c.req.query('folder')?.trim() || '';

  let sql = 'SELECT * FROM links WHERE archived = ?';
  const params: unknown[] = [archived];
  if (folder && folder !== 'All') {
    sql += ' AND folder = ?';
    params.push(folder);
  }
  if (search) {
    sql += ' AND (alias LIKE ? OR dest LIKE ? OR comments LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY created_at DESC';

  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(sql).bind(...params),
    c.env.DB.prepare('SELECT archived, COUNT(*) AS count FROM links GROUP BY archived'),
  ]);
  const list = (rows.results as LinkItem[]).map(publicLink);
  const grouped = counts.results as { archived: number; count: number }[];

  return c.json({
    links: list,
    total: list.length,
    counts: {
      active: grouped.find((g) => g.archived === 0)?.count ?? 0,
      archived: grouped.find((g) => g.archived === 1)?.count ?? 0,
    },
  });
});

links.post('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  if (body.dest === undefined || body.dest === null || body.dest === '') {
    return c.json({ error: 'Destination URL is required' }, 400);
  }
  const parsed = parseLinkInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;

  const db = c.env.DB;
  const settings = await getSettings(db);
  const domain = input.domain ?? settings.default_domain;
  if (!knownDomains(settings).includes(domain)) {
    return c.json({ error: `"${domain}" is not one of your domains. Add it in Settings → URL Shortener first.` }, 400);
  }
  const alias = input.alias ?? randomAlias();

  const existing = await db.prepare('SELECT id FROM links WHERE domain = ?1 AND alias = ?2').bind(domain, alias).first();
  if (existing) {
    return c.json({ error: 'This short link alias is already in use.' }, 409);
  }

  const id = `lnk_${randomAlias()}${randomAlias().slice(0, 3)}`;
  const now = Date.now();
  const utm = pickUtm(input.utm ?? {});

  await db.batch([
    db
    .prepare(
      `INSERT INTO links (
        id, domain, alias, dest, tag, folder, comments, cloak,
        password_hash, expires_at, expires_url,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, utm_referral,
        custom_preview, og_title, og_description, og_image,
        avatar, created_at, updated_at, created_by, updated_by
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?23, ?24, ?24)`
    )
    .bind(
      id, domain, alias, input.dest, input.tag ?? null, input.folder ?? settings.default_folder ?? 'Links',
      input.comments ?? '', input.cloak ?? 0,
      input.password ? await hashPassword(input.password) : null,
      input.expires_at ?? null,
      input.expires_url ?? null,
      utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term, utm.utm_content, utm.utm_referral,
      input.custom_preview ?? 0,
      input.og_title ?? null,
      input.og_description ?? null,
      input.og_image ?? null,
      c.var.user.initials, now, c.var.user.email
    ),
    activity(db, c.var.user, { action: 'created', type: 'link', id, label: `${domain}/${alias}`, detail: input.dest }, now),
  ]);

  const link = await db.prepare('SELECT * FROM links WHERE id = ?1').bind(id).first<LinkItem>();
  return c.json({ link: publicLink(link) }, 201);
});

links.get('/:id', async (c) => {
  const link = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?1').bind(c.req.param('id')).first<LinkItem>();
  if (!link) return c.json({ error: 'Link not found' }, 404);
  return c.json({ link: publicLink(link) });
});

links.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = parseLinkInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM links WHERE id = ?1').bind(id).first<LinkItem>();
  if (!existing) return c.json({ error: 'Link not found' }, 404);

  const domain = input.domain ?? existing.domain;
  const alias = input.alias ?? existing.alias;

  if (domain !== existing.domain) {
    const settings = await getSettings(db);
    if (!knownDomains(settings).includes(domain)) {
      return c.json({ error: `"${domain}" is not one of your domains.` }, 400);
    }
  }
  if (alias !== existing.alias || domain !== existing.domain) {
    const conflict = await db
      .prepare('SELECT id FROM links WHERE domain = ?1 AND alias = ?2 AND id != ?3')
      .bind(domain, alias, id)
      .first();
    if (conflict) return c.json({ error: 'Alias already in use' }, 409);
  }

  // Password: absent = leave as-is, null/'' = clear, string = set.
  let passwordHash = existing.password_hash;
  if (input.password !== undefined) passwordHash = input.password ? await hashPassword(input.password) : null;

  const utm = pickUtm({ ...pickUtm(existing), ...(input.utm ?? {}) });
  const keep = <K extends keyof LinkItem>(key: K, next: LinkItem[K] | undefined) => (next === undefined ? existing[key] : next);

  const now = Date.now();
  await db.batch([
    db
    .prepare(
      `UPDATE links
       SET domain = ?1, alias = ?2, dest = ?3, tag = ?4, folder = ?5, comments = ?6, cloak = ?7,
           password_hash = ?8, expires_at = ?9, expires_url = ?10,
           utm_source = ?11, utm_medium = ?12, utm_campaign = ?13, utm_term = ?14, utm_content = ?15, utm_referral = ?16,
           custom_preview = ?17, og_title = ?18, og_description = ?19, og_image = ?20,
           archived = ?21, updated_at = ?22, updated_by = ?24
       WHERE id = ?23`
    )
    .bind(
      domain, alias, keep('dest', input.dest),
      keep('tag', input.tag),
      input.folder === undefined ? existing.folder : input.folder ?? 'Links',
      keep('comments', input.comments),
      keep('cloak', input.cloak),
      passwordHash,
      keep('expires_at', input.expires_at),
      keep('expires_url', input.expires_url),
      utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term, utm.utm_content, utm.utm_referral,
      keep('custom_preview', input.custom_preview),
      keep('og_title', input.og_title),
      keep('og_description', input.og_description),
      keep('og_image', input.og_image),
      keep('archived', input.archived),
      now,
      id,
      c.var.user.email
    ),
    activity(db, c.var.user, linkActivity(existing, input as Record<string, unknown>, domain, alias, passwordHash !== existing.password_hash), now),
  ]);

  const link = await db.prepare('SELECT * FROM links WHERE id = ?1').bind(id).first<LinkItem>();
  return c.json({ link: publicLink(link) });
});

links.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const existing = await db.prepare('SELECT domain, alias FROM links WHERE id = ?1').bind(id).first<{ domain: string; alias: string }>();
  if (!existing) return c.json({ success: true });
  await db.batch([
    db.prepare('DELETE FROM links WHERE id = ?1').bind(id),
    db.prepare('DELETE FROM link_clicks_daily WHERE link_id = ?1').bind(id),
    activity(db, c.var.user, { action: 'deleted', type: 'link', id, label: `${existing.domain}/${existing.alias}` }),
  ]);
  return c.json({ success: true });
});

const LINK_FIELDS: Record<string, string> = {
  domain: 'domain',
  alias: 'alias',
  dest: 'destination',
  tag: 'tag',
  folder: 'folder',
  comments: 'comments',
  cloak: 'cloaking',
  expires_at: 'expiry',
  custom_preview: 'link preview',
  og_title: 'preview title',
  og_description: 'preview description',
  og_image: 'preview image',
};

/** "archived", "restored" or "updated: destination and tag" for the activity feed. */
function linkActivity(existing: LinkItem, input: Record<string, unknown>, domain: string, alias: string, passwordChanged: boolean) {
  const label = `${domain}/${alias}`;
  if (input.archived !== undefined && input.archived !== existing.archived) {
    return { action: input.archived ? 'archived' : 'restored', type: 'link' as const, id: existing.id, label };
  }
  const utmChanged = input.utm && Object.entries(input.utm as Record<string, unknown>).some(([k, v]) => (existing as unknown as Record<string, unknown>)[k] !== v);
  const fields = [changedFields(existing as unknown as Record<string, unknown>, { ...input, domain, alias }, LINK_FIELDS), utmChanged ? 'UTM' : '', passwordChanged ? 'password' : '']
    .filter(Boolean)
    .join(', ');
  return { action: 'updated', type: 'link' as const, id: existing.id, label, detail: fields };
}

export default links;
