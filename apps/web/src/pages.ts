/** Server-rendered pages for the rc.5 minimal surface. */
export const styles = `
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d10; color: #e6e8eb; }
main { width: min(560px, 92vw); padding: 32px; border: 1px solid #2a2f36; border-radius: 12px; background: #13161b; }
h1 { margin: 0 0 8px; font-size: 22px; }
p, label { color: #a8b0ba; font-size: 14px; line-height: 1.5; }
code { color: #e6e8eb; background: #1c2128; padding: 1px 5px; border-radius: 4px; }
form { display: grid; gap: 12px; margin-top: 20px; }
input { padding: 10px 12px; border-radius: 8px; border: 1px solid #2f353d; background: #0b0d10; color: inherit; }
button { padding: 10px 12px; border-radius: 8px; border: 1px solid #3b6cf6; background: #3b6cf6; color: #fff; cursor: pointer; }
button:disabled { background: #23272e; border-color: #2f353d; color: #7d8590; cursor: not-allowed; }
a { color: #7aa2ff; }
.notice { margin: 16px 0 0; padding: 10px 12px; border-radius: 8px; background: #2a1e14; border: 1px solid #5c3a1e; color: #f0c48a; font-size: 13px; }
.error { margin: 16px 0 0; padding: 10px 12px; border-radius: 8px; background: #2a1416; border: 1px solid #5c1e24; color: #f08a95; font-size: 13px; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/assets/app.css"></head>
<body><main>${body}</main><script type="module" src="/assets/client.js"></script></body>
</html>`;
}

/** Home page: shows the authenticated owner or the sign-in entry. */
export function homePage(input: { username?: string }): string {
  if (input.username !== undefined) {
    return page("DeepSeek Harness Base", `<h1>DeepSeek Harness Base</h1>
<p>Minimal Workers surface on <code>dsh-0.1.0-rc.5</code>.</p>
<p data-auth-status>Signed in as <strong>${escapeHtml(input.username)}</strong>.</p>
<form data-sign-out><button type="submit">Sign out</button></form>`);
  }
  return page("DeepSeek Harness Base", `<h1>DeepSeek Harness Base</h1>
<p>Minimal Workers surface on <code>dsh-0.1.0-rc.5</code>.</p>
<p data-auth-status>Not signed in.</p>
<p><a href="/login">Sign in</a></p>`);
}

/** Login page: the form is visible but disabled when the deployment has no auth settings. */
export function loginPage(input: { configured: boolean; error?: string }): string {
  const notice = input.configured
    ? ""
    : `<p class="notice">Authentication is not configured for this deployment: set <code>AUTH_USERNAME</code>, <code>AUTH_PASSWORD_SHA256</code> and <code>AUTH_SECRET</code>.</p>`;
  const error = input.error === "invalid" ? `<p class="error">Invalid username or password.</p>` : "";
  return page("Sign in — DeepSeek Harness Base", `<h1>Sign in</h1>${notice}${error}
<form method="post" action="/api/auth/sign-in">
<label>Username <input name="username" autocomplete="username" required></label>
<label>Password <input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit"${input.configured ? "" : " disabled"}>Continue</button>
</form>
<p><a href="/">Back</a></p>`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
