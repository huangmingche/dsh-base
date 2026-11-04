# Local account sign-in

A client plugin using the official DSH Button, Input and FishLogo. The official packages have no mountable local product account login page, so this is not a fork of an official page. The signed-in Account section remains an official plugin.

Registration is enabled only when the public, read-only `/api/auth-policy` explicitly returns `signUpEnabled: true`. While checking, closed, malformed or failed, the registration entry stays visible and disabled with an English or Chinese explanation. Existing users can still sign in. The browser never receives an administrator registration token. Post-login return URLs must remain on the same origin.

Validation: `node packages/client/dsh-base-client-auth-login/tests/registration-policy.test.ts` and `node packages/client/dsh-base-client-auth-login/tests/return-url.test.ts`.

The plugin declares `dshBase.client.documentRoutes: ["/login"]`. The official Loader starts only this document provider on that route, installing the exported official theme styles and icons. Private application RPC, WebSocket and control-state services never start there.

The public login document supplies the official default system preference and font sizes to the exported `ThemePresenter`, following system light/dark changes through its unchanged DOM contract. The background uses official `--dsw-alias-bg-base`, with no separate palette. Browser compatibility tests execute actual plugin apply and check both schemes and switching instead of mounting only the form component.
