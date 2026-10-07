import type { AuthMode, CurrentUser } from './lib/auth';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** HMAC key for password-link unlock cookies (`wrangler secret put LINK_COOKIE_SECRET`). Optional. */
  LINK_COOKIE_SECRET?: string;
  /** Test-only: origin Settings → Verify fetches instead of https://<domain>. Never set in production. */
  DOMAIN_CHECK_ORIGIN?: string;
  /** Comma-separated admin emails (`wrangler secret put ADMIN_EMAILS`). Everyone else is a member. */
  ADMIN_EMAILS?: string;
  /** Secret mixed into every account password hash (`wrangler secret put AUTH_PEPPER`). */
  AUTH_PEPPER?: string;
  /** Tests only: "1" lets localhost requests with `x-dev-user` skip sign-in. Never set in production. */
  DEV_AUTH_BYPASS?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: CurrentUser; authMode: AuthMode } };
