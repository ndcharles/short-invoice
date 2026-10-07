import { describe, expect, it } from 'vitest';
import { checkFetchUrl, isBlockedHost, readLimited } from '../../worker/lib/ssrf';
import { decryptSecret, encryptSecret, isEncrypted } from '../../worker/lib/secrets';
import { newSetupCode, normaliseCode, passwordProblem, setupCodeMatches, sha256, listOf, displayName } from '../../worker/lib/auth';
import { buildMessage } from '../../worker/lib/mime';
import { mailSetup, parseSendRequest, isMailAddress, MAX_RECIPIENTS } from '../../worker/lib/invoice-mail';
import { changedFields } from '../../worker/lib/activity';
import { initials } from '../../worker/lib/initials';
import type { Env } from '../../worker/env';

describe('isBlockedHost / checkFetchUrl', () => {
  it.each([
    'localhost', 'LOCALHOST', 'app.localhost', 'printer.local', 'db.internal', 'nas.lan', 'router.home', 'x.home.arpa', 'intranet', 'server1', '',
    '127.0.0.1', '127.255.255.255', '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.127.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.0.0.8', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '[::1]', '::1', '::', '::ffff:7f00:1', 'fd12:3456::1', 'fc00::1', 'fe80::1', '2002:7f00:1::1', '64:ff9b::7f00:1',
  ])('blocks %j', (host) => expect(isBlockedHost(host)).toBe(true));

  it.each(['example.com', 'www.example.co.uk', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '192.169.0.1', '2606:4700:4700::1111', '[2001:db8::1]'])(
    'allows %j',
    (host) => expect(isBlockedHost(host)).toBe(false)
  );

  it('normalises odd IPv4 spellings before judging them', () => {
    for (const odd of ['http://2130706433/', 'http://0x7f.0.0.1/', 'http://127.1/', 'http://0177.0.0.1/', 'http://[::ffff:127.0.0.1]/']) {
      expect(checkFetchUrl(new URL(odd)), odd).not.toBeNull();
    }
  });

  it('accepts a normal web address and refuses everything else', () => {
    expect(checkFetchUrl(new URL('https://example.com/page?x=1'))).toBeNull();
    expect(checkFetchUrl(new URL('http://example.com:80/'))).toBeNull();
    expect(checkFetchUrl(new URL('https://example.com:443/'))).toBeNull();
    for (const bad of ['ftp://example.com/', 'file:///etc/passwd', 'https://u:p@example.com/', 'https://example.com:22/', 'https://example.com:8080/']) {
      expect(checkFetchUrl(new URL(bad)), bad).not.toBeNull();
    }
  });
});

describe('readLimited', () => {
  const streamOf = (chunks: string[]) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      })
    );

  it('reads a small body whole', async () => {
    expect(await readLimited(streamOf(['hello ', 'world']), 100)).toBe('hello world');
  });

  it('stops at the cap, even for a body that never ends', async () => {
    let pulled = 0;
    const endless = new Response(
      new ReadableStream({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new TextEncoder().encode('x'.repeat(1000)));
        },
      })
    );
    const text = await readLimited(endless, 5000);
    expect(text.length).toBe(5000);
    expect(pulled).toBeLessThan(20);
  });

  it('handles an empty response', async () => {
    expect(await readLimited(new Response(null), 10)).toBe('');
  });
});

describe('secrets at rest', () => {
  const env = { AUTH_PEPPER: 'pepper-one' } as Env;

  it('encrypts, never repeats the plain text, and decrypts again', async () => {
    const stored = await encryptSecret(env, 'my smtp password');
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain('my smtp password');
    expect(await decryptSecret(env, stored)).toBe('my smtp password');
  });

  it('uses a fresh nonce each time', async () => {
    expect(await encryptSecret(env, 'same')).not.toBe(await encryptSecret(env, 'same'));
  });

  it('cannot be decrypted with another pepper, or when damaged', async () => {
    const stored = await encryptSecret(env, 'secret');
    expect(await decryptSecret({ AUTH_PEPPER: 'pepper-two' } as Env, stored)).toBe('');
    expect(await decryptSecret(env, stored.slice(0, -4) + 'AAAA')).toBe('');
    expect(await decryptSecret(env, 'enc1:garbage')).toBe('');
    expect(await decryptSecret({} as Env, stored)).toBe('');
  });

  it('stores the text as typed when there is no pepper (local development), and leaves empty alone', async () => {
    expect(await encryptSecret({} as Env, 'plain')).toBe('plain');
    expect(await decryptSecret({} as Env, 'plain')).toBe('plain');
    expect(await encryptSecret(env, '')).toBe('');
  });
});

