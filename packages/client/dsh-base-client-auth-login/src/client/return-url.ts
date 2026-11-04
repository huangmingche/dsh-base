/** Keep post-login navigation on the current application origin. */
export function loginReturnPath(next: string | null, origin: string): string {
  if (next === null) return "/";
  try {
    const target = new URL(next, origin);
    if (target.origin !== new URL(origin).origin) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return "/"; }
}
