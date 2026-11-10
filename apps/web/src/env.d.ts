import type { DurableObjectNamespace, Fetcher } from "@cloudflare/workers-types";

/**
 * Bindings available to the Worker and its Durable Object.
 */
export interface Env {
  /** Optional server-only GA4 credential; analytics stays off until configured. */
  GOOGLE_ANALYTICS_API_SECRET?: string;
  SITE_ANALYTICS_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** AI binding used by the Cloudflare AI Gateway universal route. */
  AI: Ai;
  /** Existing Cloudflare AI Gateway with a stored DeepSeek provider key; empty keeps the platform provider unregistered. */
  AI_GATEWAY_ID?: string;
  /** Explicit operator opt-in for the platform Gateway route; defaults to false. */
  PLATFORM_AI_ENABLED?: string;
  /** Comma-separated fetch allowlist; defaults to public HTTPS. */
  FETCH_ALLOWLIST?: string;
  /** Static-assets binding for the built React client. */
  ASSETS: Fetcher;
  /** Durable Object namespace that hosts the agent. */
  DshAgent: DurableObjectNamespace;
  /** Restored compatibility namespace; execution is unavailable and its storage starts empty (no history to verify). */
  DshSubagent: DurableObjectNamespace;
  /** Durable Object namespace storing per-owner plugin enable/config overrides. */
  PluginControl: DurableObjectNamespace;
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
  /** Public deployment label served by `/api/site-config`. */
  SITE_ENVIRONMENT_LABEL?: string;
  /** Public product brand name served by `/api/site-config`. */
  SITE_BRAND_NAME?: string;
  /** Public docs/repository URL served by `/api/site-config`. */
  SITE_DOCS_URL?: string;
  /** Public support mailbox served by `/api/site-config`. */
  SITE_SUPPORT_EMAIL?: string;
  /** Public source repository URL served by `/api/site-config`. */
  SITE_GITHUB_URL?: string;
  /** Durable Object account and session store for local product accounts. */
  AUTH_STORE: DurableObjectNamespace;
}
