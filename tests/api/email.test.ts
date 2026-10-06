import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { api } from './helpers';
import type { InvoiceRow } from '@/lib/types';

/** A tiny SMTP server that records what the Worker sends. */
interface Received {
  auth: string | null;
  from: string;
  rcpt: string[];
  data: string;
}

function fakeSmtp() {
  const received: Received[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let current: Received = { auth: null, from: '', rcpt: [], data: '' };
    let loginStep: 'user' | 'pass' | null = null;
    let loginUser = '';
    socket.write('220 fake.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push(current);
          current = { auth: current.auth, from: '', rcpt: [], data: '' };
          socket.write('250 2.0.0 queued\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const upper = line.toUpperCase();
        if (loginStep === 'user') {
          loginUser = Buffer.from(line, 'base64').toString();
          loginStep = 'pass';
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (loginStep === 'pass') {
          current.auth = `${loginUser}:${Buffer.from(line, 'base64').toString()}`;
          loginStep = null;
          socket.write('235 ok\r\n');
        } else if (upper.startsWith('EHLO')) socket.write('250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10000000\r\n');
        else if (upper.startsWith('AUTH PLAIN ')) {
          const [, user, pass] = Buffer.from(line.slice(11), 'base64').toString().split('\u0000');
          current.auth = `${user}:${pass}`;
          socket.write(pass === 'wrong' ? '535 5.7.8 Bad credentials\r\n' : '235 2.7.0 Accepted\r\n');
        } else if (upper === 'AUTH LOGIN') {
          loginStep = 'user';
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (upper.startsWith('MAIL FROM:')) {
          current.from = line.slice(10);
          socket.write('250 ok\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          if (line.includes('reject')) socket.write('550 5.1.1 No such user\r\n');
          else {
            current.rcpt.push(line.slice(8));
            socket.write('250 ok\r\n');
          }
        } else if (upper === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (upper === 'QUIT') {
          socket.end('221 bye\r\n');
        } else socket.write('502 unknown\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  return {
    received,
    listen: () => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const PDF = Buffer.from('%PDF-1.7\n% test document\n').toString('base64');
const smtp = fakeSmtp();
let port = 0;

const configure = (patch: Record<string, string>) => api('PATCH', '/api/settings', patch);
const mime = (data: string, header: string) => new RegExp(`^${header}: (.*)$`, 'mi').exec(data)?.[1];

async function newInvoice(): Promise<InvoiceRow> {
  const res = await api('POST', '/api/invoices', {
    client_name: 'Mail Test Ltd',
    client_email: 'ap@mailtest.example',
    items: [{ name: 'Work', desc: '', qty: 1, unitPrice: 1000 }],
  });
  return res.body.invoice as InvoiceRow;
}

const sendBody = (over: Record<string, unknown> = {}) => ({
  to: ['ap@mailtest.example'],
  cc: ['finance@mailtest.example'],
  copy_me: true,
  subject: 'Invoice ₦1,075 from Test Co',
  message: 'Hi,\n.\nPlease find it attached.\n\nThanks,\nTest Co',
  attachments: [{ kind: 'invoice', filename: 'Invoice-T-1.pdf', content: PDF }],
  ...over,
});

beforeAll(async () => {
  port = await smtp.listen();
});

afterAll(async () => {
  await configure({ smtp_host: '', smtp_from_email: '', smtp_username: '', smtp_password_clear: 'true' });
  await smtp.close();
});

describe('SMTP settings', () => {
  it('stores the password but never returns or exports it', async () => {
    const saved = await configure({ smtp_password: 's3cret-pass' });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.smtp_password).toBeUndefined();
    expect(saved.body.settings.smtp_password_set).toBe('true');

    const read = await api('GET', '/api/settings');
    expect(read.body.settings.smtp_password).toBeUndefined();
    expect(JSON.stringify((await api('GET', '/api/export')).body)).not.toContain('s3cret-pass');

    // Saving the form again without typing a password keeps it.
    await configure({ smtp_password: '', smtp_host: '' });
    expect((await api('GET', '/api/settings')).body.settings.smtp_password_set).toBe('true');
  });

  it('validates the SMTP fields', async () => {
    expect((await configure({ smtp_host: 'not a host' })).status).toBe(400);
    expect((await configure({ smtp_port: '70000' })).status).toBe(400);
    expect((await configure({ smtp_security: 'ssl3' })).status).toBe(400);
    expect((await configure({ smtp_from_email: 'nope' })).status).toBe(400);
  });
});

describe('sending invoices', () => {
  it('explains when email is not set up', async () => {
    await configure({ smtp_host: '', smtp_from_email: '' });
    const inv = await newInvoice();
    const res = await api('POST', `/api/invoices/${inv.id}/send`, sendBody());
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Settings');
  });

  it('logs in, sends the PDF, issues the draft and records it', async () => {
    await configure({
      smtp_host: 'localhost',
      smtp_port: String(port),
      smtp_security: 'none',
      smtp_username: 'billing@test.example',
      smtp_password: 'app-password',
      smtp_from_name: 'Test Co ₦',
      smtp_from_email: 'billing@test.example',
      smtp_reply_to: 'owner@test.example',
    });
    const inv = await newInvoice();
    expect(inv.status).toBe('draft');
    const before = smtp.received.length;

    const res = await api('POST', `/api/invoices/${inv.id}/send`, sendBody());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.invoice.status).toBe('sent');
    expect(res.body.emails[0]).toMatchObject({ status: 'sent', attachments: 'invoice', recipients: 'ap@mailtest.example, finance@mailtest.example' });

    const mail = smtp.received[before];
    expect(mail.auth).toBe('billing@test.example:app-password');
    expect(mail.from).toBe('<billing@test.example>');
    // To, Cc and the "send me a copy" BCC are all delivered…
    expect(mail.rcpt).toEqual(['<ap@mailtest.example>', '<finance@mailtest.example>', '<owner@test.example>']);
    // …but the BCC never appears in the headers.
    expect(mail.data).not.toContain('owner@test.example>,');
    expect(mime(mail.data, 'Bcc')).toBeUndefined();
    expect(mime(mail.data, 'Reply-To')).toBe('owner@test.example');
    expect(mime(mail.data, 'Subject')).toMatch(/^=\?UTF-8\?B\?/);
    expect(mail.data).toContain('Content-Disposition: attachment; filename="Invoice-T-1.pdf"');
    expect(mail.data).toContain(PDF.slice(0, 20));

    // The body survives dot-stuffing and UTF-8.
    const textPart = /Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(mail.data)?.[1] ?? '';
    expect(Buffer.from(textPart.replace(/\r\n/g, ''), 'base64').toString()).toBe('Hi,\r\n.\r\nPlease find it attached.\r\n\r\nThanks,\r\nTest Co');

    const fetched = await api('GET', `/api/invoices/${inv.id}`);
    expect(fetched.body.emails).toHaveLength(1);
  });

  it('reports the server reply when a recipient is refused, and logs the failure', async () => {
    const inv = await newInvoice();
    const res = await api('POST', `/api/invoices/${inv.id}/send`, sendBody({ to: ['reject@mailtest.example'] }));
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('550');
    expect(res.body.invoice.status).toBe('draft');
    expect(res.body.emails[0].status).toBe('failed');
  });

  it('reports a wrong password', async () => {
    await configure({ smtp_password: 'wrong' });
    const inv = await newInvoice();
    const res = await api('POST', `/api/invoices/${inv.id}/send`, sendBody());
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Login failed: 535');
    await configure({ smtp_password: 'app-password' });
  });

  it.each([
    [{ to: [] }, 'recipient'],
    [{ to: ['a@b.co', 'not-an-email'] }, 'valid'],
    [{ to: ['x<y@evil.com'] }, 'valid'],
    [{ to: Array.from({ length: 11 }, (_, i) => `p${i}@mailtest.example`) }, 'at most'],
    [{ subject: 'Hi\r\nBcc: victim@example.com' }, 'invalid'],
    [{ attachments: [{ kind: 'invoice', filename: 'x.pdf', content: Buffer.from('<html>').toString('base64') }] }, 'PDF'],
    [{ attachments: [{ kind: 'invoice', filename: '../../x.pdf', content: PDF }] }, 'file names'],
    [{ attachments: [{ kind: 'contract', filename: 'x.pdf', content: PDF }] }, 'invoice or the receipt'],
  ])('rejects %j', async (over, message) => {
    const inv = await newInvoice();
    const res = await api('POST', `/api/invoices/${inv.id}/send`, sendBody(over));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  it('sends a test email with unsaved settings, keeping the saved password', async () => {
    const before = smtp.received.length;
    const res = await api('POST', '/api/email/test', { smtp_from_name: 'Typed Name', to: 'me@test.example' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mail = smtp.received[before];
    expect(mail.auth).toBe('billing@test.example:app-password');
    expect(mime(mail.data, 'From')).toBe('"Typed Name" <billing@test.example>');
  });

  it('refuses to send a password unencrypted to a remote server', async () => {
    const res = await api('POST', '/api/email/test', { smtp_host: 'smtp.example.com', smtp_security: 'none' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('without encryption');
  });

  it('refuses port 25', async () => {
    const res = await api('POST', '/api/email/test', { smtp_port: '25' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('port 25');
  });
});
