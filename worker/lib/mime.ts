/**
 * Builds the text of an email (RFC 5322 + MIME): UTF-8 headers and body,
 * base64 attachments. Pure, so it runs in tests as well as in the Worker.
 */

export interface MailAttachment {
  filename: string;
  contentType: string;
  /** Base64, no line breaks. */
  base64: string;
}

export interface MailMessage {
  from: { name: string; email: string };
  to: string[];
  cc: string[];
  /** Delivered to, but never shown in the headers. */
  bcc: string[];
  replyTo?: string;
  subject: string;
  text: string;
  attachments: MailAttachment[];
}

const encoder = new TextEncoder();

export function base64Utf8(text: string): string {
  const bytes = encoder.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** 76-character lines, as MIME requires for base64 bodies. */
function wrap76(base64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 76) lines.push(base64.slice(i, i + 76));
  return lines.join('\r\n');
}

/** RFC 2047 encoded-word for headers that may hold non-ASCII text (₦, names). */
function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64Utf8(value)}?=`;
}

function quotedName(name: string): string {
  if (!/^[\x20-\x7e]*$/.test(name)) return headerText(name);
  return `"${name.replace(/(["\\])/g, '\\$1')}"`;
}

/** Builds the RFC 5322 message. Exported for tests. */
export function buildMessage(msg: MailMessage, now = new Date(), id = crypto.randomUUID()): string {
  const boundary = `=_short_invoice_${id.replace(/-/g, '')}`;
  const domain = msg.from.email.split('@')[1] ?? 'localhost';
  const headers = [
    `From: ${msg.from.name ? `${quotedName(msg.from.name)} ` : ''}<${msg.from.email}>`,
    `To: ${msg.to.join(', ')}`,
    ...(msg.cc.length ? [`Cc: ${msg.cc.join(', ')}`] : []),
    ...(msg.replyTo ? [`Reply-To: ${msg.replyTo}`] : []),
    `Subject: ${headerText(msg.subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(base64Utf8(msg.text.replace(/\r?\n/g, '\r\n'))),
    ].join('\r\n'),
    ...msg.attachments.map((a) =>
      [
        `--${boundary}`,
        `Content-Type: ${a.contentType}; name="${a.filename}"`,
        `Content-Disposition: attachment; filename="${a.filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(a.base64),
      ].join('\r\n')
    ),
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--\r\n`;
}

