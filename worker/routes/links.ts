import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import type { LinkItem } from '../../src/lib/types';
import { hashPassword } from '../lib/password';
import { pickUtm } from '../../src/lib/links/utm';
import { asBooleanish, asText, normalizeAlias, normalizeDest, parseExpiresAt } from '../../src/lib/links/fields';

const links = new Hono<AppEnv>();

links.get('/', async (c) => {
  const search = c.req.query('search')?.trim() || '';
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
  const list = rows.results as LinkItem[];
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
  const body = await c.req.json();
  const domain = asText(body.domain) ?? '4th.link';

  if (!body.dest || typeof body.dest !== 'string') {
    return c.json({ error: 'Destination URL is required' }, 400);
  }
  const dest = normalizeDest(body.dest);
  const alias =
    typeof body.alias === 'string' && body.alias.trim() ? normalizeAlias(body.alias) : nanoid(7);

  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM links WHERE domain = ?1 AND alias = ?2').bind(domain, alias).first();
  if (existing) {
    return c.json({ error: 'This short link alias is already in use.' }, 409);
  }

  const id = `lnk_${nanoid(10)}`;
  const now = Date.now();
  const password = asText(body.password);
  const utm = pickUtm(body);

  await db
    .prepare(
      `INSERT INTO links (
        id, domain, alias, dest, tag, folder, comments, cloak,
        password_hash, expires_at, expires_url,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, utm_referral,
        custom_preview, og_title, og_description, og_image,
        avatar, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?23)`
    )
    .bind(
      id, domain, alias, dest, body.tag ?? null, body.folder ?? 'Links', body.comments ?? '', body.cloak ? 1 : 0,
      password ? await hashPassword(password) : null,
      parseExpiresAt(body.expires_at ?? body.expiresAt),
      asText(body.expires_url ?? body.expiresUrl),
      utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term, utm.utm_content, utm.utm_referral,
      asBooleanish(body.custom_preview ?? body.customPreview) ? 1 : 0,
      asText(body.og_title ?? body.ogTitle),
      asText(body.og_description ?? body.ogDescription),
      asText(body.og_image ?? body.ogImage),
      'NC', now
    )
    .run();

  const link = await db.prepare('SELECT * FROM links WHERE id = ?1').bind(id).first<LinkItem>();
  return c.json({ link }, 201);
});

links.get('/:id', async (c) => {
  const link = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?1').bind(c.req.param('id')).first<LinkItem>();
  if (!link) return c.json({ error: 'Link not found' }, 404);
  return c.json({ link });
});

links.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM links WHERE id = ?1').bind(id).first<LinkItem>();
  if (!existing) return c.json({ error: 'Link not found' }, 404);

  const has = (...keys: string[]) => keys.some((k) => body[k] !== undefined);
  const domain = body.domain ?? existing.domain;
  const alias = normalizeAlias(body.alias ?? existing.alias);
  const dest = normalizeDest(body.dest ?? existing.dest);

  if (alias !== existing.alias || domain !== existing.domain) {
    const conflict = await db
      .prepare('SELECT id FROM links WHERE domain = ?1 AND alias = ?2 AND id != ?3')
      .bind(domain, alias, id)
      .first();
    if (conflict) return c.json({ error: 'Alias already in use' }, 409);
  }

  // Password: undefined = leave as-is, null/'' = clear, string = set
  let passwordHash = existing.password_hash;
  if (body.password !== undefined) {
    const password = asText(body.password);
    passwordHash = password ? await hashPassword(password) : null;
  }

  const utm =
    body.utm !== undefined || Object.keys(body).some((k) => k.startsWith('utm_'))
      ? pickUtm({ ...existing, ...body })
      : pickUtm(existing);

  await db
    .prepare(
      `UPDATE links
       SET domain = ?1, alias = ?2, dest = ?3, tag = ?4, folder = ?5, comments = ?6, cloak = ?7,
           password_hash = ?8, expires_at = ?9, expires_url = ?10,
           utm_source = ?11, utm_medium = ?12, utm_campaign = ?13, utm_term = ?14, utm_content = ?15, utm_referral = ?16,
           custom_preview = ?17, og_title = ?18, og_description = ?19, og_image = ?20,
           archived = ?21, updated_at = ?22
       WHERE id = ?23`
    )
    .bind(
      domain, alias, dest,
      body.tag !== undefined ? body.tag : existing.tag,
      body.folder ?? existing.folder,
      body.comments ?? existing.comments,
      body.cloak !== undefined ? (body.cloak ? 1 : 0) : existing.cloak,
      passwordHash,
      has('expires_at', 'expiresAt') ? parseExpiresAt(body.expires_at ?? body.expiresAt) : existing.expires_at,
      has('expires_url', 'expiresUrl') ? asText(body.expires_url ?? body.expiresUrl) : existing.expires_url,
      utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term, utm.utm_content, utm.utm_referral,
      has('custom_preview', 'customPreview') ? ((body.custom_preview ?? body.customPreview) ? 1 : 0) : existing.custom_preview,
      has('og_title', 'ogTitle') ? asText(body.og_title ?? body.ogTitle) : existing.og_title,
      has('og_description', 'ogDescription') ? asText(body.og_description ?? body.ogDescription) : existing.og_description,
      has('og_image', 'ogImage') ? asText(body.og_image ?? body.ogImage) : existing.og_image,
      body.archived !== undefined ? (body.archived ? 1 : 0) : existing.archived,
      Date.now(),
      id
    )
    .run();

  const link = await db.prepare('SELECT * FROM links WHERE id = ?1').bind(id).first<LinkItem>();
  return c.json({ link });
});

links.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM links WHERE id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM link_clicks_daily WHERE link_id = ?1').bind(id),
  ]);
  return c.json({ success: true });
});

export default links;
