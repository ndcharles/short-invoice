-- Built-in sign-in (replaces Cloudflare Access). An admin adds someone in
-- Settings → Team, which creates a one-time setup code the admin copies and
-- hands over; on first sign-in the person enters it with a name and password.
-- Codes and passwords are stored only as hashes.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN setup_code_hash TEXT;
ALTER TABLE users ADD COLUMN setup_expires_at INTEGER;
ALTER TABLE users ADD COLUMN setup_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until INTEGER;

-- One row per signed-in device. The cookie holds a random token; only its
-- SHA-256 is stored, so a copy of the database cannot be used to sign in.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;

-- Backs "sign out everywhere" and removing a person.
CREATE INDEX idx_sessions_email ON sessions (email);

-- Fixed-window counters for sign-in rate limits (keyed by hashed IP or email).
CREATE TABLE auth_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
) WITHOUT ROWID;

-- Sign-in by email domain is gone: everyone is added by an admin.
DELETE FROM settings WHERE key = 'team_domains';
UPDATE users SET source = 'invite' WHERE source = 'domain';
