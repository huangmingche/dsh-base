/** Deployment-owned settings write policy shared by every Host write boundary. */

/** One settings mutation operation, structurally compatible with the Host store. */
export interface SettingsWriteOperation {
  readonly op: "set" | "unset";
  readonly path: readonly string[];
  readonly value?: unknown;
}

/**
 * Reject writes to fields this deployment's runtime does not consume.
 * Root-level set/delete is rejected too: it would implicitly delete durable
 * historical managed values or silently rewrite the whole managed section.
 * @param endpoint - diagnostic label for the calling boundary.
 * @param ns - settings namespace.
 * @param ops - complete mutation operations.
 */
export function assertSettingsWriteSupported(endpoint: string, ns: string, ops: readonly SettingsWriteOperation[]): void {
  if (ns === "llm-cloudflare-gateway") throw unsupported(endpoint, ns, "operator-managed Cloudflare AI Gateway settings");
}

/** Reject update patches that target a fixed field. */
export function assertSettingsPatchSupported(endpoint: string, ns: string, patch: Readonly<Record<string, unknown>>): void {
  if (ns === "llm-cloudflare-gateway") throw unsupported(endpoint, ns, "operator-managed Cloudflare AI Gateway settings");
}

function unsupported(endpoint: string, ns: string, field: string): Error & { code: string } {
  const error = new Error(`${endpoint}: ${ns}.${field} is fixed by this deployment's model route`) as Error & { code: string };
  error.code = "settings/unsupported";
  return error;
}
