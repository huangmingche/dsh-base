import { loginReturnPath } from "./return-url.ts";

/** Callback URLs are constructed locally; an untrusted next URL never becomes their origin. */
export function emailCallbackURL(current: URL, locale: string, kind: "reset" | "verification"): string {
  const callback = new URL("/login", current.origin);
  callback.searchParams.set("locale", locale);
  if (kind === "reset") callback.searchParams.set("mode", "reset-password");
  else callback.searchParams.set("verified", "1");
  const next = loginReturnPath(current.searchParams.get("next"), current.origin);
  if (next !== "/") callback.searchParams.set("next", next);
  return callback.href;
}

/** Capture once in component memory, then remove the credential from browser history. */
export function resetTokenFromURL(url: URL): string | undefined {
  const token = url.searchParams.get("token");
  return url.searchParams.get("error")?.toLowerCase() === "invalid_token" || !token || token.length > 4096 || /[\u0000-\u0020\u007f]/u.test(token) ? undefined : token;
}
export function withoutEmailToken(url: URL, finish = false): string {
  const safe = new URL(url);
  safe.searchParams.delete("token");
  safe.searchParams.delete("error");
  if (finish && safe.searchParams.get("mode") === "reset-password") safe.searchParams.delete("mode");
  return `${safe.pathname}${safe.search}${safe.hash}`;
}
