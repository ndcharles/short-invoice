import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import type { UtmCampaign } from '../../src/lib/types';
import { LIMITS, parseHttpUrl, parseMultiline, parseText, type Result } from '../../src/lib/validate';
import { readJsonObject } from '../lib/request';
import { getSettings } from '../lib/settings';
import { activity, changedFields } from '../lib/activity';
import { requireAdmin } from '../lib/auth';

const utms = new Hono<AppEnv>();

const TEXT_FIELDS = ['source', 'medium', 'campaign', 'campaign_id', 'term', 'content'] as const;
type UtmInput = Partial<Record<(typeof TEXT_FIELDS)[number] | 'folder', string | null>> & {
  website?: string;
  comments?: string;
  archived?: number;
};

/** Validates a campaign payload. Only keys present in the body are returned. */
function parseUtmInput(body: Record<string, unknown>): Result<UtmInput> {
  const out: UtmInput = {};
  if (body.website !== undefined) {
    const website = parseHttpUrl(body.website, 'Website URL');
    if (!website.ok) return website;
    out.website = website.value;
  }
  // The builder UI sends `utm_id`; the API name is `campaign_id`.
  const source: Record<string, unknown> = { ...body, campaign_id: body.campaign_id ?? body.utm_id };
  for (const key of TEXT_FIELDS) {
    if (source[key] === undefined) continue;
    const value = parseText(source[key], key, LIMITS.shortText);
    if (!value.ok) return value;
    out[key] = value.value;
  }
  if (body.folder !== undefined) {
    const folder = parseText(body.folder, 'Folder', LIMITS.name);
    if (!folder.ok) return folder;
    out.folder = folder.value;
  }
  if (body.comments !== undefined) {
    const comments = parseMultiline(body.comments, 'Comments');
    if (!comments.ok) return comments;
    out.comments = comments.value ?? '';
  }
  if (body.archived !== undefined) out.archived = body.archived ? 1 : 0;
  return { ok: true, value: out };
}

utms.get('/', async (c) => {
  const search = c.req.query('search')?.trim().slice(0, 200) || '';
  const archived = c.req.query('archived') === '1' ? 1 : 0;
  const folder = c.req.query('folder')?.trim() || '';

  let sql = 'SELECT * FROM utms WHERE archived = ?';
  const params: unknown[] = [archived];
  if (folder && folder !== 'All') {
    sql += ' AND folder = ?';
    params.push(folder);
  }
  if (search) {
    sql += ' AND (website LIKE ? OR source LIKE ? OR medium LIKE ? OR campaign LIKE ? OR content LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY created_at DESC';

  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(sql).bind(...params),
    c.env.DB.prepare('SELECT archived, COUNT(*) AS count FROM utms GROUP BY archived'),
  ]);
  const list = rows.results as UtmCampaign[];
  const grouped = counts.results as { archived: number; count: number }[];

  return c.json({
    campaigns: list,
    total: list.length,
    counts: {
      active: grouped.find((g) => g.archived === 0)?.count ?? 0,
      archived: grouped.find((g) => g.archived === 1)?.count ?? 0,
    },
  });
});

utms.post('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  if (body.website === undefined || body.website === '') return c.json({ error: 'A website URL is required' }, 400);
  const parsed = parseUtmInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  const settings = await getSettings(c.env.DB);

  const id = `utm_${nanoid(10)}`;
  const now = Date.now();
  const db = c.env.DB;
  await db.batch([
    db.prepare(
    `INSERT INTO utms (id, website, source, medium, campaign, campaign_id, term, content, comments, folder, avatar, created_at, updated_at, created_by, updated_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13, ?13)`
  )
    .bind(
      id,
      input.website,
      input.source ?? null,
      input.medium ?? null,
      input.campaign ?? null,
      input.campaign_id ?? null,
      input.term ?? null,
      input.content ?? null,
      input.comments ?? '',
      input.folder ?? (settings.utm_default_folder && settings.utm_default_folder !== 'None' ? settings.utm_default_folder : 'Campaigns'),
      c.var.user.initials,
      now,
      c.var.user.email
    ),
    activity(db, c.var.user, { action: 'created', type: 'utm', id, label: utmLabel(input), detail: input.website }, now),
  ]);

  const campaign = await c.env.DB.prepare('SELECT * FROM utms WHERE id = ?1').bind(id).first<UtmCampaign>();
  return c.json({ campaign }, 201);
});

utms.get('/:id', async (c) => {
  const campaign = await c.env.DB.prepare('SELECT * FROM utms WHERE id = ?1').bind(c.req.param('id')).first<UtmCampaign>();
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404);
  return c.json({ campaign });
});

utms.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = parseUtmInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM utms WHERE id = ?1').bind(id).first<UtmCampaign>();
  if (!existing) return c.json({ error: 'Campaign not found' }, 404);

  const pick = <K extends keyof UtmInput & keyof UtmCampaign>(key: K) =>
    input[key] === undefined ? existing[key] : input[key];

  const now = Date.now();
  const archivedChange = input.archived !== undefined && input.archived !== existing.archived;
  await db.batch([
    db
    .prepare(
      `UPDATE utms
       SET website = ?1, source = ?2, medium = ?3, campaign = ?4, campaign_id = ?5, term = ?6, content = ?7,
           comments = ?8, folder = ?9, archived = ?10, updated_at = ?11, updated_by = ?13
       WHERE id = ?12`
    )
    .bind(
      pick('website'),
      pick('source'),
      pick('medium'),
      pick('campaign'),
      pick('campaign_id'),
      pick('term'),
      pick('content'),
      pick('comments'),
      input.folder === undefined ? existing.folder : input.folder ?? 'Campaigns',
      pick('archived'),
      now,
      id,
      c.var.user.email
    ),
    activity(
      db,
      c.var.user,
      archivedChange
        ? { action: input.archived ? 'archived' : 'restored', type: 'utm', id, label: utmLabel({ ...existing, ...definedOnly(input) }) }
        : {
            action: 'updated',
            type: 'utm',
            id,
            label: utmLabel({ ...existing, ...definedOnly(input) }),
            detail: changedFields(existing as unknown as Record<string, unknown>, input as Record<string, unknown>, UTM_FIELDS),
          },
      now
    ),
  ]);

  const campaign = await db.prepare('SELECT * FROM utms WHERE id = ?1').bind(id).first<UtmCampaign>();
  return c.json({ campaign });
});

utms.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const existing = await db.prepare('SELECT * FROM utms WHERE id = ?1').bind(id).first<UtmCampaign>();
  if (!existing) return c.json({ success: true });
  await db.batch([
    db.prepare('DELETE FROM utms WHERE id = ?1').bind(id),
    activity(db, c.var.user, { action: 'deleted', type: 'utm', id, label: utmLabel(existing) }),
  ]);
  return c.json({ success: true });
});

const UTM_FIELDS: Record<string, string> = {
  website: 'website',
  source: 'source',
  medium: 'medium',
  campaign: 'campaign',
  campaign_id: 'campaign ID',
  term: 'term',
  content: 'content',
  comments: 'comments',
  folder: 'folder',
};

const definedOnly = <T extends object>(obj: T) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;

/** "newsletter / email · q3_launch" for the activity feed. */
function utmLabel(u: { website?: string | null; source?: string | null; medium?: string | null; campaign?: string | null }) {
  const tracking = [u.source, u.medium].filter(Boolean).join(' / ');
  return [tracking, u.campaign].filter(Boolean).join(' · ') || u.website || 'UTM';
}

export default utms;
