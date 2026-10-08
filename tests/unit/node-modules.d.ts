/** The few parts of Node's built-in SQLite the tests use (the repo's Node typings predate the module). */
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): { changes: number | bigint };
      get(...params: unknown[]): unknown;
    };
  }
}

/** Likewise for the two other Node modules the Worker-library tests use. */
declare module 'node:vm' {
  const vm: { runInNewContext(code: string, sandbox: object): unknown };
  export default vm;
}

declare module 'node:crypto' {
  export function createHash(algorithm: string): { update(data: string): { digest(encoding: 'base64' | 'hex'): string } };
}
