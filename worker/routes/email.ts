import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getSettings } from '../lib/settings';
import { readJsonObject } from '../lib/request';
import { isMailAddress, mailSetup } from '../lib/invoice-mail';
import { sendMail, SmtpError } from '../lib/smtp';

const email = new Hono<AppEnv>();

/**
 * Sends a short test email with the SMTP details from the settings form,
 * saved or not (a blank password uses the stored one).
 */
email.post('/test', async (c) => {
  const body = (await readJsonObject(c)) ?? {};
  const setup = mailSetup(await getSettings(c.env.DB), body);
  if (!setup.ok) return c.json({ error: setup.error }, 400);
  const to = typeof body.to === 'string' && body.to.trim() ? body.to.trim() : setup.value.from.email;
  if (!isMailAddress(to)) return c.json({ error: 'Enter a valid address for the test email' }, 400);

  try {
    await sendMail(setup.value.smtp, {
      from: setup.value.from,
      to: [to],
      cc: [],
      bcc: [],
      replyTo: setup.value.replyTo || undefined,
      subject: 'Test email from your invoicing workspace',
      text: `This is a test email.\n\nIf you can read it, invoices and receipts can be sent from the app through ${setup.value.smtp.host}.`,
      attachments: [],
    });
  } catch (err) {
    if (!(err instanceof SmtpError)) console.error('SMTP test failed', err);
    const message = err instanceof SmtpError ? err.message : 'Could not reach the mail server. Check the host, port and security.';
    return c.json({ error: message }, 502);
  }
  return c.json({ ok: true, to });
});

export default email;
