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
import { requireAdmin, withinLimit } from '../lib/auth';
import { unknownPick } from '../lib/collections';
import { readPreview, scheduleRefresh, summaryOf } from '../lib/dest-preview';
import { cloakCheckFor, cloakRefusal } from '../lib/cloak-guard';
import { containsText } from '../lib/search';
import { parseHostname, parseHttpUrl } from '../../src/lib/validate';

const links = new Hono<AppEnv>();

/** Never send password hashes to the browser; the UI only needs to know one is set. */
/**
 * A link as the browser sees it. `dest_meta` is a server-side copy of what the destination says about
 * itself, so the raw JSON never goes out; a single link (not a list) carries a cleaned-up `preview` instead,
 * so the editor can show it straight away without asking the destination again.
 */
function publicLink(link: LinkItem | null, withPreview = false) {
  if (!link) return null;
  const { password_hash, dest_meta, ...rest } = link;
  return {
    ...rest,
    password_hash: null,
    has_password: !!password_hash,
    ...(withPreview ? { preview: summaryOf(readPreview(dest_meta)) } : {}),
  };
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
    sql += ` AND (${containsText('alias', '?')} OR ${containsText('dest', '?')} OR ${containsText('comments', '?')})`;
    params.push(search, search, search);
  }
  sql += ' ORDER BY created_at DESC';

  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(sql).bind(...params),
    c.env.DB.prepare('SELECT archived, COUNT(*) AS count FROM links GROUP BY archived'),
  ]);
  const list = (rows.results as LinkItem[]).map((row) => publicLink(row));
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
  const notAllowed = await unknownPick(db, c.var.user, [
    { kind: 'folders', value: input.folder },
    { kind: 'tags', value: input.tag },
  ]);
  if (notAllowed) return c.json({ error: notAllowed }, 400);
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

  // Last, because it may have to ask the destination: some sites cannot be shown in a cloaked link.
  if (input.cloak === 1) {
    const refusal = await cloakRefusal(c, input.dest ?? '', domain);
    if (refusal) return c.json(refusal, 400);
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
  if (link) scheduleRefresh(c.env, c.executionCtx, link);
  return c.json({ link: publicLink(link, true) }, 201);
});

/**
 * Can this destination be cloaked? Asked when the Cloak switch is turned on, and when a cloaked link is opened.
 * It looks at another site for the person, so it is limited per person (like link previews).
 */
const CLOAK_CHECKS_PER_10_MIN = 60;
links.get('/cloak-check', async (c) => {
  const dest = parseHttpUrl(c.req.query('url'), 'Destination URL');
  if (!dest.ok) return c.json({ error: dest.error }, 400);
  const asked = c.req.query('domain');
  const domain = asked ? parseHostname(asked) : null;
  if (domain && !domain.ok) return c.json({ error: domain.error }, 400);
  if (!(await withinLimit(c.env.DB, `cloak:${c.var.user.email}`, CLOAK_CHECKS_PER_10_MIN, 10 * 60_000))) {
    return c.json({ error: 'Too many checks. Try again in a few minutes.' }, 429);
  }
  const host = domain?.ok ? domain.value : (await getSettings(c.env.DB)).default_domain;
  return c.json({ cloak: await cloakCheckFor(c, dest.value, host) });
});

links.get('/:id', async (c) => {
  const link = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?1').bind(c.req.param('id')).first<LinkItem>();
  if (!link) return c.json({ error: 'Link not found' }, 404);
  // Opening a link in the editor also fills in (or renews) what its destination says, ready for next time.
  scheduleRefresh(c.env, c.executionCtx, link);
  return c.json({ link: publicLink(link, true) });
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
  const notAllowed = await unknownPick(db, c.var.user, [
    { kind: 'folders', value: input.folder, current: existing.folder },
    { kind: 'tags', value: input.tag, current: existing.tag },
  ]);
  if (notAllowed) return c.json({ error: notAllowed }, 400);

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

  // Cloaking is only checked when it is being turned on, or a cloaked link is pointed somewhere else (or onto another
  // domain). A link that is already cloaked keeps saving other changes, so a site that later stops allowing frames
  // never traps its owner: they can still open the link and turn cloaking off.
  const nextDest = input.dest ?? existing.dest;
  if ((input.cloak ?? existing.cloak) === 1 && (existing.cloak !== 1 || nextDest !== existing.dest || domain !== existing.domain)) {
    const refusal = await cloakRefusal(c, nextDest, domain);
    if (refusal) return c.json(refusal, 400);
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
           archived = ?21, updated_at = ?22, updated_by = ?24,
           dest_meta = CASE WHEN dest = ?3 THEN dest_meta ELSE NULL END
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
  if (link) scheduleRefresh(c.env, c.executionCtx, link);
  return c.json({ link: publicLink(link, true) });
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
