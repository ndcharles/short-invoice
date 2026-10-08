import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { checkFetchUrl, isBlockedHost, readLimited } from '../../worker/lib/ssrf';
import { decryptSecret, encryptSecret, isEncrypted } from '../../worker/lib/secrets';
import { newSetupCode, normaliseCode, passwordProblem, setupCodeMatches, sha256, listOf, displayName } from '../../worker/lib/auth';
import { buildMessage } from '../../worker/lib/mime';
import { CLOAK_LOCK_SCRIPT, cloakPage } from '../../worker/lib/cloak';
import { scriptHash } from '../../worker/lib/inline-script';
import { isPreviewBot } from '../../worker/lib/ua';
import { sharePage } from '../../worker/lib/share-page';
import { coversEverything, gatedPreview, hasCustomPreview, previewFor } from '../../worker/lib/share-preview';
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

describe('cloaked link page', () => {
  it('asks for the https version of an http destination on an https page (mixed content shows a blank page)', () => {
    const page = cloakPage('charles', 'http://ndcharles.github.io/blog-roll', true);
    expect(page.html).toContain('<iframe src="https://ndcharles.github.io/blog-roll"');
    expect(page.html).not.toContain('src="http://');
    expect(page.csp).toContain('upgrade-insecure-requests');
    expect(page.csp).toContain('frame-src https:;');
    expect(page.csp).toContain("frame-ancestors 'none'");
  });

  it('keeps the path, query and fragment, and leaves https destinations alone', () => {
    expect(cloakPage('a', 'http://example.com/p?x=1&y=2#top', true).html).toContain('src="https://example.com/p?x=1&amp;y=2#top"');
    expect(cloakPage('a', 'https://example.com/p', true).html).toContain('src="https://example.com/p"');
  });

  it('changes nothing over plain http (local development)', () => {
    const page = cloakPage('a', 'http://localhost:9000/x', false);
    expect(page.html).toContain('src="http://localhost:9000/x"');
    expect(page.csp).toContain('frame-src http: https:');
    expect(page.csp).not.toContain('upgrade-insecure-requests');
  });

  it('escapes the alias and the address', () => {
    const page = cloakPage('<script>alert(1)</script>', 'https://example.com/"onload="x', true);
    expect(page.html).not.toContain('<script>');
    expect(page.html).not.toContain('"onload="');
    expect(page.html).toContain('&lt;script&gt;');
  });
});

describe('cloaked link page: what it says about the destination', () => {
  const preview = {
    title: 'Blog Roll | Charles',
    description: 'Posts I keep coming back to',
    image: 'https://cdn.example.com/cover.png',
    site: 'Charles',
    url: 'https://trim.ng/charles',
  };
  const tag = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1] ?? null;

  it('uses the preview for the tab title and every social tag', () => {
    const { html } = cloakPage('charles', 'https://example.com/blog-roll', true, preview);
    expect(html).toContain('<title>Blog Roll | Charles</title>');
    expect(tag(html, 'description')).toBe('Posts I keep coming back to');
    expect(tag(html, 'og:title')).toBe('Blog Roll | Charles');
    expect(tag(html, 'og:description')).toBe('Posts I keep coming back to');
    expect(tag(html, 'og:image')).toBe('https://cdn.example.com/cover.png');
    expect(tag(html, 'og:site_name')).toBe('Charles');
    expect(tag(html, 'og:url')).toBe('https://trim.ng/charles');
    expect(tag(html, 'og:type')).toBe('website');
    expect(tag(html, 'twitter:card')).toBe('summary_large_image');
    expect(tag(html, 'twitter:image')).toBe('https://cdn.example.com/cover.png');
    expect(html).toContain('<iframe src="https://example.com/blog-roll"'); // still just a frame
  });

  it('is a small card with no image tags when there is no usable image', () => {
    for (const image of [null, 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url']) {
      const { html } = cloakPage('a', 'https://example.com/', true, { ...preview, image });
      expect(tag(html, 'og:image'), String(image)).toBeNull();
      expect(tag(html, 'twitter:image'), String(image)).toBeNull();
      expect(tag(html, 'twitter:card'), String(image)).toBe('summary');
    }
  });

  it('leaves out the site name when there is none, and escapes everything it was given', () => {
    expect(tag(cloakPage('a', 'https://example.com/', true, { ...preview, site: null }).html, 'og:site_name')).toBeNull();
    const hostile = cloakPage('a', 'https://example.com/', true, {
      title: '"><script>alert(1)</script>',
      description: '<img src=x onerror=alert(1)> & "quotes"',
      image: 'https://cdn.example.com/a.png?x="onload="alert(1)',
      site: '</title><b>',
      url: 'https://trim.ng/a"><i>',
    });
    expect(hostile.html).not.toMatch(/<script>alert|<img src=x|<b>|<i>|"onload="/);
    expect(hostile.html).toContain('&lt;script&gt;');
    expect(hostile.html).toContain('&amp; &quot;quotes&quot;');
  });

  it('is unchanged without a preview: the tab shows the alias and there are no social tags', () => {
    const { html } = cloakPage('charles', 'https://example.com/', true);
    expect(html).toContain('<title>charles</title>');
    expect(html).not.toContain('og:');
    expect(html).not.toContain('twitter:');
  });

  it('falls back to the alias when the title is blank', () => {
    expect(cloakPage('charles', 'https://example.com/', true, { ...preview, title: '   ' }).html).toContain('<title>charles</title>');
  });
});

