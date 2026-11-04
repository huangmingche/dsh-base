export type RegistrationPolicy = "loading" | "enabled" | "closed" | "unavailable";

/** Public capability only. Missing, malformed or failed policy never enables registration. */
export async function readRegistrationPolicy(fetcher: typeof fetch, signal?: AbortSignal): Promise<RegistrationPolicy> {
  try {
    const response = await fetcher("/api/auth-policy", { cache: "no-store", credentials: "same-origin", signal });
    if (!response.ok) return "unavailable";
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || !("signUpEnabled" in value)) return "unavailable";
    return value.signUpEnabled === true ? "enabled" : value.signUpEnabled === false ? "closed" : "unavailable";
  } catch {
    return "unavailable";
  }
}
