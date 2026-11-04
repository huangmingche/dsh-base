/** Worker plugin: static asset fallback for the built client. */
import type { Context } from "@deepseek-ai/cordis";

interface AssetEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export const name = "@dsh-base/cloudflare-worker-assets";
export const inject = ["http"];
export const Config = undefined;

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.http.use(async (request, env) => {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/api/") || pathname === "/plugins/events") return undefined;
      const response = await (env as AssetEnv).ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      if (pathname === "/" || pathname.endsWith(".html") || pathname.endsWith(".webmanifest")) {
        // Only the SPA shell can outlive its hashed asset bundle.
        headers.set("cache-control", "no-store, no-cache, must-revalidate");
      } else if (pathname.startsWith("/assets/")) {
        // Vite content-hashed assets are immutable.
        headers.set("cache-control", "public, max-age=31536000, immutable");
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }),
    "dsh-base: static assets",
  );
}
