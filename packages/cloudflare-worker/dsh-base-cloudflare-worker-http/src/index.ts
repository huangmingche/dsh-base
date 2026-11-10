/** Worker HTTP plugin: owns the ordered request-handler composition. */
import type { Context } from "@deepseek-ai/cordis";
import { rejectCrossOriginRequest } from "./request-origin.ts";
import { HttpError, failure } from "./request.ts";

/** One worker capability handler; undefined continues to the next plugin. */
export type WorkerHandler = (request: Request, env: unknown) => Response | undefined | Promise<Response | undefined>;
export type WorkerResponseHandler = (request: Request, env: unknown, response: Response) => Response | Promise<Response>;

/** Request dispatch face consumed by the Worker entry. */
export interface WorkerHttp {
  /** Lower priorities run first; equal priorities retain registration order. */
  use(handler: WorkerHandler, priority?: number): () => void;
  useResponse(handler: WorkerResponseHandler): () => void;
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
  // Request precedence must not depend on asynchronous plugin activation.
  const handlers: Array<{ handler: WorkerHandler; priority: number }> = [];
  const responseHandlers: WorkerResponseHandler[] = [];
  ctx.provide("http", {
    useResponse(handler) {
      responseHandlers.push(handler);
      return () => { const at = responseHandlers.indexOf(handler); if (at >= 0) responseHandlers.splice(at, 1); };
    },
    use(handler, priority = 100) {
      if (!Number.isFinite(priority)) throw new TypeError("HTTP handler priority must be finite");
      const registration = { handler, priority };
      const index = handlers.findIndex(entry => entry.priority > priority);
      handlers.splice(index === -1 ? handlers.length : index, 0, registration);
      return () => {
        const index = handlers.indexOf(registration);
        if (index !== -1) handlers.splice(index, 1);
      };
    },
    async dispatch(request, env) {
      const finish = async (response: Response): Promise<Response> => {
        for (const handler of [...responseHandlers]) response = await handler(request, env, response);
        return response;
      };
      const rejected = rejectCrossOriginRequest(request);
      if (rejected !== undefined) return finish(rejected);
      for (const { handler } of [...handlers]) {
        let response: Response | undefined;
        try { response = await handler(request, env); }
        catch (error) {
          // Preserve typed service failures across plugin boundaries. A failed
          // authentication read must never fall through or look like a logout.
          if (!(error instanceof HttpError)) throw error;
          return finish(failure(error));
        }
        if (response !== undefined) return finish(response);
      }
      return finish(new Response("Not found", { status: 404 }));
    },
  } satisfies WorkerHttp);
}
