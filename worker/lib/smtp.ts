import { connect } from 'cloudflare:sockets';
import { base64Utf8, buildMessage, type MailMessage } from './mime';

/**
 * Minimal SMTP client over Workers TCP sockets: implicit TLS (465), STARTTLS
 * (587) or plain (local testing only), AUTH PLAIN/LOGIN, one message with
 * attachments. Cloudflare blocks outbound port 25, so use a submission port.
 */

export type { MailAttachment, MailMessage } from './mime';
export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
}

export class SmtpError extends Error {}

const TIMEOUT_MS = 20_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Reads SMTP replies line by line; a reply ends with "NNN " (space, not dash). */
class ReplyReader {
  private buffer = '';
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  /** Lets go of the stream so the socket can be upgraded to TLS. */
  release() {
    this.reader.releaseLock();
  }

  async read(): Promise<{ code: number; text: string; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) {
        const { value, done } = await this.reader.read();
        if (done) throw new SmtpError('The mail server closed the connection');
        this.buffer += decoder.decode(value, { stream: true });
        continue;
      }
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        return { code: Number(line.slice(0, 3)), text: lines.map((l) => l.slice(4)).join(' '), lines };
      }
    }
  }
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new SmtpError(`The mail server did not answer (${what})`)), TIMEOUT_MS);
    }),
  ]);
}

/** Sends one message. Throws SmtpError with the server's reply on failure. */
export async function sendMail(config: SmtpConfig, msg: MailMessage): Promise<void> {
  const local = config.host === 'localhost' || config.host === '127.0.0.1';
  if (config.security === 'none' && config.username && !local) {
    throw new SmtpError('Refusing to send the SMTP password without encryption. Use SSL/TLS or STARTTLS.');
  }

  let socket = connect(
    { hostname: config.host, port: config.port },
    { secureTransport: config.security === 'tls' ? 'on' : config.security === 'starttls' ? 'starttls' : 'off', allowHalfOpen: false }
  );
  let writer = socket.writable.getWriter();
  let replies = new ReplyReader(socket.readable.getReader());

  const send = (line: string) => withTimeout(writer.write(encoder.encode(`${line}\r\n`)), 'write');
  const expect = async (codes: number[], what: string) => {
    const reply = await withTimeout(replies.read(), what);
    if (!codes.includes(reply.code)) throw new SmtpError(`${what} failed: ${reply.code} ${reply.text}`.trim());
    return reply;
  };
  const command = async (line: string, codes: number[], what: string) => {
    await send(line);
    return expect(codes, what);
  };

  try {
    await expect([220], 'Connecting');
    const hello = 'short-invoice.local';
    let ehlo = await command(`EHLO ${hello}`, [250], 'EHLO');

    if (config.security === 'starttls') {
      await command('STARTTLS', [220], 'STARTTLS');
      writer.releaseLock();
      replies.release();
      socket = socket.startTls();
      writer = socket.writable.getWriter();
      replies = new ReplyReader(socket.readable.getReader());
      ehlo = await command(`EHLO ${hello}`, [250], 'EHLO after STARTTLS');
    }

    if (config.username) {
      const auth = ehlo.lines.find((l) => /^250[ -]AUTH\b/i.test(l))?.toUpperCase() ?? '';
      if (auth.includes('PLAIN') || !auth.includes('LOGIN')) {
        await command(`AUTH PLAIN ${base64Utf8(`\u0000${config.username}\u0000${config.password}`)}`, [235], 'Login');
      } else {
        await command('AUTH LOGIN', [334], 'Login');
        await command(base64Utf8(config.username), [334], 'Login (username)');
        await command(base64Utf8(config.password), [235], 'Login (password)');
      }
    }

    await command(`MAIL FROM:<${msg.from.email}>`, [250], 'Sender');
    for (const rcpt of [...msg.to, ...msg.cc, ...msg.bcc]) await command(`RCPT TO:<${rcpt}>`, [250, 251], `Recipient ${rcpt}`);
    await command('DATA', [354], 'DATA');
    // Dot-stuffing: a line starting with "." gets a second one.
    const body = buildMessage(msg).replace(/^\./gm, '..');
    await withTimeout(writer.write(encoder.encode(`${body}\r\n.\r\n`)), 'sending the message');
    await expect([250], 'Delivering the message');
    try {
      await send('QUIT');
    } catch {
      /* the message is already accepted */
    }
  } finally {
    try {
      await socket.close();
    } catch {
      /* already closed */
    }
  }
}
