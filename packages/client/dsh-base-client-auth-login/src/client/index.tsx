import { z } from "zod";
import { createRoot } from "react-dom/client";
import type { Context } from "@deepseek-ai/cordis";
import { installThemeStyles } from "@deepseek-ai/dsh-client-ui-theme/src/client/styles.ts";
import { installIconSprite } from "@deepseek-ai/dsh-client-ui-theme/src/client/icon-sprite.ts";
import { DEFAULT_FONT_SIZES, DEFAULT_PREFERENCE } from "@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts";
import { ThemePresenter } from "@deepseek-ai/dsh-client-ui-layout/src/client/theme-presenter.ts";
import { LoginSurface } from "./LoginDialog.tsx";
import { LOGIN_REQUEST_EVENT, type LoginRequest } from "./request.ts";
import { loginDocumentReturnPath, loginReturnPath } from "./return-url.ts";
import { loginCopy } from "./locales.ts";
import { loginNavigation } from "./login-navigation.ts";
import "./login.css";
export { LoginSurface } from "./LoginDialog.tsx";
export const Config = z.object({}).default({});
export const name = "@dsh-base/client-auth-login";

/** Both public document and in-shell action gate share one real account flow. */
export function apply(ctx: Context): void {
  const standalone = location.pathname === "/login";
  const navigation = loginNavigation(new URL(location.href), document.documentElement.lang || navigator.language);
  if (standalone) {
    document.body.dataset.dshLogin = "true";
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
    document.documentElement.lang = navigation.language;
    document.title = loginCopy(navigation.locale).signInTitle;
  }
  ctx.effect(() => {
    const container = document.createElement("div");
    container.id = "dsh-base-login";
    document.body.append(container);
    const root = createRoot(container);
    let sequence = 0;
    let open = false;
    const close = () => {
      open = false;
      root.render(null);
      // A protected next destination would immediately redirect a guest back to
      // /login. Dismissal returns to the public home; only success follows next.
      if (standalone) location.assign(navigation.home);
    };
    const show = (options: LoginRequest = {}) => {
      if (open) return;
      open = true;
      // Official modal shortcut ownership follows document order, including portals.
      document.body.append(container);
      const next = options.next ?? (standalone ? loginDocumentReturnPath(new URL(location.href)) : `${location.pathname}${location.search}${location.hash}`);
      root.render(<LoginSurface key={++sequence} mode={options.mode} next={next} onClose={close} onSignedIn={() => {
        location.assign(loginReturnPath(next, location.origin));
      }} />);
    };
    const listener = (event: Event) => show((event as CustomEvent<LoginRequest>).detail);
    window.addEventListener(LOGIN_REQUEST_EVENT, listener);
    if (standalone) {
      const mode = new URL(location.href).searchParams.get("mode");
      show({ mode: mode === "register" || mode === "forgot-password" || mode === "reset-password" ? mode : "sign-in" });
    }
    return () => { window.removeEventListener(LOGIN_REQUEST_EVENT, listener); root.unmount(); container.remove(); if (standalone) delete document.body.dataset.dshLogin; };
  }, "dsh-base: account login dialog");
}
