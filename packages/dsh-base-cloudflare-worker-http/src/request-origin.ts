/** Cookie-authenticated mutations and WebSocket upgrades are same-origin only. */
export function rejectCrossOriginRequest(request: Request): Response | undefined {
  const isUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (!isUpgrade && !isMutation) return undefined;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  // Non-browser clients may omit Origin. Browser callers must not reuse a
  // session cookie from a foreign site, including text/plain JSON POSTs.
  if ((origin !== null && origin !== new URL(request.url).origin)
    || (origin === null && fetchSite === "cross-site")) {
    return Response.json({ error: "untrusted_origin" }, {
      status: 403, headers: { "cache-control": "no-store" },
    });
  }
  return undefined;
}
