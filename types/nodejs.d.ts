/** Minimal node:sqlite surface for the test-only adapter (Node 26 ships it). */
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location?: string);
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): unknown;
    };
    exec(sql: string): void;
    close(): void;
  }
}