describe('account helpers', () => {
  it('setup codes are 10 unambiguous characters in two groups, and differ every time', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newSetupCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  });

  it('a code matches however it is typed, and only itself', async () => {
    const hash = await sha256(normaliseCode('K7MD2-XQ9PA'));
    expect(await setupCodeMatches('k7md2-xq9pa', hash)).toBe(true);
    expect(await setupCodeMatches(' K7MD2 XQ9PA ', hash)).toBe(true);
    expect(await setupCodeMatches('K7MD2-XQ9PB', hash)).toBe(false);
    expect(await setupCodeMatches('K7MD2-XQ9PA', null)).toBe(false);
    expect(await setupCodeMatches('', hash)).toBe(false);
  });

  it('sha256 is stable and base64url', async () => {
    expect(await sha256('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });

  it.each([
    ['short', 'at least 12'],
    ['a'.repeat(129), 'at most 128'],
    ['nobody-is-my-password', 'email'],
    ['aaaaaaaaaaaaaaaa', 'too easy'],
    [undefined, 'Choose a password'],
  ])('rejects the password %j', (password, message) => {
    expect(passwordProblem(password, 'nobody@example.org')).toContain(message);
  });

  it('accepts a long ordinary password', () => {
    expect(passwordProblem('correct horse battery staple', 'nobody@example.org')).toBeNull();
  });

  it('formats names, initials and admin lists', () => {
    expect(displayName('ada.obi@example.org')).toBe('ada.obi');
    expect(displayName('ada@example.org', '  Ada Obi ')).toBe('Ada Obi');
    expect(initials('Ada Obi')).toBe('AO');
    expect(initials('ada')).toBe('AD');
    expect(initials('')).toBe('NC');
    expect(listOf(' A@x.com, b@y.com  C@Z.com\nd@e.com ')).toEqual(['a@x.com', 'b@y.com', 'c@z.com', 'd@e.com']);
    expect(listOf(undefined)).toEqual([]);
  });
});

describe('changedFields (activity wording)', () => {
  const labels = { dest: 'destination', tag: 'tag', folder: 'folder' };
  it('names only what changed', () => {
    expect(changedFields({ dest: 'a', tag: 'x' }, { dest: 'b', tag: 'x' }, labels)).toBe('destination');
    expect(changedFields({ dest: 'a', tag: 'x', folder: 'f' }, { dest: 'b', tag: 'y', folder: 'g' }, labels)).toBe('destination, tag and folder');
    expect(changedFields({ dest: 'a' }, { dest: 'a' }, labels)).toBe('');
    expect(changedFields({ dest: 'a' }, {}, labels)).toBe('');
    expect(changedFields({ tag: null }, { tag: 'new' }, labels)).toBe('tag');
  });
});

describe('buildMessage (email text)', () => {
  const base = {
    from: { name: 'Acme ₦ Ltd', email: 'billing@acme.test' },
    to: ['ada@client.test'],
    cc: ['finance@client.test'],
    bcc: ['owner@acme.test'],
    replyTo: 'owner@acme.test',
    subject: 'Invoice ₦1,075 from Acme',
    text: 'Hi,\nThanks.\n.\nBye',
    attachments: [{ filename: 'Invoice-1.pdf', contentType: 'application/pdf', base64: 'JVBERi0xLjc'.repeat(30) }],
  };
  const msg = buildMessage(base, new Date('2026-10-07T10:00:00Z'), '11111111-2222-3333-4444-555555555555');

  it('has the right headers, with non-ASCII text encoded', () => {
    expect(msg).toMatch(/^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <billing@acme\.test>\r\n/);
    expect(msg).toContain('To: ada@client.test\r\n');
    expect(msg).toContain('Cc: finance@client.test\r\n');
    expect(msg).toContain('Reply-To: owner@acme.test\r\n');
    expect(msg).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
    expect(msg).toContain('Date: Wed, 07 Oct 2026 10:00:00 +0000\r\n');
    expect(msg).toContain('Message-ID: <11111111-2222-3333-4444-555555555555@acme.test>');
    expect(msg).toContain('MIME-Version: 1.0');
  });

  it('never lists the Bcc address', () => expect(msg).not.toContain('Bcc'));

  it('keeps a plain subject readable and quotes a plain display name', () => {
    const plain = buildMessage({ ...base, from: { name: 'Acme "Ltd"', email: 'b@acme.test' }, subject: 'Invoice 12' });
    expect(plain).toContain('From: "Acme \\"Ltd\\"" <b@acme.test>');
    expect(plain).toContain('Subject: Invoice 12\r\n');
  });

  it('carries the text and the PDF as base64 parts with short lines', () => {
    expect(msg).toContain('Content-Type: text/plain; charset=utf-8');
    expect(msg).toContain('Content-Type: application/pdf; name="Invoice-1.pdf"');
    expect(msg).toContain('Content-Disposition: attachment; filename="Invoice-1.pdf"');
    for (const line of msg.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
    const body = msg.split('Content-Transfer-Encoding: base64\r\n\r\n')[2] ?? '';
    for (const line of body.split('\r\n').filter((l) => l && !l.startsWith('--'))) expect(line.length).toBeLessThanOrEqual(76);
    const textPart = msg.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
    expect(Buffer.from(textPart, 'base64').toString()).toBe('Hi,\r\nThanks.\r\n.\r\nBye');
  });

  it('closes the multipart boundary', () => {
    const boundary = /boundary="([^"]+)"/.exec(msg)![1];
    expect(msg.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });
});

describe('email request validation', () => {
  const PDF = Buffer.from('%PDF-1.7\n').toString('base64');
  const ok = { to: ['a@b.co'], subject: 'Hi', message: 'Body', attachments: [{ kind: 'invoice', filename: 'Invoice-1.pdf', content: PDF }] };

  it('accepts a normal request and normalises addresses', () => {
    const res = parseSendRequest({ ...ok, to: 'A@B.co; c@d.co', cc: ['  e@f.co '], copy_me: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toMatchObject({ to: ['a@b.co', 'c@d.co'], cc: ['e@f.co'], copyMe: true });
  });

  it('removes duplicates and empty entries', () => {
    const res = parseSendRequest({ ...ok, to: ['a@b.co', 'A@B.CO', '', '  '] });
    expect(res.ok && res.value.to).toEqual(['a@b.co']);
  });

  it.each([
    [{ to: [] }, 'recipient'],
    [{ to: ['a@b.co>\r\nBcc: x@y.co'] }, 'valid'],
    [{ to: ['a b@c.co'] }, 'valid'],
    [{ to: Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `p${i}@x.co`) }, 'at most'],
    [{ subject: '' }, 'subject'],
    [{ subject: 'a\r\nBcc: x@y.co' }, 'invalid'],
    [{ message: '   ' }, 'message'],
    [{ attachments: [{ kind: 'invoice', filename: 'a.pdf', content: PDF }, { kind: 'invoice', filename: 'b.pdf', content: PDF }] }, 'twice'],
    [{ attachments: [{ kind: 'invoice', filename: 'a.exe', content: PDF }] }, 'file names'],
    [{ attachments: [{ kind: 'invoice', filename: 'a.pdf', content: 'bm90IGEgcGRm' }] }, 'PDF'],
    [{ attachments: [{ kind: 'invoice', filename: 'a.pdf', content: `JVBERi0${'A'.repeat(4_000_001)}` }] }, 'too large'],
    [{ attachments: [{ kind: 'x', filename: 'a.pdf', content: PDF }, { kind: 'invoice', filename: 'b.pdf', content: PDF }, { kind: 'receipt', filename: 'c.pdf', content: PDF }] }, 'at most two'],
  ])('rejects %j', (over, message) => {
    const res = parseSendRequest({ ...ok, ...over });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.toLowerCase()).toContain(message.toLowerCase());
  });

  it('isMailAddress is strict about what reaches an SMTP command', () => {
    for (const good of ['a@b.co', "o'neil@example.org", 'first.last+tag@sub.example.co.uk']) expect(isMailAddress(good)).toBe(true);
    for (const bad of ['a@b', 'a b@c.co', 'a@b.co>', '<a@b.co>', 'a@b.co\r\n', 'a,b@c.co', '@b.co', 'a@.co', '']) expect(isMailAddress(bad)).toBe(false);
  });
});

describe('mailSetup', () => {
  const settings = {
    smtp_host: 'smtp.example.com',
    smtp_port: '587',
    smtp_security: 'starttls',
    smtp_username: 'me@example.com',
    smtp_password: 'pw',
    smtp_from_name: '',
    smtp_from_email: 'billing@example.com',
    smtp_reply_to: '',
    inv_legal_name: 'Acme Ltd',
    inv_contact_email: 'owner@example.com',
  };

  it('uses the saved settings, with sensible fallbacks for the name and reply-to', () => {
    const res = mailSetup(settings);
    expect(res.ok && res.value).toMatchObject({
      smtp: { host: 'smtp.example.com', port: 587, security: 'starttls', username: 'me@example.com', password: 'pw' },
      from: { name: 'Acme Ltd', email: 'billing@example.com' },
      replyTo: 'owner@example.com',
    });
  });

  it('explains what is missing, and refuses port 25', () => {
    expect(mailSetup({ ...settings, smtp_host: '' })).toMatchObject({ ok: false });
    expect(mailSetup({ ...settings, smtp_from_email: '' })).toMatchObject({ ok: false });
    expect(mailSetup({ ...settings, smtp_port: '25' })).toMatchObject({ ok: false, error: expect.stringContaining('port 25') });
  });

  it('typed (unsaved) values win, a blank password keeps the saved one, and bad values are refused', () => {
    const res = mailSetup(settings, { smtp_host: 'other.example.com', smtp_password: '' });
    expect(res.ok && res.value.smtp).toMatchObject({ host: 'other.example.com', password: 'pw' });
    expect(mailSetup(settings, { smtp_host: 'not a host' })).toMatchObject({ ok: false });
    expect(mailSetup(settings, { smtp_security: 'ssl3' })).toMatchObject({ ok: false });
  });
});
