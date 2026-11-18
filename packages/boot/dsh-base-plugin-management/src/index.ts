/**
 * Deployment-level plugin management policy shared by the Worker control plane
 * and the browser composition loader.
 *
 * The optional allowlists are NOT hand-written here: they are generated from the
 * `toggleable: "L1"` pack manifests by
 * `scripts/composition/generate-manageable-composition.mjs`. The pack manifest is
 * the single source for which bundled capabilities an owner may switch; a
 * hand-written list would be a second truth that `check:packs` cannot verify.
 *
 * Every other bundled entry is core/platform-owned and stays read-only: auth,
 * HTTP, session transport, persistence, layout, theme, locale, renderer and the
 * management entry itself can never be switched off by a user. Worker and Think
 * compositions are deployment-owned; an L1 pack may carry client/Think members
 * only (enforced by the loader), so the policy never projects Worker toggles.
 */
import { OPTIONAL_CLIENT_MODULES, OPTIONAL_THINK_MODULES, OPTIONAL_MANAGEMENT_PACKS } from "./manageable.generated.ts";
import { isFetchAllowlist } from "./fetch-policy.ts";

/** Optional client modules, generated from L1 packs. Empty until a client L1 pack exists. */
export const MANAGEABLE_CLIENT_MODULES = OPTIONAL_CLIENT_MODULES;

/** One product bundle, retaining its existing client package identity for saved links and older callers. */
const gatewayPack = OPTIONAL_MANAGEMENT_PACKS["gateway-provider"];
export const GATEWAY_CLIENT_MODULE = gatewayPack.client[0];
export const GATEWAY_THINK_MODULE = gatewayPack.think[0];
export const GATEWAY_BUNDLE_NAME = GATEWAY_CLIENT_MODULE;
export const GATEWAY_BUNDLE_MEMBERS = Object.freeze([...gatewayPack.client, ...gatewayPack.think]);
export function isGatewayModule(name: string): boolean {
  return GATEWAY_BUNDLE_MEMBERS.some(member => member === name);
}

interface OwnerPluginOverride { disabled?: boolean; config?: Record<string, unknown> }

/**
 * The provider selection is authoritative for legacy accounts whose card and
 * model service were switched separately. This changes presentation only and
 * never enables a previously disabled provider. Read projection is side-effect
 * free; the next owner toggle persists the two members atomically. Session and
 * deployment overrides are separate contracts and must not pass through here.
 */
export function normalizeOwnerPluginOverrides(
  overrides: Record<string, OwnerPluginOverride>,
): Record<string, OwnerPluginOverride> {
  if (!GATEWAY_BUNDLE_MEMBERS.some(member => Object.hasOwn(overrides, member))) return overrides;
  const disabled = overrides[GATEWAY_THINK_MODULE]?.disabled ?? false;
  return {
    ...overrides,
    ...Object.fromEntries(GATEWAY_BUNDLE_MEMBERS.map(member => [member, { ...overrides[member], disabled }])),
  };
}

/** Full policy matrix for every reviewed local client package. */
export const CLIENT_PLUGIN_POLICY = Object.freeze({
  optional: MANAGEABLE_CLIENT_MODULES,
  required: Object.freeze([
    "@dsh-base/client-rightbar-extra",       // sole webTerminals provider used by official sidebar terminal
    "@dsh-base/client-settings-navigation",  // replaces the disabled official settings shell/provider
    "@dsh-base/client-deepseek-provider",
    "@dsh-base/client-agent-preset",
    "@dsh-base/client-plugin-management",
    "@dsh-base/client-plugin-manager",       // marked official manager fork; required management surface
    "@dsh-base/client-account-availability",
    "@dsh-base/client-feedback-availability",
    "@dsh-base/client-open-in-app-availability",
    "@dsh-base/client-permission-availability",
    "@dsh-base/client-brand",
    "@dsh-base/client-commands",
    "@dsh-base/client-auth-login",
    "@dsh-base/client-model-selection",
    "@dsh-base/client-settings",
    "@dsh-base/client-sidebar-right",
    "@dsh-base/client-sidebar",          // official navigation with public visibility and checked actions
    "@dsh-base/client-workspace",        // official workspace controls with private Host action guards
    "@dsh-base/client-entry-customization", // official More actions with explicit anonymous availability
    "@dsh-base/client-session-adapter",
    "@dsh-base/client-wire-bootstrap",
    "@dsh-base/client-locale-label",
    "@dsh-base/client-route-address",     // address seam: the official client has no URL router to fall back to
    "@dsh-base/client-site-config",      // disabled inventory; cannot be enabled through owner controls
    "@dsh-base/client-shell-extras",     // custom More rows retired by product request
    "@dsh-base/client-locale-url",       // URL prefix follows the official locale runtime
  ]),
  deploymentOwned: Object.freeze(["Worker static composition", "Cloudflare Think agent composition"]),
  configurable: Object.freeze([] as string[]),
});

