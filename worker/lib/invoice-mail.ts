import { LIMITS, parseEmail, parseMultiline, parseText, type Result } from '../../src/lib/validate';
import { validateSetting, type SettingsMap } from './settings';
import type { MailAttachment, SmtpConfig, SmtpSecurity } from './smtp';

/** Most emails the app will send in any 24 hours: a guard while the app has no login. */
export const DAILY_EMAIL_CAP = 100;
export const MAX_RECIPIENTS = 10;
/** Per attachment, base64 characters (about 3 MB of PDF). */
export const MAX_ATTACHMENT_BASE64 = 4_000_000;

export type AttachmentKind = 'invoice' | 'receipt';

export interface SendRequest {
  to: string[];
  cc: string[];
  copyMe: boolean;
  subject: string;
  message: string;
  attachments: (MailAttachment & { kind: AttachmentKind })[];
}

const fail = <T>(error: string): Result<T> => ({ ok: false, error });

/**
 * Stricter than parseEmail: addresses go into SMTP commands and headers, so
 * nothing that could close `<…>` or start a second address is allowed.
 */
const MAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
export const isMailAddress = (value: string) => MAIL_RE.test(value) && value.length <= 254;

function emailList(input: unknown, label: string): Result<string[]> {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,;]/) : input == null ? [] : null;
  if (!raw) return fail(`${label} must be a list of email addresses`);
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const email = parseEmail(item, label);
    if (!email.ok) return email;
    if (!email.value) continue;
    if (!isMailAddress(email.value)) return fail(`${label} "${email.value}" is not a valid email address`);
    if (!out.includes(email.value.toLowerCase())) out.push(email.value.toLowerCase());
  }
  return { ok: true, value: out };
}

/** Validates the Send modal's payload. Attachments must really be PDFs. */
export function parseSendRequest(body: Record<string, unknown>): Result<SendRequest> {
  const to = emailList(body.to, 'Recipient email');
  if (!to.ok) return to;
  if (to.value.length === 0) return fail('A recipient email is required');
  const cc = emailList(body.cc, 'CC email');
  if (!cc.ok) return cc;
  if (to.value.length + cc.value.length > MAX_RECIPIENTS) return fail(`Send to at most ${MAX_RECIPIENTS} addresses at once`);

  const subject = parseText(body.subject, 'Subject', 300);
  if (!subject.ok) return subject;
  if (!subject.value) return fail('A subject is required');
  const message = parseMultiline(body.message, 'Message', 10_000);
  if (!message.ok) return message;
  if (!message.value) return fail('A message is required');

  const list = Array.isArray(body.attachments) ? body.attachments : [];
  if (list.length > 2) return fail('Attach at most two documents');
  const attachments: SendRequest['attachments'] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') return fail('Attachment is invalid');
    const a = raw as Record<string, unknown>;
    const kind = a.kind === 'invoice' || a.kind === 'receipt' ? a.kind : null;
    if (!kind) return fail('Attachment must be the invoice or the receipt');
    if (attachments.some((x) => x.kind === kind)) return fail(`The ${kind} is attached twice`);
    const filename = typeof a.filename === 'string' ? a.filename.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.pdf$/.test(filename)) return fail('Attachment names must be simple .pdf file names');
    const content = typeof a.content === 'string' ? a.content.replace(/\s+/g, '') : '';
    if (content.length > MAX_ATTACHMENT_BASE64) return fail('An attachment is too large (max about 3 MB)');
    // "%PDF-" in base64; anything else is not a PDF the app produced.
    if (!content.startsWith('JVBERi0') || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return fail('Attachments must be PDF files');
    attachments.push({ kind, filename, contentType: 'application/pdf', base64: content });
  }

  return {
    ok: true,
    value: { to: to.value, cc: cc.value, copyMe: body.copy_me === true, subject: subject.value, message: message.value, attachments },
  };
}

export interface MailSetup {
  smtp: SmtpConfig;
  from: { name: string; email: string };
  replyTo: string;
}

/**
 * SMTP settings, optionally overlaid with unsaved values from the settings
 * form (for "Send test email"). A blank password keeps the stored one.
 */
export function mailSetup(settings: SettingsMap, overrides: Record<string, unknown> = {}): Result<MailSetup> {
  const merged: SettingsMap = { ...settings };
  for (const key of ['smtp_host', 'smtp_port', 'smtp_security', 'smtp_username', 'smtp_password', 'smtp_from_name', 'smtp_from_email', 'smtp_reply_to']) {
    if (overrides[key] === undefined) continue;
    if (key === 'smtp_password' && (overrides[key] === '' || overrides[key] === null)) continue;
    const checked = validateSetting(key, overrides[key]);
    if (!checked.ok) return checked;
    merged[key] = checked.value;
  }
  const host = (merged.smtp_host ?? '').trim();
  const fromEmail = (merged.smtp_from_email ?? '').trim();
  if (!host || !fromEmail) return fail('Email sending is not set up yet. Add your SMTP details in Settings → Invoice.');
  if (!isMailAddress(fromEmail)) return fail('The sender email in Settings → Invoice is not valid.');
  const replyTo = merged.smtp_reply_to || merged.inv_contact_email || '';
  const port = Number(merged.smtp_port) || 465;
  if (port === 25) return fail('Cloudflare blocks port 25. Use 465 (SSL/TLS) or 587 (STARTTLS).');
  return {
    ok: true,
    value: {
      smtp: {
        host,
        port,
        security: (['tls', 'starttls', 'none'].includes(merged.smtp_security) ? merged.smtp_security : 'tls') as SmtpSecurity,
        username: merged.smtp_username ?? '',
        password: merged.smtp_password ?? '',
      },
      from: { name: (merged.smtp_from_name || merged.inv_legal_name || '').slice(0, LIMITS.shortText), email: fromEmail },
      replyTo: isMailAddress(replyTo) ? replyTo : '',
    },
  };
}
