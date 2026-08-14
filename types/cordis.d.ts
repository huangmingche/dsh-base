/** Minimal type surface of the pinned official @deepseek-ai/cordis used by this tree. */
declare module "@deepseek-ai/cordis" {
  export class Context {
    provide(name: string, value: unknown): void;
    plugin(plugin: unknown, config?: unknown): Promise<unknown> | void;
    get(name: string): unknown;
  }
  export class Service {
    constructor(ctx: Context, name?: string);
    protected readonly ctx: Context;
    readonly name: string;
  }
  export interface Context {
    [name: string]: unknown;
  }
}
