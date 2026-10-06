import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { InvoiceRow } from '../../src/lib/types';
import { renderInvoiceDocument } from '../../src/lib/invoice-document';
import { getSettings } from '../lib/settings';
import { invoiceProfile } from '../lib/invoice-profile';
import { toView } from './invoices';

/**
 * Public, read-only invoice / receipt at /s/i/<token>. Lives under /s/ so it
 * stays reachable when Cloudflare Access protects the rest of the app. The
 * token is 128 random bits and can be reset from the invoice page.
 */
const publicInvoice = new Hono<AppEnv>();

const DOCUMENT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

publicInvoice.get('/:token', async (c) => {
  const token = c.req.param('token');
  const notFound = () =>
    c.html(
      '<!DOCTYPE html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Invoice not found</title><body style="font:14px system-ui;padding:40px;text-align:center"><h1 style="font-size:18px">Invoice not found</h1><p>This invoice link is invalid or has been replaced. Ask the sender for a new link.</p></body>',
      404
    );
  if (!/^[0-9a-f]{32}$/.test(token)) return notFound();

  const db = c.env.DB;
  const [row, settings] = await Promise.all([
    db.prepare('SELECT * FROM invoices WHERE share_token = ?1').bind(token).first<InvoiceRow>(),
    getSettings(db),
  ]);
  if (!row) return notFound();

  // First client view is recorded once; the app's own previews pass ?preview=1.
  if (!row.viewed_at && c.req.query('preview') !== '1') {
    c.executionCtx.waitUntil(
      db.prepare('UPDATE invoices SET viewed_at = ?1 WHERE id = ?2 AND viewed_at IS NULL').bind(Date.now(), row.id).run().catch(() => {})
    );
  }

  const html = renderInvoiceDocument(toView(row), invoiceProfile(settings), {
    kind: c.req.query('doc') === 'receipt' ? 'receipt' : 'invoice',
    autoPrint: c.req.query('print') === '1',
  });
  return c.html(html, 200, {
    'Content-Security-Policy': DOCUMENT_CSP,
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'private, no-store',
    'X-Frame-Options': 'DENY',
  });
});

export default publicInvoice;
