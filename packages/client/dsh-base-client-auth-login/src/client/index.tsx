import { z } from "zod";
/** dsh-base local-account sign-in surface rendered with official DSH primitives. */
import { useEffect, useId, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button, FishLogo, Input } from "@deepseek-ai/dsh-client-ui-primitives";
import { installThemeStyles } from "@deepseek-ai/dsh-client-ui-theme/src/client/styles.ts";
import { installIconSprite } from "@deepseek-ai/dsh-client-ui-theme/src/client/icon-sprite.ts";
import { DEFAULT_FONT_SIZES, DEFAULT_PREFERENCE } from "@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts";
import { ThemePresenter } from "@deepseek-ai/dsh-client-ui-layout/src/client/theme-presenter.ts";
import type { Context } from "@deepseek-ai/cordis";
import "./login.css";
import { loginReturnPath } from "./return-url.ts";
import { readRegistrationPolicy, type RegistrationPolicy } from "./registration-policy.ts";
import { loginCopy } from "./locales.ts";

export const Config = z.object({}).default({});

export const name = "@dsh-base/client-auth-login";

type View = "sign-in" | "register";

interface AccountUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
}

export function LoginSurface({ onSignedIn }: { readonly onSignedIn: () => void }) {
  const copy = loginCopy(new URL(location.href).searchParams.get("locale") ?? document.documentElement.lang ?? navigator.language);
  const [policy, setPolicy] = useState<RegistrationPolicy>("loading");
  useEffect(() => {
    const controller = new AbortController();
    void readRegistrationPolicy(fetch, controller.signal).then((value) => { if (!controller.signal.aborted) setPolicy(value); });
    return () => controller.abort();
  }, []);
  const [view, setView] = useState<View>("sign-in");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usernameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const hintId = useId();
  const register = view === "register";
  const registrationAllowed = policy === "enabled";
  const policyReason = policy === "loading" ? copy.checkingPolicy : policy === "unavailable" ? copy.policyUnavailable : copy.registrationClosed;

  const submit = async (): Promise<void> => {
    if (busy || (register && !registrationAllowed)) return;
    setBusy(true);
    setError(null);
    try {
      const value = identifier.trim();
      const endpoint = register
        ? "/api/auth/sign-up/email"
        : value.includes("@") ? "/api/auth/sign-in/email" : "/api/auth/sign-in/username";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(register
          ? { username: value, name: value, email: email.trim(), password }
          : value.includes("@") ? { email: value, password } : { username: value, password }),
      });
      const body = await response.json().catch(() => ({})) as { user?: AccountUser; message?: string; code?: string; error?: string };
      if (!response.ok) {
        const code = body.code ?? body.error;
        setError(code === "USERNAME_IS_ALREADY_TAKEN" || code === "USER_ALREADY_EXISTS" || body.message?.toLowerCase().includes("already")
          ? copy.alreadyRegistered
          : code === "INVALID_USERNAME_OR_PASSWORD" || code === "INVALID_EMAIL_OR_PASSWORD" || body.message?.toLowerCase().includes("invalid")
            ? copy.invalidCredentials
            : copy.requestFailed);
        return;
      }
      onSignedIn();
    } catch {
      setError(copy.connectionFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dsh-login" role="main">
      <div className="dsh-login-card">
        <div className="dsh-login-brand" aria-hidden="true"><FishLogo size={44} /></div>
        <h1 className="dsh-login-title">{register ? copy.createTitle : copy.signInTitle}</h1>
        <p className="dsh-login-intro">
          {register ? copy.createIntro : copy.signInIntro}
        </p>
        <form className="dsh-login-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={busy}>
          <label className="dsh-login-label" htmlFor={usernameId}>{register ? copy.username : copy.identifier}</label>
          <Input id={usernameId} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
            autoFocus required minLength={register ? 3 : undefined} maxLength={254} value={identifier}
            aria-describedby={register ? hintId : undefined} disabled={busy}
            onChange={(event) => { setIdentifier(event.target.value); }} />
          {register ? <>
            <label className="dsh-login-label" htmlFor={emailId}>{copy.email}</label>
            <Input id={emailId} name="email" type="email" autoComplete="email" autoCapitalize="none" required
              value={email} disabled={busy} onChange={(event) => { setEmail(event.target.value); }} />
            <span className="dsh-login-hint" id={hintId}>{copy.usernameHint}</span>
          </> : null}
          <label className="dsh-login-label" htmlFor={passwordId}>{copy.password}</label>
          <Input id={passwordId} name="password" type="password" autoComplete={register ? "new-password" : "current-password"}
            required minLength={8} maxLength={128} value={password} disabled={busy}
            onChange={(event) => { setPassword(event.target.value); }} />
          {register ? <span className="dsh-login-hint">{copy.passwordHint}</span> : null}
          {error !== null ? <p className="dsh-login-error" role="alert">{error}</p> : null}
          <Button className="dsh-login-submit" type="submit" variant="primary" disabled={busy || (register && !registrationAllowed)}>
            {busy ? copy.wait : register ? copy.create : copy.signIn}
          </Button>
        </form>
        <Button className="dsh-login-switch" variant="outline" disabled={busy || (!register && !registrationAllowed)}
          aria-describedby={!registrationAllowed ? `${hintId}-policy` : undefined} title={!registrationAllowed ? policyReason : undefined}
          onClick={() => { setView(register ? "sign-in" : "register"); setError(null); }}>
          {register ? copy.haveAccount : copy.createSwitch}
        </Button>
        {!registrationAllowed ? <p id={`${hintId}-policy`} className="dsh-login-hint" role="status">{policyReason}</p> : null}
      </div>
    </div>
  );
}

/** Public document provider: the route composition starts no authenticated app services. */
export function apply(ctx: Context): void {
  if (location.pathname !== "/login") return;
  installThemeStyles(ctx);
  installIconSprite(ctx, undefined);
  // There is no authenticated settings scope on this public document. Supply
  // the official system-default snapshot to its unchanged DOM presenter.
  ctx.effect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const presenter = new ThemePresenter();
    const update = () => {
      const colorScheme = media.matches ? "dark" : "light";
      presenter.apply({
        preference: DEFAULT_PREFERENCE,
        fontSizes: DEFAULT_FONT_SIZES,
        fontFamilies: { text: "", code: "", terminal: "" },
        active: { id: colorScheme, colorScheme, tokens: {} },
        themes: [],
        revision: 0,
      });
    };
    update();
    media.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); presenter.dispose(); };
  }, "dsh-base: public document official system theme");
  document.body.dataset.dshLogin = "true";
  document.title = loginCopy(new URL(location.href).searchParams.get("locale") ?? document.documentElement.lang).signInTitle;
  const container = document.createElement("div");
  container.id = "dsh-base-login";
  document.body.append(container);
  let root: Root | undefined;
  ctx.effect(() => {
    root = createRoot(container);
    root.render(<LoginSurface onSignedIn={() => {
      const next = new URL(location.href).searchParams.get("next");
      location.assign(loginReturnPath(next, location.origin));
    }} />);
    return () => {
      root?.unmount();
      root = undefined;
      container.remove();
      delete document.body.dataset.dshLogin;
    };
  }, "dsh-base: local account login surface");
}
