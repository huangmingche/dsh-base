/** Worker plugin: static asset fallback for the built client, with a real 404 for missing assets. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dsh-base/cloudflare-worker-public-pages";
import { isPrivateDocument, isPublicDocument, resolvePublicResource } from "../../../boot/dsh-base-public-pages/src/index.ts";
import { splitLocalePath } from "../../../boot/dsh-base-locale-path/src/index.ts";

interface AssetEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export const name = "@dsh-base/cloudflare-worker-assets";
export const inject = ["http"];
export const Config = undefined;

/**
 * Extensions that always mean a static file, never an SPA document. A request
 * that reaches ASSETS under one of them must end as a file response or a 404 —
 * the platform's single-page fallback would otherwise return the HTML shell
 * with `content-type: text/html`, which is how `/favicon.ico` became a page.
 */
const ASSET_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

/** Explicit asset paths whose extension alone is not the whole story. */
const EXPLICIT_ASSETS: ReadonlyMap<string, string> = new Map([
  ["/og.png", "image/png"],
]);

/** Expected content type of a static asset path, or undefined for a document/navigation. */
function expectedType(pathname: string): string | undefined {
  const explicit = EXPLICIT_ASSETS.get(pathname);
  if (explicit !== undefined) return explicit;
  const dot = pathname.lastIndexOf(".");
  // A dot inside a directory segment (`/v1.2/page`) is not an asset extension.
  if (dot <= pathname.lastIndexOf("/")) return undefined;
  return ASSET_EXTENSIONS.get(pathname.slice(dot).toLowerCase());
}

/** A real missing-asset response; never the SPA shell. */
function notFound(request: Request): Response {
  return new Response(request.method === "HEAD" ? null : "", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.http.use(async (request, env) => {
      const url = new URL(request.url);
      const pathname = url.pathname;
      if (pathname.startsWith("/api/") || pathname === "/plugins/events") return undefined;
      const type = expectedType(pathname);
      if ((request.method === "GET" || request.method === "HEAD") && type === undefined
        && !pathname.startsWith("/assets/") && !resolvePublicResource(pathname)) {
        const address = splitLocalePath(pathname);
        if (address.path !== "/login" && !isPrivateDocument(address.path)) {
          try {
            const registry = ctx.get?.("publicPages");
            const known = registry ? !!await registry.resolve(env, address.path, address.locale) : isPublicDocument(address.path);
            if (!known) return notFound(request);
          } catch { return new Response(null, {status: 503, headers: {"cache-control": "no-store"}}); }
        }
      }
      const response = await (env as AssetEnv).ASSETS.fetch(request);
      // SPA fallback guard: when the platform answers an asset URL with 404 or
      // an HTML document, return a real 404 instead. Document navigation is
      // decided before this plugin (SEO/auth order). The entire assets namespace
      // is static, including unknown extensions and extensionless resource names.
      if (type !== undefined || pathname.startsWith("/assets/")) {
        const contentType = response.headers.get("content-type") ?? "";
        if (response.status === 404 || contentType.includes("text/html")) return notFound(request);
      }
      const headers = new Headers(response.headers);
      // Vite serves imported image/font URLs as JavaScript modules in local
      // development. Preserve that real response type instead of relabeling
      // `export default ...` as an image and breaking the official UI import.
      const importedModule = url.searchParams.has("import")
        && /^(?:application|text)\/javascript(?:;|$)/iu.test(headers.get("content-type") ?? "");
      if (type !== undefined && !importedModule) headers.set("content-type", type);
      if (pathname === "/" || pathname.endsWith(".html") || pathname.endsWith(".webmanifest")) {
        // Only the SPA shell can outlive its hashed asset bundle.
        headers.set("cache-control", "no-store, no-cache, must-revalidate");
      } else if (pathname.startsWith("/assets/") && response.ok) {
        // Vite content-hashed assets are immutable.
        headers.set("cache-control", "public, max-age=31536000, immutable");
      } else if (!response.ok) {
        headers.set("cache-control", "no-store");
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }, 1000),
    "dsh-base: static assets",
  );
}
