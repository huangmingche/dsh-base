export type RegistrationPolicy = "loading" | "enabled" | "closed" | "unavailable";
export interface AuthPolicy {
  readonly registration: RegistrationPolicy;
  readonly email: { readonly enabled: boolean; readonly ready: boolean; readonly provider: "cloudflare" | "resend" | null };
  readonly passwordResetEnabled: boolean;
  readonly emailVerificationEnabled: boolean;
  readonly emailVerificationRequired: boolean;
  readonly googleEnabled: boolean;
}
export const LOADING_AUTH_POLICY: AuthPolicy = { registration: "loading", email: { enabled: false, ready: false, provider: null }, passwordResetEnabled: false, emailVerificationEnabled: false, emailVerificationRequired: false, googleEnabled: false };
const UNAVAILABLE_AUTH_POLICY: AuthPolicy = { ...LOADING_AUTH_POLICY, registration: "unavailable" };

/** Public capability only. Missing, malformed or failed policy never enables registration. */
export async function readRegistrationPolicy(fetcher: typeof fetch, signal?: AbortSignal): Promise<RegistrationPolicy> {
  return (await readAuthPolicy(fetcher, signal)).registration;
}

/** Missing or malformed mail capabilities keep their visible controls disabled. */
export async function readAuthPolicy(fetcher: typeof fetch, signal?: AbortSignal): Promise<AuthPolicy> {
  try {
    const response = await fetcher("/api/auth-policy", { cache: "no-store", credentials: "same-origin", signal });
    if (!response.ok) return UNAVAILABLE_AUTH_POLICY;
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || !("signUpEnabled" in value)) return UNAVAILABLE_AUTH_POLICY;
    const record = value as Record<string, unknown>;
    const mail = record.email && typeof record.email === "object" ? record.email as Record<string, unknown> : {};
    const provider = mail.provider === "cloudflare" || mail.provider === "resend" ? mail.provider : null;
    const ready = mail.enabled === true && mail.ready === true && provider !== null;
    return { registration: value.signUpEnabled === true ? "enabled" : value.signUpEnabled === false ? "closed" : "unavailable",
      email: { enabled: mail.enabled === true, ready, provider },
      passwordResetEnabled: ready && record.passwordResetEnabled === true,
      emailVerificationEnabled: ready && record.emailVerificationEnabled === true,
      emailVerificationRequired: record.emailVerificationRequired === true,
      googleEnabled: record.googleEnabled === true };
  } catch {
    return UNAVAILABLE_AUTH_POLICY;
  }
}
