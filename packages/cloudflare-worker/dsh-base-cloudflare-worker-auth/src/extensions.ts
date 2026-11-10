import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";

/** Worker-only plugin composition contract. Extensions cannot override core auth security options. */
export interface AuthExtension {
  readonly id: string;
  cacheKey(env: unknown): string;
  options(env: unknown): { readonly plugins?: BetterAuthPlugin[]; readonly socialProviders?: BetterAuthOptions["socialProviders"] };
  policy?(env: unknown): Record<string, boolean>;
}

export function createAuthExtensions() {
  const entries = new Map<string, AuthExtension>();
  let revision = 0;
  return {
    register(extension: AuthExtension): () => void {
      if (!extension.id || entries.has(extension.id)) throw new Error("duplicate_auth_extension");
      entries.set(extension.id, extension); revision++;
      return () => { if (entries.get(extension.id) === extension) { entries.delete(extension.id); revision++; } };
    },
    resolve(env: unknown) {
      const plugins: BetterAuthPlugin[] = [];
      const pluginIds = new Set(["username"]);
      const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
      const policy: Record<string, boolean> = {};
      const keys: Array<[string, string]> = [];
      for (const extension of entries.values()) {
        keys.push([extension.id, extension.cacheKey(env)]);
        const options = extension.options(env);
        for (const plugin of options.plugins ?? []) {
          if (!plugin.id || pluginIds.has(plugin.id)) throw new Error("duplicate_auth_plugin");
          pluginIds.add(plugin.id); plugins.push(plugin);
        }
        for (const [id, provider] of Object.entries(options.socialProviders ?? {})) {
          if (Object.hasOwn(socialProviders, id)) throw new Error("duplicate_auth_provider");
          Object.assign(socialProviders, { [id]: provider });
        }
        for (const [key, value] of Object.entries(extension.policy?.(env) ?? {})) {
          if (typeof value !== "boolean" || Object.hasOwn(policy, key) || ["signUpEnabled", "email", "passwordResetEnabled", "emailVerificationEnabled", "emailVerificationRequired"].includes(key)) throw new Error("invalid_auth_policy_extension");
          policy[key] = value;
        }
      }
      return { plugins, socialProviders, policy, key: JSON.stringify([revision, keys]) };
    },
  };
}
export type AuthExtensions = ReturnType<typeof createAuthExtensions>;
