# Anonymous account entry (`@dsh-base/client-account-launcher`)

Renders the official-shaped “More” account menu in the `sidebar.settings` seat for **anonymous sessions**; once signed in, the official `AccountMenu` keeps the slot and only one entry renders.

## Official reuse decision

| Path | Result | Reason |
| --- | --- | --- |
| Mount the official account plugin unchanged | Does not provide an anonymous entry | The account menu and settings shell sit behind the private Host gates `account/watch` and `settings/describe`. Anonymous sessions lack that access; showing an entry must not weaken those permissions. |
| Render the official `AccountMenu` unchanged | Impossible | Its items are a hard-coded array; anonymous “Settings” would open an empty shell, and rerouting it to login would fake the entry. |
| Fork the official package | Required for full anonymous account content | The full account layout is inside AccountSection after its signed-out early return, with no exported presentation option. The complete marked `@dsh-base/client-settings-account` fork adds the approved Host presentation contract; this launcher composes its stable export and keeps the private Host gates. |
| **Minimal custom plugin + official components** | **Adopted** | Composes the anonymous menu, settings content and local sign-in region; interaction, a11y and styles reuse official components, while added identity copy is localized separately. |

## Reused surface

- Official `Menu` + `MenuItemButton` (`ui-primitives`): interaction, keyboard walk, `aria-disabled` description and tooltip.
- Official `AccountMenu.module.css`, imported through the package `exports` `./src/*` face (not copied): `.root/.trigger/.label/.anchor/.signedOutMenu`, including the 32px More row and the 36×36 collapsed state.
- Official icons `IconEllipsisOutlineMedium`, `IconSettingsOutlineMedium`, `IconPaperPlaneOutlineMedium`, `IconUserOutlineMedium`.
- Official `settings.account` dictionaries for eight locales (`more/settings/contactUs/signIn/menu`). A missing binding throws explicitly instead of shipping raw keys.
- Anonymous settings panel: reuses the already-exported official `SettingsPanel` from our marked fork `@dsh-base/client-settings-navigation` (800×800 two-column shell, mask, focus trap) and renders the twelve official General row components directly (`LanguageRow` / `AppearanceRow` / `FontSettingsGroup` / `PermissionRow` / `TranscriptViewRow` / `DeveloperToolsRow` / `ShortcutsRow` / `LinkOpeningRow` / `EnterBehaviorRow` / `PerformanceUsageRow` / `UploadRow` / `CurrentVersionRow`, all through the `./src/*` face), with official store factories and the official `bindSnapshotSelector` (`ui-renderer/src/client/bind.ts`); the five section labels come from the official `settings.account` / `settings` / `settings.models` / `settings.plugins` / `settings.agentPreset` dictionaries and each row from its own official namespace, with explicit failure when a binding is missing.

## Behavior

| Row | Anonymous state |
| --- | --- |
| Settings | Enabled; opens the anonymous settings panel (see “Anonymous settings panel” below) |
| Feedback | Disabled with the localized “Available after sign-in.” reason (eight locales; the upstream external form stays unlinked until legal review) |
| Sign in | The menu's local-account action calls shared `requestLogin()` to open the in-app dialog. Closing preserves the page; the successful return destination is same-origin validated. The official DeepSeek button on Account never calls local login. |

## State machine and yielding

- Registers into the official single slot `sidebar.settings` at `priority: 1` (shadow): the official or our settings shell keeps the default `priority: 0`, always registers safely and renders as the winner (lowest priority wins). When the shell appears, this registration is shadowed and then disposed through `slots.subscribe`; it re-registers when the shell leaves.
- Registers **only after the account view confirms signed-out**: `ctx.inject(['remote.account'])` reads `getState()/watch()` (the seam reads the public `GET /api/auth/get-session` endpoint, `null` for anonymous); only when the service never appears does it fall back to reading that public endpoint directly. It never touches `remoteAccess` and adds no access policy.
- Returns immediately on the `/login` document (same public-document guard as `auth-login`).

