/** Static asset surface: a missing asset is a 404, never the SPA shell. */
import assert from "node:assert/strict";
import { apply } from "../src/index.ts";

const handlers: Array<(request: Request, env: unknown) => Promise<Response | undefined>> = [];
const ctx = {
  effect(callback: () => unknown) { return callback(); },
  http: { use(handler: (request: Request, env: unknown) => Promise<Response | undefined>) { handlers.push(handler); return () => {}; } },
};
apply(ctx as never);
assert.equal(handlers.length, 1);
const handler = handlers[0]!;
const shell = "<!doctype html><html><body><div id=\"root\"></div></body></html>";
const htmlResponse = () => new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" } });
const assetEnv = {
  ASSETS: {
    async fetch(request: Request) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (url.searchParams.has("import") && ["/source.svg", "/source.webp", "/source.woff2"].includes(path)) {
        return new Response('export default "data:asset"', { headers: { "content-type": "text/javascript; charset=utf-8" } });
      }
      if (path === "/favicon.svg") return new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
      if (path === "/icon-192.png") return new Response("png", { headers: { "content-type": "application/octet-stream" } });
      if (path === "/assets/index-abc.js") return new Response("js", { headers: { "content-type": "text/javascript" } });
      if (path === "/nope.png" || path === "/favicon-404.ico") return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      return htmlResponse();
    },
  },
};
const get = (path: string) => handler(new Request(`https://app.example.test${path}`, { headers: { accept: "*/*" } }), assetEnv);

// A present asset keeps its bytes and gets the extension's content type.
{
  const response = await get("/favicon.svg");
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("content-type"), "image/svg+xml");
  assert.equal(await response?.text(), "<svg/>");
}
{
  const response = await get("/icon-192.png");
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("content-type"), "image/png", "generic ASSETS type is corrected by extension");
}
// The SPA fallback for an asset URL is a real 404 with no HTML body.
for (const path of ["/favicon-16x16.png", "/apple-touch-icon.png", "/og.png", "/nope.webmanifest", "/missing.txt", "/assets/missing.js", "/assets/missing.css", "/assets/missing", "/assets/missing.wasm"]) {
  const response = await get(path);
  assert.equal(response?.status, 404, `${path}: 404`);
  assert.equal(response?.headers.get("cache-control"), "no-store", `${path}: never cache a missing asset`);
  assert.ok(!(response?.headers.get("content-type") ?? "").includes("text/html"), `${path}: never HTML`);
  assert.equal(await response?.text(), "", `${path}: empty body`);
}
// ASSETS already answering 404 stays a 404.
for (const path of ["/nope.png", "/favicon-404.ico"]) {
  const response = await get(path);
  assert.equal(response?.status, 404, `${path}: 404`);
}
// Document navigation and dotted non-asset paths keep their previous behavior.
for (const path of ["/", "/app/session/a.b"]) {
  const response = await get(path);
  assert.equal(response?.status, 200, `${path}: passthrough`);
  assert.match(response?.headers.get("content-type") ?? "", /text\/html/u, `${path}: document shell`);
}
// Hashed assets stay immutable; the shell stays uncached.
{
  const script = await get("/assets/index-abc.js");
  assert.equal(script?.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const document = await get("/");
  assert.equal(document?.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
}
// API and plugin-event surfaces are not touched by the asset plugin.
assert.equal(await get("/api/anything"), undefined);
assert.equal(await get("/plugins/events"), undefined);

console.log("worker assets: missing assets 404 (no SPA shell), content types corrected, documents and API untouched");

// Local dev image/font import modules preserve JavaScript MIME and bytes.
for (const path of ["/source.svg?import", "/source.webp?import", "/source.woff2?import"]) {
  const response = await get(path);
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(await response?.text(), 'export default "data:asset"');
}
assert.equal((await get("/missing.svg?import"))?.status, 404, "import query does not bypass missing-asset guards");
assert.equal((await get("/favicon.svg?import"))?.headers.get("content-type"), "image/svg+xml", "an ordinary static image remains an image");

for (const path of ["/some.page/route", "/not-found", "/pricing", "/zh-CN/missing"]) assert.equal((await get(path))?.status, 404, `${path}: nonexistent document is not an app shell`);
