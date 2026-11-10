interface BrowserProcess {
  env?: Record<string, unknown>;
  pid?: number;
  execArgv?: string[];
  versions?: Record<string, string>;
}

/** Supply the inert Host fields the official Loader probes. Vite may already
 * have installed an env-only process object before the browser boot seam runs. */
export function ensureBrowserProcess(scope: { process?: BrowserProcess }): void {
  const current = scope.process;
  scope.process = {
    ...current,
    env: current?.env ?? {},
    pid: current?.pid ?? 0,
    execArgv: current?.execArgv ?? [],
    versions: { ...current?.versions, node: current?.versions?.node ?? "0.0.0" },
  };
}
