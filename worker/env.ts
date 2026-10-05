export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** HMAC key for password-link unlock cookies (`wrangler secret put LINK_COOKIE_SECRET`). Optional. */
  LINK_COOKIE_SECRET?: string;
}

export type AppEnv = { Bindings: Env };