describe('which visitors are link-preview crawlers', () => {
  it.each([
    ['Facebook', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['Facebook (Instagram)', 'Facebot'],
    ['Meta', 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
    ['X', 'Twitterbot/1.0'],
    ['LinkedIn', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'],
    ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['Slack (older)', 'Slackbot 1.0 (+https://api.slack.com/robots)'],
    ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['Telegram', 'TelegramBot (like TwitterBot)'],
    ['WhatsApp', 'WhatsApp/2.23.20.0 A'],
    ['WhatsApp (iPhone)', 'WhatsApp/2.2326.3 i'],
    ['Pinterest', 'Pinterest/0.2 (+http://www.pinterest.com/bot.html)'],
    ['Skype', 'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com'],
    ['Reddit', 'redditbot/1.0 (+http://www.reddit.com/feedback)'],
    ['Mastodon', 'http.rb/5.1.1 (Mastodon/4.2.1; +https://mastodon.social/)'],
    ['Bluesky', 'Bluesky Cardyb/1.1'],
    ['Embedly', 'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)'],
    ['iMessage (presents itself as Facebook and X)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.2 Safari/605.1.15 facebookexternalhit/1.1 Facebot Twitterbot/1.0'],
  ])('%s is a crawler', (_name, ua) => expect(isPreviewBot(ua)).toBe(true));

  it.each([
    ['Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'],
    ['Safari on iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1'],
    ['Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'],
    ['Instagram\'s own browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20A362 Instagram 250.0.0.17.109 (iPhone14,5; iOS 16_0; en_US; en; scale=3.00)'],
    ['Facebook\'s own browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21C62 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/565;FBDV/iPhone14,5]'],
    ['the LinkedIn app\'s own browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp'],
    ['the Twitter app\'s own browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.20'],
    ['Slack desktop', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.36.140 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36'],
    ['Pinterest\'s own browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 [Pinterest for iOS/12.3]'],
    ['curl', 'curl/8.4.0'],
    ['Googlebot (follows the redirect, as search should)', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['empty', ''],
  ])('%s is a person (or not one of these crawlers)', (_name, ua) => expect(isPreviewBot(ua)).toBe(false));
});

describe('whether a link has a custom preview, and what shared cards say', () => {
  const link = { dest: 'https://example.com/private/page?x=1', custom_preview: 1, og_title: null, og_description: null, og_image: null } as const;
  const url = 'https://trim.ng/abc';

  it('has one when it is switched on and at least one part is filled in', () => {
    expect(hasCustomPreview({ ...link, og_title: 'Mine' })).toBe(true);
    expect(hasCustomPreview({ ...link, og_image: 'https://e.com/i.png' })).toBe(true);
    expect(hasCustomPreview({ ...link })).toBe(false); // on, but nothing written
    expect(hasCustomPreview({ ...link, og_title: '   ', og_description: '' })).toBe(false);
    expect(hasCustomPreview({ ...link, custom_preview: 0, og_title: 'Mine' })).toBe(false); // written, but switched off
  });

  it('covers everything only when all three parts are written', () => {
    expect(coversEverything({ ...link, og_title: 'T', og_description: 'D', og_image: 'https://e.com/i.png' })).toBe(true);
    expect(coversEverything({ ...link, og_title: 'T', og_description: 'D' })).toBe(false);
    expect(coversEverything({ ...link, custom_preview: 0, og_title: 'T', og_description: 'D', og_image: 'https://e.com/i.png' })).toBe(false);
  });

  it('writes each part from the owner when given, and from the destination for the rest', () => {
    const remote = { title: 'Their title', description: 'Their words', image: 'https://their.example/i.png', siteName: 'Their Site' };
    expect(previewFor({ ...link, og_title: 'Mine' }, 'abc', remote, url)).toEqual({
      title: 'Mine', description: 'Their words', image: 'https://their.example/i.png', site: 'Their Site', url,
    });
    expect(previewFor({ ...link, og_description: 'My words', og_image: 'https://mine.example/i.png' }, 'abc', remote, url)).toMatchObject({
      title: 'Their title', description: 'My words', image: 'https://mine.example/i.png',
    });
  });

  it('for a password-protected link says nothing at all about the destination', () => {
    const plain = gatedPreview({ ...link, og_title: 'Mine' }, url);
    expect(plain).toEqual({ title: 'Mine', description: 'Enter the password to open this link.', image: null, site: null, url });
    const bare = gatedPreview({ ...link, og_image: 'https://mine.example/i.png' }, url);
    expect(bare).toMatchObject({ title: 'Password protected link', image: 'https://mine.example/i.png' });
    expect(JSON.stringify([plain, bare])).not.toMatch(/example\.com\/private|private\/page/);
  });
});

describe('the page a crawler gets', () => {
  const preview = { title: 'My own title', description: 'My own words', image: 'https://mine.example/card.png', site: 'Site', url: 'https://trim.ng/abc' };
  const tag = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1] ?? null;

  it('carries the tags and a plain link, and does not redirect by itself', () => {
    const html = sharePage('abc', 'https://example.com/dest', preview);
    expect(html).toContain('<title>My own title</title>');
    expect([tag(html, 'og:title'), tag(html, 'og:description'), tag(html, 'og:image'), tag(html, 'og:url'), tag(html, 'twitter:card')]).toEqual([
      'My own title', 'My own words', 'https://mine.example/card.png', 'https://trim.ng/abc', 'summary_large_image',
    ]);
    expect(html).toContain('<a href="https://example.com/dest">');
    expect(html).not.toMatch(/http-equiv|<script|location\./i); // a crawler that followed this would draw the destination's card instead
  });

  it('for a password-protected link has no link to the destination', () => {
    const html = sharePage('abc', null, preview);
    expect(html).not.toContain('<a ');
    expect(html).toContain('password protected');
  });

  it('escapes whatever the owner wrote', () => {
    const html = sharePage('abc', 'https://example.com/"><script>x</script>', { ...preview, title: '"><script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' });
    expect(html).not.toMatch(/<script>|<img src=x/);
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('a cloaked page that locks itself when its link expires', () => {
  const lock = { expiresInMs: 90_000, scriptHash: 'HASHVALUE=' };

  it('carries how long is left, the script, and a policy that allows exactly that script', async () => {
    const hash = await scriptHash(CLOAK_LOCK_SCRIPT);
    for (const secure of [true, false]) {
      const { html, csp } = cloakPage('a', 'https://example.com/', secure, undefined, { expiresInMs: 90_000.4, scriptHash: hash });
      expect(html).toContain('<body data-expires-in="90000">');
      expect(html).toContain(`<script>${CLOAK_LOCK_SCRIPT}</script>`);
      expect(csp).toContain(`script-src 'sha256-${hash}';`);
      expect(csp).toContain("default-src 'none'"); // nothing else may run or load
      expect(csp).toContain("frame-ancestors 'none'");
    }
  });

  it('the policy hash really is the hash of the script (a mismatch would silently stop the lock)', async () => {
    const { createHash } = await import('node:crypto');
    expect(await scriptHash(CLOAK_LOCK_SCRIPT)).toBe(createHash('sha256').update(CLOAK_LOCK_SCRIPT).digest('base64'));
  });

  it('has no script and no script permission for a link that never expires', () => {
    const { html, csp } = cloakPage('a', 'https://example.com/', true);
    expect(html).toContain('<body>');
    expect(html).not.toMatch(/<script|data-expires-in/);
    expect(csp).not.toContain('script-src');
  });

  it('rounds up so a very short wait is still a wait', () => {
    expect(cloakPage('a', 'https://example.com/', true, undefined, { ...lock, expiresInMs: 0.2 }).html).toContain('data-expires-in="1"');
  });
});

/** Runs the real lock script against a fake page and a fake clock. */
function lockHarness(expiresIn: string | null) {
  let now = 1_000_000;
  let nextId = 1;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  const handlers: Record<string, (() => void)[]> = {};
  const replaced: string[] = [];
  const doc = {
    hidden: false,
    body: { getAttribute: () => expiresIn },
    addEventListener: (type: string, fn: () => void) => void (handlers[`document:${type}`] ??= []).push(fn),
  };
  const sandbox = {
    document: doc,
    window: { addEventListener: (type: string, fn: () => void) => void (handlers[`window:${type}`] ??= []).push(fn) },
    location: { href: 'https://trim.ng/charles', replace: (url: string) => void replaced.push(url) },
    Date: { now: () => now },
    Number,
    Math,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      const at = timers.findIndex((t) => t.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  };
  vm.runInNewContext(CLOAK_LOCK_SCRIPT, sandbox);
  return {
    doc,
    replaced,
    timers,
    handlers,
    /** Time passes normally: timers fire when due. */
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
      now = target;
    },
    /** The device slept: the clock moved on and no timer fired. */
    sleep(ms: number) {
      now += ms;
    },
    fire(type: string) {
      for (const fn of handlers[type] ?? []) fn();
    },
  };
}

describe('the lock script itself', () => {
  it('reloads once the time is up, a moment after and never before', () => {
    const page = lockHarness('5000');
    page.advance(4_999);
    expect(page.replaced).toEqual([]);
    page.advance(100);
    expect(page.replaced).toEqual(['https://trim.ng/charles']); // the same address, as a plain GET
  });

  it('takes a long wait an hour at a time, and still locks at the right moment', () => {
    const page = lockHarness(String(2 * 3_600_000 + 30_000));
    expect(Math.max(...page.timers.map((t) => t.at - 1_000_000))).toBeLessThanOrEqual(3_600_000);
    page.advance(3_600_000);
    page.advance(3_600_000);
    expect(page.replaced).toEqual([]); // 30 seconds still to go
    page.advance(30_100);
    expect(page.replaced).toHaveLength(1);
  });

  it('locks straight away when a sleeping device wakes up after the time (the tab comes back to the front)', () => {
    const page = lockHarness('60000');
    page.sleep(10 * 60_000); // closed laptop: no timer fired
    expect(page.replaced).toEqual([]);
    page.fire('document:visibilitychange');
    expect(page.replaced).toHaveLength(1);
  });

  it('and when the page is restored from the back/forward cache after the time', () => {
    const page = lockHarness('60000');
    page.sleep(61_000);
    page.fire('window:pageshow');
    expect(page.replaced).toHaveLength(1);
  });

  it('does nothing while the tab is hidden or the time has not come', () => {
    const page = lockHarness('60000');
    page.doc.hidden = true;
    page.sleep(120_000);
    page.fire('document:visibilitychange');
    expect(page.replaced).toEqual([]);
    page.doc.hidden = false;
    const early = lockHarness('60000');
    early.sleep(10_000);
    early.fire('document:visibilitychange');
    expect(early.replaced).toEqual([]);
    expect(early.timers).toHaveLength(1); // and it keeps counting down
  });

  it.each([[null], ['0'], ['-5'], ['abc'], ['']])('does nothing at all without a usable time (%j)', (value) => {
    const page = lockHarness(value);
    expect(page.timers).toHaveLength(0);
    expect(Object.keys(page.handlers)).toHaveLength(0);
    page.advance(10 * 3_600_000);
    expect(page.replaced).toEqual([]);
  });
});
