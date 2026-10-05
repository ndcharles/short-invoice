export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export type AppEnv = { Bindings: Env };
