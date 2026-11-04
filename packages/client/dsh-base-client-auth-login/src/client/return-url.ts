/** Keep post-login navigation on the current application origin. */
export function loginReturnPath(next: string | null, origin: string): string {
  if (next === null) return "/";
  try {
    const target = new URL(next, origin);
    if (target.origin !== new URL(origin).origin || !target.pathname.startsWith("/") || target.pathname.startsWith("//")) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return "/"; }
}

/** The Worker sends /login?next=<path and query>. The browser inherits the original fragment on that redirect. */
export function loginDocumentReturnPath(current: URL): string {
  const next = current.searchParams.get("next");
  // Only the plain Worker redirect inherits its fragment. Account callbacks carry their own parameters.
  if (current.pathname === "/login" && current.searchParams.size === 1 && next?.startsWith("/") && !next.includes("#")) {
    return loginReturnPath(next + current.hash, current.origin);
  }
  return loginReturnPath(next, current.origin);
}
