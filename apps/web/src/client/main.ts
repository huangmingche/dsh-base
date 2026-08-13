/** Minimal static client entry: reflects the server session and wires sign-out. */
interface SessionState {
  readonly authenticated: boolean;
  readonly username?: string;
}

async function refresh(): Promise<void> {
  const target = document.querySelector("[data-auth-status]");
  if (target === null) return;
  try {
    const response = await fetch("/api/auth/session", { headers: { accept: "application/json" } });
    const state = (await response.json()) as SessionState;
    target.textContent = state.authenticated && state.username !== undefined ? `Signed in as ${state.username}.` : "Not signed in.";
  } catch {
    target.textContent = "Session state unavailable.";
  }
}

document.querySelector("form[data-sign-out]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void fetch("/api/auth/sign-out", { method: "POST" }).then(() => { location.href = "/login"; }, () => { location.href = "/login"; });
});

void refresh();
