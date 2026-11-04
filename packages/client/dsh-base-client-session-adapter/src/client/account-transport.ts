/** Local authentication truth: only a completed server operation changes account state. */
export interface LocalAccountUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
}

export async function readLocalAccount(fetcher: typeof fetch = fetch): Promise<LocalAccountUser | null> {
  const response = await fetcher("/api/auth/get-session", { headers: { accept: "application/json" } });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Account session read failed: ${response.status}`);
  const value = await response.json() as { user?: LocalAccountUser | null } | null;
  return value?.user ?? null;
}

export async function signOutLocalAccount(fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/auth/sign-out", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  if (!response.ok) throw new Error(`Sign out failed: ${response.status}`);
}
