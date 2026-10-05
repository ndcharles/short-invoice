import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import type { UtmCampaign } from '../../src/lib/types';
import { asText } from '../../src/lib/links/fields';

const utms = new Hono<AppEnv>();

function normalizeWebsite(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

utms.get('/', async (c) => {
  const search = c.req.query('search')?.trim() || '';
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
  const body = await c.req.json();
  const website = normalizeWebsite(body.website);
  if (!website) return c.json({ error: 'A website URL is required' }, 400);

  const id = `utm_${nanoid(10)}`;
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO utms (id, website, source, medium, campaign, campaign_id, term, content, comments, folder, avatar, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`
  )
    .bind(
      id,
      website,
      asText(body.source),
      asText(body.medium),
      asText(body.campaign),
      // Accepts `campaign_id` from the API and `utm_id` from the builder UI.
      asText(body.campaign_id ?? body.utm_id),
      asText(body.term),
      asText(body.content),
      body.comments ?? '',
      asText(body.folder) ?? 'Campaigns',
      asText(body.avatar) ?? 'NC',
      now
    )
    .run();

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
  const body = await c.req.json();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM utms WHERE id = ?1').bind(id).first<UtmCampaign>();
  if (!existing) return c.json({ error: 'Campaign not found' }, 404);

  const website = body.website === undefined ? existing.website : normalizeWebsite(body.website);
  if (!website) return c.json({ error: 'A website URL is required' }, 400);

  const pick = (key: keyof UtmCampaign, current: string | null) => (body[key] === undefined ? current : asText(body[key]));

  await db
    .prepare(
      `UPDATE utms
       SET website = ?1, source = ?2, medium = ?3, campaign = ?4, campaign_id = ?5, term = ?6, content = ?7,
           comments = ?8, folder = ?9, archived = ?10, updated_at = ?11
       WHERE id = ?12`
    )
    .bind(
      website,
      pick('source', existing.source),
      pick('medium', existing.medium),
      pick('campaign', existing.campaign),
      pick('campaign_id', existing.campaign_id),
      pick('term', existing.term),
      pick('content', existing.content),
      body.comments ?? existing.comments,
      asText(body.folder) ?? existing.folder,
      body.archived === undefined ? existing.archived : body.archived ? 1 : 0,
      Date.now(),
      id
    )
    .run();

  const campaign = await db.prepare('SELECT * FROM utms WHERE id = ?1').bind(id).first<UtmCampaign>();
  return c.json({ campaign });
});

utms.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM utms WHERE id = ?1').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

export default utms;
