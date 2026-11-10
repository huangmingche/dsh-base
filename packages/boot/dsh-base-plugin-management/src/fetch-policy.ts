/** Fetch configuration policy shared by the control plane and Think adapter. */
const DEFAULT_ALLOWLIST = ["https://developers.cloudflare.com/**", "https://ai-sdk.dev/**"];

interface FetchPattern {
  readonly origin: string;
  readonly path: string;
  readonly canonical: string;
}

/** Parse only unambiguous HTTPS origin/path patterns; never glob the authority. */
function parsePattern(value: unknown): FetchPattern | undefined {
  if (typeof value !== "string" || /[\s\u0000-\u001f\u007f\\?#]/u.test(value)) return undefined;
  const parts = /^https:\/\/([^/]+)(\/.*)?$/iu.exec(value);
  if (parts === null || /[*@]/u.test(parts[1]!)) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname === "") return undefined;
  // Think matches canonical origin + pathname, stripping one DNS trailing dot
  // and ignoring search/hash. Reject ignored fields rather than imply they limit access.
  url.hostname = url.hostname.replace(/\.$/u, "");
  if (url.hostname === "" || url.hostname.includes("*") || url.hostname.endsWith(".")) return undefined;
  const path = parts[2] === undefined ? "/**" : url.pathname;
  // Do not admit ambiguous separators, nested escapes, or malformed escapes in
  // configured paths. WHATWG URL already resolves literal/encoded dot segments.
  if (/%(?:2f|5c|25)/iu.test(path) || /%(?![\da-f]{2})/iu.test(path)) return undefined;
  return { origin: url.origin, path, canonical: `${url.origin}${path}` };
}

/** Syntax validation for persisted owner configuration (deployment checked separately). */
export function isFetchAllowlist(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 16 && value.every(entry => parsePattern(entry) !== undefined);
}

function isSubset(requested: FetchPattern, deployment: FetchPattern): boolean {
  if (requested.origin !== deployment.origin) return false;
  if (requested.path === deployment.path) return true;
  // Only a literal directory followed by /** proves containment for a different
  // pattern. Keep the trailing slash so /docs-other never belongs to /docs/**.
  if (!deployment.path.endsWith("/**")) return false;
  const directory = deployment.path.slice(0, -2);
  if (directory.includes("*")) return false;
  const wildcard = requested.path.indexOf("*");
  const literalPrefix = wildcard === -1 ? requested.path : requested.path.slice(0, wildcard);
  return literalPrefix.startsWith(directory);
}

/**
 * Resolve the exact policy passed to Think, including for previously stored
 * config. A nonempty rejected list must never restore the deployment's full list.
 */
export function resolveFetchAllowlist(deploymentValue: string | undefined, config?: unknown): string[] {
  const entries = deploymentValue === undefined || deploymentValue.trim() === ""
    ? DEFAULT_ALLOWLIST
    : deploymentValue.split(",").map(entry => entry.trim());
  const deployment = entries.map(parsePattern);
  if (deployment.length === 0 || deployment.some(entry => entry === undefined)) throw new Error("fetch/allowlist-invalid");
  const allowed = deployment as FetchPattern[];
  if (config === undefined) return allowed.map(entry => entry.canonical);
  if (typeof config !== "object" || config === null || Array.isArray(config)) throw new Error("fetch/allowlist-invalid");
  const record = config as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "allowlist")) throw new Error("fetch/allowlist-invalid");
  if (record.allowlist === undefined) return allowed.map(entry => entry.canonical);
  if (!isFetchAllowlist(record.allowlist)) throw new Error("fetch/allowlist-invalid");
  if (record.allowlist.length === 0) return allowed.map(entry => entry.canonical);
  const requested = record.allowlist.map(entry => parsePattern(entry)!);
  if (requested.some(entry => !allowed.some(parent => isSubset(entry, parent)))) throw new Error("fetch/allowlist-outside-deployment");
  return requested.map(entry => entry.canonical);
}
