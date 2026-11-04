/** Worker runtime: boot the Cordis plugin tree once, dispatch every request. */
import { Context } from "@deepseek-ai/cordis";
import { bootStaticPlugins, type StaticPluginInspection } from "@dsh-base/plugin-loader-static";
import type { WorkerHttp } from "@dsh-base/cloudflare-worker-http";
import { workerComposition } from "./generated-composition";

interface WorkerRuntime {
  ctx: Context;
  http: WorkerHttp;
  plugins: StaticPluginInspection[];
}

const ready: Promise<WorkerRuntime> = (async () => {
  const ctx = new Context();
  const loader = await bootStaticPlugins(ctx, workerComposition);
  const http = ctx.get("http") as WorkerHttp | undefined;
  if (!http) throw new Error("dsh-base: worker http service did not activate");
  return { ctx, http, plugins: loader.entries() };
})();

/** Dispatch one request through the active Worker plugin composition. */
export async function handleWorkerRequest(request: Request, env: unknown): Promise<Response> {
  const { http } = await ready;
  return http.dispatch(request, env);
}

/** Worker plugin inventory for inspection endpoints/tools. */
export async function workerPluginInventory(): Promise<StaticPluginInspection[]> {
  return (await ready).plugins;
}
