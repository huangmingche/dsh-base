/** Worker HTTP plugin: owns the ordered request-handler composition. */
import type { Context } from "@deepseek-ai/cordis";
import { rejectCrossOriginRequest } from "./request-origin.ts";

/** One worker capability handler; undefined continues to the next plugin. */
export type WorkerHandler = (request: Request, env: unknown) => Response | undefined | Promise<Response | undefined>;

/** Request dispatch face consumed by the Worker entry. */
export interface WorkerHttp {
  use(handler: WorkerHandler): () => void;
  dispatch(request: Request, env: unknown): Promise<Response>;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    http: WorkerHttp;
  }
}

export const name = "@dsh-base/cloudflare-worker-http";
export const Config = undefined;

export function apply(ctx: Context): void {
  const handlers: WorkerHandler[] = [];
  ctx.provide("http", {
    use(handler) {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index !== -1) handlers.splice(index, 1);
      };
    },
    async dispatch(request, env) {
      const rejected = rejectCrossOriginRequest(request);
      if (rejected !== undefined) return rejected;
      for (const handler of [...handlers]) {
        const response = await handler(request, env);
        if (response !== undefined) return response;
      }
      return new Response("Not found", { status: 404 });
    },
  } satisfies WorkerHttp);
}
