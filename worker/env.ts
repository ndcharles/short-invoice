import type { AuthMode, CurrentUser } from './lib/auth';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** HMAC key for password-link unlock cookies (`wrangler secret put LINK_COOKIE_SECRET`). Optional. */
  LINK_COOKIE_SECRET?: string;
  /** Test-only: origin Settings → Verify fetches instead of https://<domain>. Never set in production. */
  DOMAIN_CHECK_ORIGIN?: string;
  /**
   * Cloudflare Access: team domain (e.g. "yourteam.cloudflareaccess.com") and
   * the application's AUD tag. When both are set, every API call must carry a
   * valid Access token; without them the deployed app is unprotected.
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Comma-separated admin emails (`wrangler secret put ADMIN_EMAILS`). Everyone else is a member. */
  ADMIN_EMAILS?: string;
  /** Local dev only: who you are when no `x-dev-user` header is sent. */
  DEV_USER_EMAIL?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: CurrentUser; authMode: AuthMode } };