## Tests and acceptance

```bash
node --experimental-strip-types --test packages/client/dsh-base-client-account-launcher/tests/*.test.ts
pnpm --dir apps/web build
node apps/web/scripts/acceptance-account-launcher.mjs   # isolated instance: menu 8 locales × light/dark, panel 8 locales × light/dark, five sections × zh/en × light/dark, eight locale nav snapshots, hover/scroll evidence, signed-in regression
```

Regression scope includes return destinations, menu states, eight-locale account identity and unavailability copy, model declarations, explicit locale-binding failures and shadow registration. Account checks also cover the unchanged official branch, removal of the four old rows, separate local sign-in and zero anonymous private requests. Execution results are release-scoped; historical case counts are not reused.

## Boundaries

- The anonymous-shell gate (non-settings 401s and similar) is out of this package and tracked by P9.
- The feedback external form is upstream-owned and stays unlinked while anonymous; `reuse.gaps` records this.
- Long locales (de/ru/es/ja/pt) truncate the “Built-in plugins / Agent presets” section labels with the official single-line ellipsis; the truncation is an upstream localization issue and this package does not widen or wrap the nav.

## Anonymous settings panel (complete official form, 9 usable rows)

The Settings row reuses the **already-exported official `SettingsPanel`** from our marked fork `@dsh-base/client-settings-navigation` (800×800, `188px + minmax(0,1fr)` two-column grid, mask, focus trap, Escape) instead of a second shell. The panel gains only optional row fields `disabled` / `disabledReason` / `icon` (unset by default; the signed-in render path is unchanged and unit/acceptance tested).

- All five navigation sections stay visible and **switchable** (keyboard-selectable) in official order: Account −10 / General 0 / Models 10 / Plugins 15 / Agent presets 20. Labels come from the five official dictionaries; unavailable reasons move into the content area instead of greying the whole nav row.
- **Account**: The anonymous Account page uses a marked fork of the official account plugin to retain its complete account, balance, bonus, usage and top-up layout. It uses honest signed-out copy and disables Platform operations without fabricating identity, amounts or authorization. A separate Dsh-base account section below provides local sign-in. This user-approved anonymous presentation extension preserves default signed-in behavior and private-data permissions.
- The General column keeps all twelve official rows: **nine usable, one read-only (Current version from the selected app’s `package.json`), two disabled** (`permission` host policy, `session-log` needs an account upload), in official order.
- The nine usable rows are driven by official implementations:
  - **Language / appearance / font**: official `LanguageRow` / `AppearanceRow` / `FontSettingsGroup` plus official store factories; writes go through the anonymous local settings document.
  - **Work details**: official `TranscriptViewPolicy` (`ui-chat/src/client/transcript-view.ts`) over the same `ui-chat` config form the chat uses, so a change takes effect immediately.
  - **Developer tools**: official `configForms.developerTools.enabled` + `setEnabled()` (shared service preference).
  - **Shortcuts**: official `ctx.shortcuts` service plus the `shortcuts` store already registered in `shell.overlay` (opens the official reference dialog); bindings stay in the official localStorage `dsh.keybindings.v1` — no second key and no settings-document whitelist entry.
  - **Link opening**: the official `ui-chat` config form's `linkOpening` (local store first, best-effort form persistence, the same pattern as the official row).
  - **Busy send behavior**: official `ComposerSubmissionPolicy` over the `ui-conversation` config form (the same form the composer uses).
  - **Performance & usage**: official `PerformanceUsagePolicy` over the `ui-chat` config form.
- Note: the anonymous settings slot graph does not exist (the shell sits inside `whenAccess('settings/describe')`), so no registered official row instance is reachable; the four rows above use the Architect-approved route of official classes plus the official `configForms` service (same form, same persistence path), with no invented interaction or storage format.
- Disabled official rows use stub snapshots (never connected to the Host, every control disabled) and show official defaults; `reuse.gaps` records this.
- Writes use the anonymous local settings document whitelist `ui-chat` / `ui-conversation` / `ui-settings` (official schemas/defaults, no secrets, zero network); Escape closes the panel and returns focus to the More trigger.
- The panel registers no fake sections or rows into the official settings slots: all five sections and twelve rows come from this package's own row data.

