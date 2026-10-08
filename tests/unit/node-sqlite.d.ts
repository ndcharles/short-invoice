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
