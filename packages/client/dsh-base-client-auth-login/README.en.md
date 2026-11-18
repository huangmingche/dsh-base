# Account login dialog

One client plugin provides the in-app dialog and standalone public `/login` document. Sidebar, account, workspace and plugin actions call the exported `requestLogin()` intent. Opening the dialog grants no permission and reads no private data. Closing an in-app dialog preserves the page. Closing the standalone document returns to the localized public home, preventing a protected deep link from redirecting back to login. Successful authentication returns only to a validated same-origin destination. Protected actions are confirmed again by the user.

Official AccountSection and SignInDialog in `ui-settings-account` use Platform browser authorization. Models ApiKeyInput and SettingsSecretField manage provider credentials. Neither supplies the local Better Auth username/email/password contract. This plugin retains the local account flow and directly reuses official `Modal`, `Button`, `Input`, icons and the existing theme presenter through declared exports. The dialog uses the default official header, description, close control, mask, colors and dimensions; local CSS only arranges the flow and semantic messages. On 2026-11-17 the user retained the structure and flow but required official DSH visuals, superseding the previous ChatGPT appearance request. Metadata retains only the local account-flow deviation.

The official `Modal` body portal and `useModalLayer` own keyboard focus, Escape, backdrop dismissal and return focus, without another native `showModal()` layer or duplicate focus registration. Initial focus follows the `data-modal-autofocus` contract. Closing and disposal still cancel pending requests. Username/email proceeds to the password step. Registration uses the real backend and permits submission only after public `/api/auth-policy` explicitly reports `signUpEnabled: true`.

After the user's 2026-11-17 approval to continue the selected SaaS plugins, the flow adds forgotten-password requests, single-use-token reset, required verification/resend and configured Google authorization-code sign-in. New steps retain official Modal/Button/Input and all eight languages. Unavailable email/Google controls remain visible, disabled and explained; Apple and phone remain disabled. Reset tokens stay only in dialog memory and are removed from the URL immediately after capture, with cleanup on success/cancel. Callbacks are same-origin. Anonymous request copy is generic and does not reveal account existence.

`tests/email-flow.test.ts` checks policy and URLs. `tests/email-browser.test.mjs` covers disabled controls, recovery requests, password confirmation, token cleanup, verification/resend and Google's redirect allowlist in a local browser with request fixtures, without real email or Google traffic. Actual backend token/OAuth tests live in the Worker auth package.

At the user's request, the repeated unavailability paragraph below the social sign-in buttons is removed. Disabled states and localized button hints remain; Google availability still follows server policy.

Dialog copy covers all eight official languages. Checks: `pnpm check:client-adapters`, `pnpm acceptance:auth-modal-local`, `pnpm acceptance:anonymous-sidebar`. Standalone login still starts only its declared public plugin, with no private RPC, WebSocket or account configuration reads.

## Registration conversion consent

Registration requests attach only the mounted Analytics plugin’s explicit in-memory grant. The default sends no analytics grant and account details never imply consent. No browser conversion endpoint or third-party script is added; login dialog components and layout are unchanged.