export type ManageableClientModule = typeof MANAGEABLE_CLIENT_MODULES[number];

/** Think tools/actions that are optional and can be projected per owner/session, generated from L1 packs. */
export const MANAGEABLE_THINK_MODULES = OPTIONAL_THINK_MODULES;
export type ManageableThinkModule = typeof MANAGEABLE_THINK_MODULES[number];
/** Package identities and Think runtime names are different contracts; never infer one from a suffix. */
const THINK_RUNTIME_NAMES: Readonly<Record<ManageableThinkModule, string>> = Object.freeze({
  "@dsh-base/cloudflare-think-ai-gateway": "cloudflare-ai-gateway",
  "@dsh-base/cloudflare-think-fetch": "fetch",
  "@dsh-base/cloudflare-think-memory": "memory",
});
export function manageableThinkRuntimeName(moduleName: ManageableThinkModule): string {
  const name = THINK_RUNTIME_NAMES[moduleName];
  if (name === undefined) throw new Error(`plugin-manager/runtime-name-unavailable:${moduleName}`);
  return name;
}
export const MANAGEABLE_THINK_RUNTIME_NAMES = Object.freeze(MANAGEABLE_THINK_MODULES.map(manageableThinkRuntimeName));
const manageableThink = new Set<string>(MANAGEABLE_THINK_MODULES);
export function isManageableThinkModule(moduleName: unknown): moduleName is ManageableThinkModule {
  return typeof moduleName === "string" && manageableThink.has(moduleName);
}
export function isManageableModule(moduleName: unknown): moduleName is string {
  return isManageableClientModule(moduleName) || isManageableThinkModule(moduleName);
}
const manageable = new Set<string>(MANAGEABLE_CLIENT_MODULES);

/** Whether one bundled client module is safe to switch per owner. */
export function isManageableClientModule(moduleName: unknown): moduleName is ManageableClientModule {
  return typeof moduleName === "string" && manageable.has(moduleName);
}

/** Required shell/platform modules that must remain visible but read-only. */
export const REQUIRED_CLIENT_MODULES = Object.freeze([
  "@dsh-base/client-session-adapter",
  "@dsh-base/client-deepseek-provider",
  "@deepseek-ai/dsh-client-ui-renderer",
  "@deepseek-ai/dsh-client-ui-theme",
  "@deepseek-ai/dsh-client-ui-layout",
  "@deepseek-ai/dsh-client-ui-settings",
  "@dsh-base/client-auth-login",
  "@deepseek-ai/dsh-client-connection",
] as const);

/** A strictly empty config object is the only config accepted for the current empty-schema plugins. */
export function validatePluginConfig(moduleName: string, config: unknown): string | undefined {
  if (moduleName === "@dsh-base/cloudflare-think-fetch") {
    if (typeof config !== "object" || config === null || Array.isArray(config)) return "plugin-manager/config-invalid";
    const record = config as Record<string, unknown>;
    if (Object.keys(record).some(key => key !== "allowlist")) return "plugin-manager/config-unsupported";
    if (record.allowlist === undefined) return undefined;
    if (!isFetchAllowlist(record.allowlist)) return "plugin-manager/config-invalid";
    return undefined;
  }
  if (!isManageableClientModule(moduleName) && !isManageableThinkModule(moduleName)) return "plugin-manager/not-manageable";
  if (typeof config !== "object" || config === null || Array.isArray(config)) return "plugin-manager/config-invalid";
  const record = config as Record<string, unknown>;
  if (Object.keys(record).length !== 0) return "plugin-manager/config-unsupported";
  return undefined;
}
