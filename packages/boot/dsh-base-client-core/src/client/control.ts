/** Client API for the Worker plugin control plane. */
import type { StaticPluginLoaderConfig, PluginConfigValue } from "@dsh-base/plugin-loader-static";
import { isManageableClientModule, validatePluginConfig } from "../../../dsh-base-plugin-management/src/index.ts";
import { accountSession } from "./account-session.ts";

export interface ControlOverride {
  disabled?: boolean;
  config?: Record<string, PluginConfigValue>;
}

export interface ControlState {
  revision: number;
  overrides: Record<string, ControlOverride>;
  ownerId?: string;
}

const EMPTY: ControlState = { revision: 0, overrides: {} };
const TOKEN_KEY = "dsh-base:control-token";

function isConfigValue(value: unknown, depth = 0): value is PluginConfigValue {
  if (depth > 16) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => isConfigValue(item, depth + 1));
  return typeof value === "object" && Object.values(value).every(item => isConfigValue(item, depth + 1));
}

/** Treat a malformed control document as unavailable, never executable config. */
export function parseControlState(value: unknown): ControlState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid control state");
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 0 || typeof record.overrides !== "object" || record.overrides === null || Array.isArray(record.overrides)) throw new Error("Invalid control state");
  const overrides: Record<string, ControlOverride> = {};
  for (const [name, raw] of Object.entries(record.overrides)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Invalid control override");
    const override = raw as Record<string, unknown>;
    if (override.disabled !== undefined && typeof override.disabled !== "boolean") throw new Error("Invalid control disabled state");
    const config = override.config;
    if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config) || !isConfigValue(config))) throw new Error("Invalid control configuration");
    Object.defineProperty(overrides, name, { enumerable: true, value: {
      ...(override.disabled === undefined ? {} : { disabled: override.disabled }),
      ...(config === undefined ? {} : { config }),
    } });
  }
  const ownerId = record.ownerId
  if (ownerId !== undefined && (typeof ownerId !== 'string' || ownerId.length === 0)) throw new Error("Invalid control owner")
  return { revision: Number(record.revision), overrides, ...(ownerId === undefined ? {} : { ownerId }) };
}

/** Mutation rejected because the deployment requires an admin token. */
export class ControlUnauthorizedError extends Error {
  constructor() {
    super("Plugin control requires an admin token");
    this.name = "ControlUnauthorizedError";
  }
}

/** Store the admin token for this browser session (never persisted long-term). */
export function setControlToken(token: string | null): void {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

function controlHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = { accept: "application/json" };
  if (json) headers["content-type"] = "application/json";
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token !== null && token !== "") headers.authorization = `Bearer ${token}`;
  } catch {}
  return headers;
}

export async function loadControl(): Promise<ControlState> {
  // A checked public session has no owner overrides. Do not probe a private
  // endpoint just to discover it is anonymous; auth failures remain failures.
  if (await accountSession.read() === null) return EMPTY;
  let response: Response;
  try {
    response = await fetch("/api/plugin-manager", { headers: controlHeaders(), credentials: "same-origin" });
  } catch (error) {
    throw new Error(`Plugin selection could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 401 || response.status === 403) throw new ControlUnauthorizedError();
  if (!response.ok) throw new Error(`Plugin selection could not be read (${response.status})`);
  return parseControlState(await response.json());
}

export async function saveControl(name: string, patch: ControlOverride): Promise<ControlState> {
  const response = await fetch("/api/plugin-manager", {
    method: "PUT",
    headers: controlHeaders(true),
    body: JSON.stringify({ name, ...patch }),
  });
  const body = await response.json().catch(() => ({})) as ControlState & { error?: string };
  if (response.status === 401 || response.status === 403) throw new ControlUnauthorizedError();
  if (!response.ok) throw new Error(body.error ?? `control ${response.status}`);
  return parseControlState(body);
}

/** Apply control-plane overrides to the literal composition before boot. */
export async function controlledComposition(base: StaticPluginLoaderConfig): Promise<StaticPluginLoaderConfig> {
  const state = await loadControl();
  if (Object.keys(state.overrides).length === 0) return base;
  const entries = base.entries.map((entry) => {
    const override = state.overrides[entry.name];
    if (override === undefined) return entry;
    // Disabled source rows are inventory, not a remotely installable module.
    // In particular, a stale override must never revive an original alongside
    // its selected replacement or break boot by enabling unbundled source.
    if (entry.disabled || !Object.hasOwn(base.modules, entry.name)) return entry;
    // Only the deployment allowlist can be changed by an owner. Required
    // shell/platform entries are never rewritten from remote state.
    if (!isManageableClientModule(entry.name)) return entry;
    return {
      ...entry,
      ...(override.disabled === undefined ? {} : { disabled: override.disabled }),
      ...(override.config === undefined || validatePluginConfig(entry.name, override.config) !== undefined ? {} : {
        config: { ...(typeof entry.config === "object" && entry.config !== null && !Array.isArray(entry.config) ? entry.config : {}), ...override.config },
      }),
    };
  });
  return { ...base, entries };
}

/** Keep live Loader entries only for owner-disabled plugins the deployment actually bundles. */
export function ownerBootSelection(base: StaticPluginLoaderConfig, selected: StaticPluginLoaderConfig, namespaces: Readonly<Record<string, unknown>>) {
  const deployed = new Set(base.entries.filter(entry => !entry.disabled && isManageableClientModule(entry.name)
    && Object.hasOwn(base.modules, entry.name) && Object.hasOwn(namespaces, entry.name)).map(entry => entry.name));
  const disableAfterBoot: string[] = [];
  const entries = selected.entries.map(entry => {
    if (!entry.disabled || !deployed.has(entry.name)) return entry;
    disableAfterBoot.push(entry.name);
    return { ...entry, disabled: false };
  });
  return { entries, disableAfterBoot };
}
