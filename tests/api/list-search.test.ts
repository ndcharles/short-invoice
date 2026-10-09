import { afterAll, describe, expect, it } from 'vitest';
import { api, uniqueAlias } from './helpers';

/**
 * The list searches (links, UTM campaigns, invoices) have to cope with whatever gets pasted into the box.
 * D1 refuses a LIKE pattern longer than 50 bytes, so a pasted address used to end in a server error; and LIKE
 * read the person's own % and _ as wildcards. These run against the real (local) D1.
 */
const enc = encodeURIComponent;
const stamp = Date.now().toString(36);
/** Over 100 characters, and different for every list. */
const long = (label: string) => `${label}-${stamp}-${'a-fairly-long-piece-of-text-'.repeat(4)}end`;

/** Ids to delete when everything is done, so the shared test database is left as it was found. */
const made: string[] = [];
afterAll(async () => {
  for (const url of made) await api('DELETE', url);
});

/** The ids a search returns, after checking it did not fail. */
async function search(path: string, key: string, text: string): Promise<string[]> {
  const res = await api('GET', `${path}?search=${enc(text)}`);
  expect(res.status, `${text.length} characters: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
  return (res.body[key] as { id: string }[]).map((row) => row.id);
}

/** Searches of every length around the limits (a LIKE pattern of 50 bytes, the 100 and 200 character caps) all work. */
async function everyLengthWorks(path: string) {
  for (const length of [1, 47, 48, 49, 50, 51, 99, 100, 101, 199, 200, 201, 1000]) {
    const res = await api('GET', `${path}?search=${enc('q'.repeat(length))}`);
    expect(res.status, `${length} characters`).toBe(200);
  }
}

describe('links search', () => {
  async function create(dest: string, extra: Record<string, unknown> = {}) {
    const res = await api('POST', '/api/links', { dest, alias: uniqueAlias('ls'), ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    made.push(`/api/links/${res.body.link.id}`);
    return res.body.link as { id: string; alias: string };
  }

  it('finds a link by a long pasted address, or by a long piece of it', async () => {
    const dest = `https://example.com/${long('link')}`;
    expect(dest.length).toBeGreaterThan(100);
    const link = await create(dest);
    expect(await search('/api/links', 'links', dest)).toEqual([link.id]);
    expect(await search('/api/links', 'links', dest.slice(12, 100))).toEqual([link.id]);
    expect(await search('/api/links', 'links', `${dest}-and-more`)).toEqual([]);
  });

  it('works for a search of any length', async () => {
    await everyLengthWorks('/api/links');
  });

  it('looks in the short link, the destination and the comments, and ignores capital letters', async () => {
    const link = await create(`https://example.com/dest-${stamp}-Mixed`, { comments: `Note ${stamp} For The Team` });
    for (const text of [link.alias, link.alias.toUpperCase(), `dest-${stamp}-mixed`, `NOTE ${stamp} for the TEAM`]) {
      expect(await search('/api/links', 'links', text), text).toContain(link.id);
    }
  });

  it('takes % and _ as the characters they are, not as wildcards', async () => {
    const tag = `wild${stamp}`;
    const percent = await create('https://example.com/a', { comments: `${tag} 50% off` });
    const plain = await create('https://example.com/b', { comments: `${tag} 50 off` });
    const under = await create('https://example.com/c', { comments: `${tag} a_c` });
    const other = await create('https://example.com/d', { comments: `${tag} abc` });
    expect(await search('/api/links', 'links', `${tag} 50%`)).toEqual([percent.id]);
    expect(await search('/api/links', 'links', `${tag} a_c`)).toEqual([under.id]);
    const withPercent = await search('/api/links', 'links', '%');
    expect(withPercent).toContain(percent.id);
    expect(withPercent).not.toContain(plain.id);
    expect(withPercent).not.toContain(other.id);
  });
});

