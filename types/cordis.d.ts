/** Minimal type surface of the pinned official @deepseek-ai/cordis used by this skeleton. */
declare module "@deepseek-ai/cordis" {
  export class Context {
    provide(name: string, value: unknown): void;
    plugin(plugin: unknown, config?: unknown): void;
  }
  export interface Context {
    [name: string]: unknown;
  }
}
