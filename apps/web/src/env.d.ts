import type { DurableObjectNamespace, Fetcher } from "@cloudflare/workers-types";

/**
 * Bindings available to the Worker and its Durable Object.
 */
export interface Env {
  /** Comma-separated fetch allowlist; defaults to public HTTPS. */
  FETCH_ALLOWLIST?: string;
  /** Static-assets binding for the built React client. */
  ASSETS: Fetcher;
  /** Durable Object namespace that hosts the agent. */
  DshAgent: DurableObjectNamespace;
  /** D1 database for Better Auth account, session, verification, and rate-limit rows. */
  AUTH_DB: D1Database;
  /** Public application origin used by Better Auth. */
  AUTH_BASE_URL: string;
  /** Better Auth signing secret. */
  AUTH_SECRET: string;
  /** Durable Object namespace exposing the Workers-native official Session Host. */
  SESSION_HOST: DurableObjectNamespace;
  /** Current Session Host generation, kept in sync with its OWNER_VERSION. */
  SESSION_HOST_GENERATION: string;
  /** Durable Object account and session store for local product accounts. */
  AUTH_STORE: DurableObjectNamespace;
}
