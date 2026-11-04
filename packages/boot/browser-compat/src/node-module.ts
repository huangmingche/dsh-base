/** Browser shim for Node module helpers pulled in by DSH client module plumbing. */
export function createRequire(): (id: string) => never {
  return (id: string) => {
    throw new Error(`node:module createRequire("${id}") is unavailable in the browser`);
  };
}

export function isBuiltin(): boolean {
  return false;
}

export function registerHooks(): void {
  throw new Error("node:module registerHooks is unavailable in the browser");
}

export default { createRequire, isBuiltin, registerHooks };
