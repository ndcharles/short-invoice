#!/usr/bin/env node
/**
 * Creates a one-time setup code for an admin, straight in D1, for the very
 * first sign-in (before anyone can hand out codes from Settings → Team).
 * Needs your Cloudflare login, so only the account owner can run it.
 *
 *   npm run setup-code -- you@example.com            # production
 *   npm run setup-code -- you@example.com --local    # local dev database
 *
 * The email must also be in the ADMIN_EMAILS secret to get admin rights.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';

const args = process.argv.slice(2);
const email = (args.find((a) => !a.startsWith('--')) ?? '').trim().toLowerCase();
const target = args.includes('--local') ? '--local' : '--remote';
if (!/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email)) {
  console.error('Usage: npm run setup-code -- you@example.com [--local]');
  process.exit(1);
}

// Same format and hashing as worker/lib/auth.ts (newSetupCode / normaliseCode / sha256).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const chars = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const code = `${chars.slice(0, 5)}-${chars.slice(5)}`;
const hash = createHash('sha256').update(chars).digest('base64url');
const now = Date.now();
const expires = now + 7 * 86_400_000;

const sql = `INSERT INTO users (email, name, role, status, source, created_at, setup_code_hash, setup_expires_at)
VALUES ('${email}', '', 'admin', 'invited', 'admin', ${now}, '${hash}', ${expires})
ON CONFLICT(email) DO UPDATE SET role = 'admin', source = 'admin', status = 'invited', password_hash = NULL,
  setup_code_hash = '${hash}', setup_expires_at = ${expires}, setup_attempts = 0, failed_logins = 0, locked_until = NULL;
DELETE FROM sessions WHERE email = '${email}';`;

execFileSync('npx', ['wrangler', 'd1', 'execute', 'short-invoice', target, '--command', sql], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`\nSetup code for ${email} (valid 7 days, one use):\n\n    ${code}\n\nOpen the app, enter the email, then this code, your name and a password.`);