### Models / Built-in plugins / Agent presets (read-only)

All three pages are read-only and draw only on the local declaration plus existing read-only seams; they never call `remote.settings` / `remote.llm` / `remote.credentials` / `remote.pluginManager`.

- **Models**: Anonymous Models settings reuse the existing official Models fork for provider cards, read-only forms and disclosure controls. Public models and form defaults share one declaration with the Host; credentials and Gateway account state remain unknown rather than being inferred as unconfigured. Add provider and the lower sign-in button request local authentication, while details remain browsable without private reads or model-discovery requests.
- **Built-in plugins**: mounts the official `PluginInventorySettingsTab` directly (`./src/*`, recorded in `sourceEntries`). Injected face: `list` uses the existing read-only `remote.pluginInventory` seam (local client Loader inventory plus the pinned Think declaration rows, zero network), preset names use the official `presetDisplayText`, `resolveText` uses `ctx.locale`. Anonymous pages run no Host client sync, so `hooks.clientSync` is an empty `{ syncing: false, failures: [] }` snapshot stub and `retryClient` is a no-op (R30). Title/intro come from the official `settings.plugins` dictionary, tab copy from `settings.pluginInventory`; there is no write control.
- **Agent presets**: mounts the official `AgentPresetSection` plus `AgentPresetSectionController` from our marked fork (new exports), with the roster from the local read-only `remote.agentPresets`: the four pinned official modes carry their localized `unavailable` reason (neutral card, “Unavailable” badge, reason text) and Cloudflare Think is the current default; the page lists the same **five** presets as the anonymous composer menu. “Use as default” is `aria-disabled` for the four official modes and natively `disabled` for the Think default, so no usable selection control exists; `makeDefault` is a defensive refusal that only writes the `selectUnavailable` reason into the store and never calls `remote.settings`. The Think row has no official Cordis declaration, so its “View configuration” action is disabled with a localized reason.
- Guard: the panel reads `ctx.slots.entries('settings.section')` / `('settings.general.item')` at render time into `data-anonymous-settings-sections` / `data-anonymous-settings-general-items`; acceptance asserts both are **0** (the anonymous page registers no settings slot entries).

### Local settings document boundaries

The write path is provided by `@dsh-base/client-session-adapter` (see its README, “Anonymous local settings document”); this package only consumes the official `ThemeRuntime` / `LocaleRuntime` reads and writes:

- Enabled only when the public `GET /api/auth/get-session` explicitly answers `null`; unknown or failed requests keep the original Host RPC path.
- Writes go to the localStorage key `dsh-base.anonymous-settings.v1` only: the whitelist is `ui-theme` / `locale` / `ui-chat` / `ui-conversation` / `ui-settings` (official schemas/defaults); other writes return `settings/namespace-unavailable`, and no secret, cookie or Host write is involved. Shortcut bindings stay in the official `dsh.keybindings.v1` key and are not part of this document.
- Validation uses only the official exported `ThemeSettingsSchema` / `LocaleSettingsSchema`; invalid values return `settings/invalid`, and corrupt or version-mismatched stored documents are discarded fail-closed.
- When localStorage is unavailable (private mode/quota) the document degrades to memory so the UI keeps working; those preferences are lost on reload, a recorded boundary.
- Signed-in zero reads/writes: the local document is constructed lazily and never built on a signed-in page (acceptance counts `Storage.prototype` calls: `reads=0 / writes=0`); signed-in sessions use the official settings shell and this package registers no entry.

Local Dsh-base sign-in and DeepSeek Platform authorization are separate identity contracts. Local sign-in neither establishes a DeepSeek identity nor grants a dedicated API key or billing capability, and anonymous private-data permissions remain unchanged. The complete account layout is supplied by a separate marked official account fork; this entry plugin copies no official source.
