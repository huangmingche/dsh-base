/**
 * Worker HTTP routing for the Workers-native Session Host transport.
 *
 * This module owns transport concerns only: the `/api/session-host` route
 * shape, the stable per-owner Durable Object identity, and one-time legacy
 * snapshot migration. Both the browser transport route and the official RPC
 * bridge dispatch through the same function, so both callers observe one Host.
 */
import type { R2BucketLike } from "./workspace-files.ts";
import { migrationRowCount, migrationScore, SESSION_HOST_STORAGE_ID, validateMigrationSnapshot } from "./migration.ts";

export const name = "@dsh-base/cloudflare-worker-session-host/worker-http";

/** Worker bindings read by the Session Host route. */
export interface SessionHostWorkerEnv {
  readonly SESSION_HOST?: DurableObjectNamespace;
  /** R2 bucket holding workspace file content bytes, when the deployment has one. */
  readonly FILES?: R2BucketLike;
}

const PATH = "/api/session-host";
// Stable deployed storage identity. Worker code upgrades do not rename data.
// Every generation this repository has deployed after the migration endpoints
// existed. Recovery inspects newest to oldest because rapid generation bumps
// can leave an owner's data more than one generation behind.
const LEGACY_VERSIONS: readonly string[] = Array.from({ length: 40 }, (_, index) => `default-v${48 - index}`);
const CLAIM_PATH = `${PATH}/claim`;
const CONTROL_PATH = `${PATH}/control`;
const CHANGES_PATH = `${PATH}/changes`;

/**
 * Route one Session Host request to the serving Durable Object.
 * @param request - browser or in-Worker request addressed to the Host.
 * @param env - Worker bindings carrying `SESSION_HOST`.
 * @param ownerId - authenticated user id that names the owner's Durable Object.
 * @returns the Host response, or undefined when the path is not a Host route.
 */
export const handleSessionHostRequest = async (
  request: Request,
  env: unknown,
  ownerId: string,
): Promise<Response | undefined> => {
  const url = new URL(request.url);
  if (url.pathname !== `${PATH}/upload-file` && url.pathname !== PATH && url.pathname !== `${PATH}/follow` && url.pathname !== `${PATH}/live` && url.pathname !== `${PATH}/live-stream` && url.pathname !== CONTROL_PATH && url.pathname !== CHANGES_PATH && url.pathname !== CLAIM_PATH) return undefined;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) {
    return Response.json({ error: "untrusted_origin" }, { status: 403 });
  }
  const typed = env as SessionHostWorkerEnv;
  if (typed.SESSION_HOST === undefined) {
    return Response.json({ error: "session_host_binding_missing" }, { status: 500 });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { allow: "GET, POST, OPTIONS" } });
  }
  const isFollow = url.pathname === `${PATH}/follow`;
  const isLive = url.pathname === `${PATH}/live`;
  const isLiveStream = url.pathname === `${PATH}/live-stream`;
  const isControl = url.pathname === CONTROL_PATH || url.pathname === CHANGES_PATH;
  const isClaim = url.pathname === CLAIM_PATH;
  if (((isFollow || isLive || isLiveStream || isControl) && request.method !== "GET") || (!isFollow && !isLive && !isLiveStream && !isControl && request.method !== "POST")) {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  void isClaim;
  const target = typed.SESSION_HOST.get(typed.SESSION_HOST.idFromName(`owner:${ownerId}:${SESSION_HOST_STORAGE_ID}`));
  // Recovery must finish before forwarding reads or writes. Otherwise a failed
  // import can be hidden by a newly created default workspace/session. Fetches
  // only read legacy objects; the target atomically commits all restored data.
  try {
    const statusResponse = await target.fetch(new Request("https://session-host/api/session-host/migrate/status"));
    if (!statusResponse.ok) throw new Error("migration status unavailable");
    const status = await statusResponse.json() as { migrated?: boolean };
    if (typeof status.migrated !== "boolean") throw new Error("invalid migration status");
    if (!status.migrated) {
        let best: { version: string; snapshot: unknown; score: number } | undefined;
        for (const version of LEGACY_VERSIONS) {
          const legacy = typed.SESSION_HOST.get(typed.SESSION_HOST.idFromName(`owner:${ownerId}:${version}`));
          const exported = await legacy.fetch(new Request("https://session-host/api/session-host/migrate/export"));
          if (!exported.ok) throw new Error(`legacy snapshot unavailable: ${version}`);
          const snapshot = validateMigrationSnapshot(await exported.json());
          if (migrationRowCount(snapshot) === 0) continue;
          const score = migrationScore(snapshot);
          if (best === undefined || score > best.score) best = { version, snapshot, score };
        }
        // A read failure differs from an absent object: retry rather than
        // permanently declaring an owner migrated without its sidecar.
        const bucket = (env as { readonly FILES?: { get(key: string): Promise<{ text(): Promise<string> } | null> } }).FILES;
        let sidecar: unknown;
        if (bucket !== undefined) {
          const object = await bucket.get(`owner/${ownerId}/migration/v49-sidecar.json`);
          if (object !== null && object !== undefined) {
            sidecar = JSON.parse(await object.text());
            if (typeof sidecar !== "object" || sidecar === null || Array.isArray(sidecar)
              || (sidecar as { ownerId?: unknown }).ownerId !== ownerId) throw new Error("invalid migration sidecar owner");
          }
        }
        const committed = await target.fetch(new Request("https://session-host/api/session-host/migrate/commit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...(best === undefined ? {} : { snapshot: best.snapshot }), ...(sidecar === undefined ? {} : { sidecar }) }),
        }));
        if (!committed.ok || (await committed.json() as { migrated?: unknown }).migrated !== true) {
          throw new Error("migration commit failed");
        }
    }
  } catch {
    return Response.json({ error: "session_host_recovery_pending", message: "Session recovery could not complete; retry the request." }, {
      status: 503, headers: { "retry-after": "3", "cache-control": "no-store" },
    });
  }
  const stub = target;
  const forwarded = (isFollow || isLive || isLiveStream || isControl)
    ? new Request(request.url, { method: "GET", headers: request.headers, signal: request.signal })
    : new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: request.signal,
        duplex: "half",
      } as RequestInit);
  return stub.fetch(forwarded);
};
