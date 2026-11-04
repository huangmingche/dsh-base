/** Minimal browser shim for the Node path functions used by DSH client bundles. */
export const sep = "/";

/** POSIX and drive-letter absolute check. */
export function isAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

/** Join browser URL-like path segments. */
export function join(...parts: string[]): string {
  return parts.filter((part) => part !== "").join("/").replace(/\/+/g, "/");
}

/** Browser-side path normalisation (no filesystem). */
export function normalize(value: string): string {
  const absolute = isAbsolute(value);
  const segments: string[] = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") { segments.pop(); continue; }
    segments.push(segment);
  }
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}

/** Resolve path segments against a browser base. */
export function resolve(...parts: string[]): string {
  let result = "";
  for (const part of parts) {
    result = isAbsolute(part) ? part : `${result}/${part}`;
  }
  return normalize(result || "/");
}

export function dirname(value: string): string {
  const normalized = normalize(value);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

export function basename(value: string): string {
  return normalize(value).split("/").at(-1) ?? "";
}

export function extname(value: string): string {
  const base = basename(value);
  const index = base.lastIndexOf(".");
  return index <= 0 ? "" : base.slice(index);
}

export default { sep, isAbsolute, join, normalize, resolve, dirname, basename, extname };