describe('UTM campaign search', () => {
  async function create(body: Record<string, unknown>) {
    const res = await api('POST', '/api/utms', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    made.push(`/api/utms/${res.body.campaign.id}`);
    return res.body.campaign as { id: string };
  }

  it('finds a campaign by a long pasted address, even though most of its fields are empty', async () => {
    const website = `https://example.com/${long('utm')}`;
    const campaign = await create({ website }); // source, medium, campaign and content are all empty
    expect(await search('/api/utms', 'campaigns', website)).toEqual([campaign.id]);
    expect(await search('/api/utms', 'campaigns', website.slice(12, 100))).toEqual([campaign.id]);
    expect(await search('/api/utms', 'campaigns', `${website}-and-more`)).toEqual([]);
  });

  it('works for a search of any length', async () => {
    await everyLengthWorks('/api/utms');
  });

  it('looks in the website, source, medium, campaign and content, and ignores capital letters', async () => {
    const campaign = await create({
      website: `https://example.com/utm-${stamp}`,
      source: `Source-${stamp}`,
      medium: `Medium-${stamp}`,
      campaign: `Campaign-${stamp}`,
      content: `Content-${stamp}`,
    });
    for (const text of [`utm-${stamp}`, `source-${stamp}`, `MEDIUM-${stamp}`, `campaign-${stamp}`, `Content-${stamp}`]) {
      expect(await search('/api/utms', 'campaigns', text), text).toContain(campaign.id);
    }
  });

  it('takes % and _ as the characters they are, not as wildcards', async () => {
    const tag = `wild${stamp}`;
    const percent = await create({ website: 'https://example.com/a', campaign: `${tag} 50% off` });
    const plain = await create({ website: 'https://example.com/b', campaign: `${tag} 50 off` });
    const under = await create({ website: 'https://example.com/c', campaign: `${tag} a_c` });
    const other = await create({ website: 'https://example.com/d', campaign: `${tag} abc` });
    expect(await search('/api/utms', 'campaigns', `${tag} 50%`)).toEqual([percent.id]);
    expect(await search('/api/utms', 'campaigns', `${tag} a_c`)).toEqual([under.id]);
    const withPercent = await search('/api/utms', 'campaigns', '%');
    expect(withPercent).toContain(percent.id);
    expect(withPercent).not.toContain(plain.id);
    expect(withPercent).not.toContain(other.id);
  });
});

describe('invoice search', () => {
  async function create(client_name: string, extra: Record<string, unknown> = {}) {
    const res = await api('POST', '/api/invoices', { client_name, items: [{ name: 'Work', desc: '', qty: 1, unitPrice: 100_000 }], ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    made.push(`/api/invoices/${res.body.invoice.id}`);
    return res.body.invoice as { id: string; number: string };
  }

  it('finds an invoice by a long client name or email address', async () => {
    const name = `Client ${long('inv')}`;
    const email = `billing-${stamp}@${'accounts.'.repeat(6)}example.test`;
    expect(name.length).toBeGreaterThan(100);
    const invoice = await create(name, { client_email: email });
    // Searches are cut to their first 100 characters, which still have to match.
    expect(await search('/api/invoices', 'invoices', name)).toEqual([invoice.id]);
    expect(await search('/api/invoices', 'invoices', email)).toEqual([invoice.id]);
    expect(await search('/api/invoices', 'invoices', `x${name}`)).toEqual([]);
  });

  it('works for a search of any length', async () => {
    await everyLengthWorks('/api/invoices');
  });

  it('looks in the number, the client name and the email, and ignores capital letters', async () => {
    const invoice = await create(`Acme ${stamp} Holdings`, { client_email: `Pay-${stamp}@Acme.Test` });
    for (const text of [invoice.number, invoice.number.toLowerCase(), `ACME ${stamp} holdings`, `pay-${stamp}@acme.test`]) {
      expect(await search('/api/invoices', 'invoices', text), text).toContain(invoice.id);
    }
  });

  it('takes % and _ as the characters they are, not as wildcards', async () => {
    const tag = `wild${stamp}`;
    const percent = await create(`${tag} 50% off`);
    const plain = await create(`${tag} 50 off`);
    const under = await create(`${tag} a_c`);
    const other = await create(`${tag} abc`);
    expect(await search('/api/invoices', 'invoices', `${tag} 50%`)).toEqual([percent.id]);
    expect(await search('/api/invoices', 'invoices', `${tag} a_c`)).toEqual([under.id]);
    const withPercent = await search('/api/invoices', 'invoices', '%');
    expect(withPercent).toContain(percent.id);
    expect(withPercent).not.toContain(plain.id);
    expect(withPercent).not.toContain(other.id);
  });

  it('counts the tabs for the same search, long or not', async () => {
    const name = `Counted ${long('count')}`;
    const invoice = await create(name);
    const res = await api('GET', `/api/invoices?search=${enc(name)}`);
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ all: 1, draft: 1 });
    expect((res.body.invoices as { id: string }[])[0].id).toBe(invoice.id);
  });
});
