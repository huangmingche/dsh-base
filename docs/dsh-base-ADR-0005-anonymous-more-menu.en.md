# ADR-0005: Anonymous "More" account menu

- Status: Accepted (B at 06:22, shell alignment at 12:40, D6 finalized at 13:57, P12 five open sections; see §13.2, §17, §18.7, §19)
- Date: 2026-11-14 (v7, see §15 revision history)
- Decision by: CEO (2026-11-14 06:10); architecture: Architect
- Related: PRD §7, P9 (anonymous-shell gating, separate card)
- Code baseline: `dsh-base` @ `4e635a2`; DSH pin `dsh-v0.2.2-rc.1` / `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`
- This document describes the design only; it contains no code change

## 1. Context

On staging, an anonymous visit to `/` returns 200 with the application shell: the sidebar shows only the brand, Workspaces and "No sessions yet". **There is no sign-in entry and no redirect to the login page.**

Root cause chain (verified line by line):

1. `/` is a public document per `PUBLIC_PAGES` in `packages/boot/dsh-base-public-pages/src/index.ts`, and the worker redirects only non-public HTML navigations with `302 /login?next=` (`packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/src/index.ts:182-198`). So `/` does not redirect.
2. On the anonymous shell, `loadControl()` reads `/api/plugin-manager`, gets 401, and degrades to an empty selection (`packages/boot/dsh-base-client-core/src/client/control.ts:82-92`).
3. `remoteAccess/follow` requires `invocation.user.id` (`packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/src/remote-access.ts:10-14`); anonymous calls are always rejected, so the client access answer stays false.
4. Every official account-UI registration is wrapped in `ctx.remoteAccess.whenAccess('account/watch', …)` (`.submodules/deepseek-harness/packages/client/ui-settings-account/src/client/index.ts:313,316,333,336`), so the entry is never registered.
5. One layer further out, the **entire settings shell** is gated as well. Our fork `dsh-base-client-settings-navigation` only registers `SettingsRoot` into `sidebar.settings` inside `whenAccess('settings/describe')` (`packages/client/dsh-base-client-settings-navigation/src/client/index.ts:193-194,218`); upstream behaves the same (the upstream test asserts that without settings access `sidebar.settings` stays empty, `ui-settings-general/tests/shell.client.spec.ts:91-93`). The anonymous sidebar footer therefore has **no settings area at all**, including the official gear fallback — that fallback lives inside `SettingsRoot`'s `settings.launcher` slot (`SettingsRoot.tsx:226`), so no shell means no gear.

Conclusion: what is missing is not a button but ownership of the anonymous sidebar footer. Granting owner access to anonymous sessions is a security veto, so the anonymous entry must be independent of `remoteAccess` and must live in a slot that does not depend on settings access.

## 2. Decision

Add one client plugin, `@dsh-base/client-account-launcher`, that renders an official-style "More" account menu in the **`sidebar.settings`** slot **for anonymous sessions only**:

- Slot changed to `sidebar.settings` (rendered unconditionally by `ui-sidebar`, owner props are only `{ wide }`). `settings.launcher` is no longer used — it does not exist in the anonymous state.
- Trigger: ellipsis icon plus official `t('more')`, structurally identical to the official signed-out state.
- Items: Settings (**enabled** → opens the anonymous settings panel, §16), Feedback (disabled, "Available after sign-in"), Sign in (enabled → `/login?next=…`).
- Implementation uses the official `Menu` with three official `MenuItemButton` children (not `Menu`'s `items` data rows; see §4.3).
- Registration uses `priority: 1`: the official/our-fork `SettingsRoot` keeps the default `priority: 0` and is always the winner; ours is a shadow that auto-promotes when the official entry disappears (semantics in §4.2).
- Register only after `signed-out` is confirmed; never register while signed in, so the official `AccountMenu` stands alone.
- No fork of the official package, no copied official source, no access-policy change, no `apps/` code change, no hand-written roster.

## 3. Reuse-path assessment (why neither mounting nor forking)

Following the AGENTS.md official-reuse protocol, all three paths hit hard blockers:

| Path | Verdict | Hard blocker (reproducible location) |
| --- | --- | --- |
| Mount official plugin `@deepseek-ai/dsh-client-ui-settings-account` unchanged | Not possible | The `settings.launcher` registration lives inside `whenAccess('account/watch')` (upstream `ui-settings-account/src/client/index.ts:333`), and the surrounding settings shell is itself gated by `settings/describe` (our fork `dsh-base-client-settings-navigation/src/client/index.ts:193-194`). Anonymous sessions have neither, so nothing registers. Relaxing either access answer is a security veto. |
| Mount the official `AccountMenu` component unchanged with an anonymous face | Not possible | Doubly impossible: (1) its rows are `items` data entries (upstream `AccountMenu.tsx:74-79`), while `disabledReason` (tooltip + `aria-describedby`) exists only on component rows — `MenuItem` has just `disabled` (`ui-primitives/src/Menu.tsx:20`), `MenuItemButtonProps` carries `disabledReason` (`:58-64`) — so the structure cannot express "greyed out + explained"; (2) the settings content it would open does not exist for anonymous sessions (§1 item 5), so forcing it open would be fake-usable. |
| Fork the official package | Not possible | `scripts/conformance/check-official-reuse.mjs:72`: an active client fork must record `dshBase.client.replaces` → the official account plugin row would be disabled and the signed-in UI lost; a verbatim copy would also be flagged as an unmarked exact official source copy by the same script (`43-48`). |
| **Minimal custom plugin reusing official components/styles/copy** | **Chosen** | The AGENTS condition "implement only after the official candidates fail" holds; the CEO signed off on this custom-UI deviation (§13). |

Scope of "minimal": only the trigger structure, the three menu rows and the navigation function are ours. Everything else is official:

- Menu container plus keyboard and focus traversal: official `Menu` (accepts component children, `Menu.tsx:224`).
- Unavailable-row semantics: official `MenuItemButton` `disabled` + `disabledReason` → `aria-disabled`, tooltip, hidden description (`Menu.tsx:58-64,96-123`).
- Icon: `IconEllipsisOutlineMedium` (`ui-primitives/src/icons/index.tsx:61`, re-exported by the `.` entry at `src/index.ts:129`).
- Styles: **import** the official `AccountMenu.module.css` (inside the package `exports` under `./src/*`); no copy. The official file already styles the signed-out row: a 32px More row, 36×36 when collapsed (`:6,:14` of that CSS).
- Copy: `ctx.locale.bind('settings.account')` reuses the official 8-locale dictionary (`more/settings/contactUs/signIn` at `ui-settings-account/src/client/locales.ts:17-19,32,53-55`). The official `apply()` registers that namespace unconditionally before any `whenAccess` guard (`index.ts:49-50`), so it exists as long as `client:account` is in the roster (currently true).
- The only new copy: the disabled reason "Available after sign-in", a meaning the official dictionary does not carry. It lives in this plugin's own 8-locale module and is recorded in `reuse.gaps`.

## 4. Architecture: package, slot, structure

### 4.1 Package

```
packages/client/dsh-base-client-account-launcher/
  package.json
  src/client/index.tsx              apply(): guard /login, confirm signed-out, register at priority 1
  src/client/AnonymousLauncher.tsx  official Menu + three MenuItemButton rows
  src/client/next-url.ts            buildLoginHref (pure function)
  src/client/locales.ts             eight disabled reasons + fallback labels
  tests/next-url.test.ts
  tests/items.test.ts
```

Required metadata:

- `name`: `@dsh-base/client-account-launcher`
- `exports`: `{".": "./src/client/index.tsx", "./client": "./src/client/index.tsx"}`
- `dsh.client`: `{ platform: "web", inject: ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-settings-account"] }`
- `dshBase.client`: `{ id: "client:account-launcher", origin: "custom", order: 73 }` (after `client:account` at 69, so the official namespace is registered first)
- `dshBase.reuse`: `mode: "custom"`;
  - `official`: `["@deepseek-ai/dsh-client-ui-settings-account", "@deepseek-ai/dsh-client-ui-primitives"]`
  - `sourceEntries`: `["@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountMenu.module.css"]`
  - `sourceReviewCommit`: `"66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db"`
  - `reason`: document the three failed paths (§3) and why the minimal custom plugin was chosen
  - `gaps`: disabled-reason copy is ours; the component structure is hand-written against upstream `AccountMenu.tsx` (not a fork), so pin upgrades need re-review
  - `userApprovedDeviations`: CEO sign-off on 2026-11-14 (§13)
- Register in `packs/base/pack.json` and the composition; the roster is generated, never hand-written.

### 4.2 Slot and single-slot conflict semantics

`sidebar.settings`:

- Declaration: `ui-sidebar/src/client/index.ts:91`, `{ kind: 'single', scope: 'root' }`.
- Render site: `SidebarRoot.tsx:432` — rendered **unconditionally**, inside `.settingsArea` (a full-width block container, `SidebarRoot.module.css:646-668`; in the collapsed rail it becomes `display:flex; justify-content:center; width:auto`). Runtime props are **only `{ wide }`**.
- Anonymous occupancy: **empty**. An upstream test asserts that without settings access `entries('sidebar.settings')` is empty (`ui-settings-general/tests/shell.client.spec.ts:91-93`); the live anonymous page has no settings gear, which confirms it.
- Signed-in occupancy: our fork's `SettingsRoot` (`dsh-base-client-settings-navigation/src/client/index.ts:193-194,218`), which declares `settings.launcher` and friends internally — that is where the official `AccountMenu` lives.

Single-slot conflict semantics (they decide whether we can coexist with the official entry):

- A second registration in the same `single` slot **at the same priority** throws: `single slot "…" already has a registration at priority 0` (`ui-slots/src/index.ts:1216-1222`).
- Different priorities shadow each other, and **the lowest priority renders** (`ui-slots/src/index.ts:775,1287`; "lowest renders").
- So we register at `priority: 1`: the official/`SettingsRoot` (default 0) is always the winner, ours is a shadow; once the official entry is gone, ours becomes the lowest live entry and auto-promotes. **We must not dispose ourselves when the official entry appears** — trusting the priority semantics is more robust than a state machine; disposing would require extra re-registration handling and leaves an empty window the moment access is revoked.

### 4.3 Component structure

Aligned with the signed-out trigger of upstream `AccountMenu.tsx:65`, with menu rows as component children (`Menu`'s `children`, `Menu.tsx:224`):

```tsx
<div className={css.root} data-inset={false}>
  <Menu
    side="top" portal autoFocus
    listClassName={css.signedOutMenu}
    anchor={
      <button type="button" className={css.trigger}
        data-collapsed={!wide} data-signed-out="true"
        aria-haspopup="menu" aria-expanded={open}
        aria-label={t('menu')}>
        <IconEllipsisOutlineMedium size={14} />
        {wide && <span className={css.label}>{t('more')}</span>}
      </button>
    }
    onClose={() => setOpen(false)}
  >
    <MenuItemButton icon={<IconSettingsOutlineMedium size={16} />}
      disabled disabledReason={copy.afterSignIn} onSelect={() => {}}>
      {t('settings')}
    </MenuItemButton>
    <MenuItemButton icon={<IconPaperPlaneOutlineMedium size={16} />}
      disabled disabledReason={copy.afterSignIn} onSelect={() => {}}>
      {t('contactUs')}
    </MenuItemButton>
    <MenuItemButton icon={<IconUserOutlineMedium size={16} />}
      onSelect={() => { setOpen(false); location.assign(buildLoginHref(...)) }}>
      {t('signIn')}
    </MenuItemButton>
  </Menu>
</div>
```

- Why not `items` data rows: `MenuItem` only has `disabled`; `disabledReason` exists solely on `MenuItemButtonProps` (`Menu.tsx:20` vs `:58-64`). Meeting the AGENTS requirement of "greyed out + localized reason + readable by assistive technology" requires component rows.
- Layout: `.settingsArea` is a full-width block container; the official `.root{flex:1}` is inert there but harmless, and `.trigger{width:100%}` keeps it full-width. The collapsed rail is handled by `.collapsed .settingsArea` centering plus the official `.trigger[data-collapsed='true']` 36×36 rule; both widths must be verified.
- Collapsed state: `data-collapsed={!wide}`.
- Keyboard and aria: fully owned by the official `Menu` / `MenuItemButton`; we add no `tabIndex` and no extra focusable wrapper.

## 5. State machine: signed-out confirmation, registration, shadow

### 5.1 Detection

- Source: after `ctx.inject(['remote.account'], …)`, call `remote.account.getState()` (the account view provided by our seam, which reads the public endpoint `GET /api/auth/get-session`; anonymous returns `null`).
- Continuous updates: consume `remote.account.watch` (already implemented in the seam: 2s polling, yields on change) with an `AbortController` bound to the effect lifetime.
- No raw `fetch`, no new endpoint.

### 5.2 Registration policy (first frame is fixed)

1. **Register only after `signed-out` is confirmed**; render nothing on the first frame.
   - Rationale: the anonymous sidebar footer is already empty (`SettingsRoot` and its fallback gear are not mounted, §4.2), so "one empty frame before the button appears" is not a visual regression; signed-in users never see our button at all.
   - Counter-example: registering on the first frame would make signed-in users see the anonymous menu before the official one replaces it — an unacceptable flash.
2. Read failure (exception/401/network error) → **fail closed**, do not register.
3. Registration uses `priority: 1`:
   - Different from the official/`SettingsRoot` default 0 → no `already has a registration at priority 0` throw;
   - The lowest priority renders (`ui-slots/src/index.ts:775,1287`) → invisible while the official entry exists;
   - Once the official entry is gone, ours becomes the lowest live entry → auto-promotion, no re-registration needed.
4. **Do not dispose on seeing a non-self entry**: that would break auto-promotion and leave an empty window when access is revoked. Hand-over is fully delegated to the priority semantics. `ctx.slots.subscribe('sidebar.settings', …)` is kept only for test assertions and diagnostics, never as the hand-over mechanism.
5. Return immediately on the `/login` document (same guard style as `dsh-base-client-auth-login`'s `apply()`).
6. **No `remoteAccess` writes and no access-policy change.**

### 5.3 Three states

| State | `sidebar.settings` occupancy | Visible at the sidebar bottom |
| --- | --- | --- |
| Anonymous (no session) | ours (priority 1, only live entry) | our "More" menu |
| Signed in | ours not registered; `SettingsRoot` (priority 0) | official `AccountMenu` (avatar + name) |
| Session expired (page already loaded) | after `SettingsRoot` withdraws, ours becomes the lowest live entry | official steps down, ours appears |

## 6. Menu behaviour

| Item | Anonymous state | Rationale |
| --- | --- | --- |
| Settings `t('settings')` | **enabled** → opens the anonymous settings panel (§16) | CEO ruled B on 06:22: anonymous settings must actually work. The panel carries only locally-effective items (language / appearance / font size and family); the seven account-only groups never appear |
| Feedback `t('contactUs')` | visible + `disabled` + `disabledReason` ("Available after sign-in") | CEO decision 2026-11-14 06:10: grey out for anonymous, do **not** reuse the upstream Feishu form (keeps users and device info away from a third-party form) |
| Sign in `t('signIn')` | enabled → `location.assign(buildLoginHref(...))` | the only primary path |

- Item order and icons follow the official component: Settings / Feedback / Sign in (`AccountMenu.tsx:74-79`).
- Disabled items must be accessible: `aria-disabled="true"` and an explanation readable by assistive technology (provided by the official `MenuItemButton` mechanism, `Menu.tsx:96-123`).
- A signed-in session must never show "Sign in", and an anonymous session must never show "Sign out"; this follows from "never register while signed in + single visible entry in the slot".

### 6.1 Disabled-reason copy (8 locales)

| locale | copy |
| --- | --- |
| en | Available after sign-in. |
| zh | 登录后可用。 |
| ja | サインイン後に利用できます。 |
| es | Disponible después de iniciar sesión. |
| fr | Disponible après connexion. |
| de | Nach der Anmeldung verfügbar. |
| ru | Доступно после входа. |
| pt | Disponível após iniciar sessão. |

Menu labels are not rewritten; they come from the official `settings.account` namespace.

## 7. `next` return rule

```
next = encodeURIComponent(location.pathname + location.search + location.hash)
href = `/login?next=${next}&locale=${ctx.locale.getSnapshot().active}`
```

- Language prefix preserved: `/zh-CN/app/session/abc?x=1#y` returns to the same address after sign-in.
- Query and hash preserved.
- The `locale` parameter renders the login page in the active language (`LoginSurface` in `dsh-base-client-auth-login` reads `?locale=`).
- Return safety already exists: `loginReturnPath()` keeps only pathname+search+hash and falls back to `/` for a foreign origin (`dsh-base-client-auth-login/src/client/return-url.ts:2-11`).
- Sign-in finishes with a full-page `location.assign`, so the return is an owner boot; no SPA state sync is needed.

## 8. Copy, theme, visual consistency

- Locales: labels come from the official 8-locale namespace; only the disabled reason is ours (§6.1). A failed bind must fail loudly rather than degrade silently, or half-translated copy ships (unit test asserts all 8 locales resolve `more/settings/contactUs/signIn`).
- Theme: all colours come from the official CSS module tokens `--dsw-alias-*` / `--dsh-sidebar-*`, so light and dark follow automatically; the menu card uses the official `.signedOutMenu` and brings no colour of its own.
- Visual verification avoids automatic pixel diffing (environment differences cause false positives). Use DOM assertions plus human screenshot review:
  - DOM: `data-signed-out="true"`, `aria-haspopup="menu"`, collapsed `data-collapsed="true"`, menu card carrying the official `.signedOutMenu` class, disabled items with `aria-disabled="true"` and an explanation.
  - Screenshots: 8 anonymous locales × light/dark = 16; two collapsed states (zh/en); two signed-in regression shots.

## 9. Test and acceptance plan

| Layer | Content | Required negative cases |
| --- | --- | --- |
| Unit (node) | `buildLoginHref`: language prefix / query / hash / deep link / pre-encoded characters; row states: enabled/disabled/disabledReason per item | foreign-origin `next` falls back to `/`; empty pathname |
| Component stub (same style as `apps/web/tests/parity/*-fixture.tsx`) | stubbed slots + stubbed `remote.account`; anonymous renders "More", clicking sign-in navigates exactly once, disabled rows expose `aria-disabled` with a description | signed-in → does not register; registration priority = 1; coexisting with a priority-0 entry does not throw |
| Slot-semantics test | official (0) + ours (1) on the same `sidebar.settings`: exactly one visible entry, `entries()` has two but only the official renders; after the official disposes, ours promotes | same-priority registration must throw (proves we did not collide) |
| Isolated instance (miniflare) | anonymous `/` and `/zh-CN/`: footer trigger present, three items, sign-in lands on `/login?next=…&locale=…`, returns to the original address after sign-in | signed-in: official avatar menu, global `[aria-haspopup="menu"]` count = 1; session expired: official steps down, ours appears, never both |
| Staging regression | the three cases above + 8 locales + light/dark + collapsed screenshots | anonymous shows no "Sign out"; signed-in shows no "Sign in"; clicking a disabled item triggers no navigation and no request |

Gate commands: `pnpm check:reuse`, `pnpm check:boundaries`, `pnpm check:packs` must all pass.

## 10. Effort and risks

Deliverables (Coder):

1. **0.5 round** — technical validation: cross-package import of the official `AccountMenu.module.css` (do CSS Modules scopes match), `Menu` + `MenuItemButton` rows inside the official keyboard walk, and 0/1 double-priority coexistence plus promotion on `sidebar.settings` (both collapsed and expanded widths). If this step fails, change approach before building further.
2. **1 round** — new package + metadata + `packs/base` and composition registration + signed-out confirmation / priority registration / navigation / 8 locales.
3. **0.5–1 round** — three test layers + screenshot baselines + bilingual docs (README zh/en, `docs/official-differences*.md`, `docs/typed-remote-mapping.md`).

Total 2–2.5 rounds; QA 0.5 round; Designer 0.2 round (screenshot-baseline review only).

| Risk | Description | Mitigation |
| --- | --- | --- |
| R1 cross-package CSS-module import fails | the only real technical risk | validate in deliverable 1; fallback is a re-derived own CSS module (not verbatim, recorded in gaps) with human visual comparison |
| R2 official locale namespace unavailable | account plugin disabled or renamed | fallback: own 8-locale labels, recorded as duplicated copy |
| R3 two-entry window | the instant access is revoked, `entries('sidebar.settings')` may briefly hold two entries (official + our shadow); some consumers may iterate `entries()` instead of taking the winner | rendering uniqueness is guaranteed by single/priority; acceptance adds regressions for iterating consumers (settings shortcut, navigation ledger); the window must not produce duplicate navigation |
| R4 structure drift on pin upgrade | upstream `AccountMenu` / `SidebarRoot` changes | `sourceReviewCommit` + screenshot baselines; re-check slot name, props and CSS class names on every upgrade |
| R5 anonymous shell still interactive | entry provided, gating not | scope is fixed: no gating in this card, tracked as P9 |
| R6 collapsed-state visual | narrow sidebar 36×36, `.settingsArea` switches to flex centering | acceptance must cover `wide=false` |
| R7 anonymous-panel write path | official theme/locale/font settings all persist through the host settings document, so anonymous writes would 401 | carried by the local settings document in §16.3; §16.8 R8–R13 lists the companion risks |

## 11. Security ruling

**No Security review needed**, provided this ADR is followed exactly: no `remoteAccess` changes, no widened owner endpoints, no new public endpoints, no fabricated access.

Hard rule: if the anonymous branch ever needs an access-policy change (relaxing `whenAccess`, issuing an owner baseline to anonymous, widening `settings/describe`, adding a public read endpoint), **stop and route to Security review**; do not widen anything "along the way" during implementation.

## 12. Implementation checklist for Coder

1. Create `packages/client/dsh-base-client-account-launcher` and fill `package.json` per §4.1, including `dshBase.reuse` and `userApprovedDeviations`.
2. Implement `next-url.ts` as a pure function and write its unit tests first (including the foreign-origin fallback).
3. Implement `locales.ts` (the eight entries in §6.1) and assert that the official namespace resolves in all 8 locales.
4. Implement `AnonymousLauncher.tsx`: official `Menu` **+ three `MenuItemButton` children** (not `items` data rows) + official CSS module + official icon/labels; disabled rows go through `disabled`/`disabledReason`.
5. Implement `index.tsx`: `/login` guard → `ctx.inject(['remote.account'])` → after confirming `signed-out`, register into `sidebar.settings` with **`priority: 1`**; fail closed on read errors; do **not** dispose on non-self entries; render nothing on the first frame.
6. Append the `packs/base/pack.json` row, run the generator, never hand-edit the roster.
7. Add `apps/web/tests/parity/account-launcher-fixture.tsx` and the three-state acceptance cases, including launcher-count, priority and promotion assertions.
8. Sync bilingual README plus `docs/official-differences*.md` and `docs/typed-remote-mapping.md`.
9. Implement the §16 anonymous settings panel: local settings document (`local-settings-document.ts` plus mode detection in `settings-remote.ts`) → official `Modal` + three official row components → wire the Settings item.
10. Keep the local document's allowlist to `ui-theme` and `locale` only; validate with the official schemas before writing; store no secrets.
11. Add the eight acceptance cases in §16.7 (including zero `settings/*` requests and zero console errors).
12. All gates green: `check:reuse`, `check:boundaries`, `check:packs`.

## 13. CEO decisions

### 13.1 Decided (2026-11-14 06:10)

1. **Do option C**: replicate the official DSH signed-out "More" account menu, pointing at our own `/login` with a `next` return.
2. **Feedback is greyed out for anonymous sessions**; do not reuse the upstream Feishu form (8-locale copy in §6.1).
3. **Anonymous-shell gating is a separate card (P9)**: this ADR provides the entry only and does not solve "an anonymous user can still interact with the shell while APIs answer 401".

### 13.2 Decided: option B for the Settings item (2026-11-14 06:22)

The CEO reversed the earlier call: **Settings is not greyed, does not route to sign-in, and must genuinely work for anonymous sessions**. It is implemented as an anonymous settings panel backed by a local settings document; the design is §16.

| Option | Approach | Verdict |
| --- | --- | --- |
| A | Grant anonymous access to `settings/describe` | **void**: anonymous would read owner configuration — a security red line |
| B | Anonymous-only settings panel with locally-effective items only | **adopted**: CEO ruling, 2026-11-14 06:22 |
| C | Grey out + "Available after sign-in" | **void**: the v2 baseline, replaced by B |
| D | Keep it clickable but route to `/login` | not adopted: does not satisfy "genuinely usable for anonymous" |

**Relationship to the PRD**: PRD §7 was rewritten to match. Where the ADR and that ruling disagree, the Settings item follows B; every other item still follows this ADR.

## 14. References (code locations)

| Purpose | Location |
| --- | --- |
| `sidebar.settings` slot declaration | `.submodules/deepseek-harness/packages/client/ui-sidebar/src/client/index.ts:91` |
| `sidebar.settings` render site and layout | same package `src/client/SidebarRoot.tsx:432`, `SidebarRoot.module.css:646-668` |
| Anonymous slot stays empty (upstream test) | same package `ui-settings-general/tests/shell.client.spec.ts:91-93` |
| Our fork's registration and gate | `packages/client/dsh-base-client-settings-navigation/src/client/index.ts:193-194,218` |
| Single-slot conflict and priority semantics | `.submodules/deepseek-harness/packages/client/ui-slots/src/index.ts:775,1216-1222,1287` |
| Official account plugin and slot gating | `ui-settings-account/src/client/index.ts:49-50,313,316,333,336` |
| Official menu component (structural baseline) | same package `src/client/AccountMenu.tsx:56,65,74-79,85` |
| Official menu styles (imported, not copied) | same package `src/client/AccountMenu.module.css:6,14,17,23` |
| Official 8-locale dictionary | same package `src/client/locales.ts:17-19,32,53-55` |
| `Menu` data rows vs component rows | `ui-primitives/src/Menu.tsx:20,58-64,96-123,224` |
| Icon export | same package `src/icons/index.tsx:61`, `src/index.ts:129` |
| Account-view seam | `packages/client/dsh-base-client-session-adapter/src/client/index.ts:546-563`, `src/client/account-transport.ts` |
| Anonymous access rejection | `packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/src/remote-access.ts:10-14` |
| Public-document policy | `packages/boot/dsh-base-public-pages/src/index.ts` (`PUBLIC_PAGES`) |
| Login redirect and return | `packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/src/index.ts:182-198`, `packages/client/dsh-base-client-auth-login/src/client/return-url.ts:2-11` |
| Reuse validation rules | `scripts/conformance/check-official-reuse.mjs:43-48,72` |
| Official theme service host binding and write path | `.submodules/deepseek-harness/packages/client/ui-theme/src/client/index.ts:300-334,596-643` |
| Official locale service host binding and write path | same checkout `packages/client/locale/src/client/index.ts:256-262,581-587` |
| configForms write chain and recovery | same checkout `packages/client/ui-settings/src/client/config-form.ts:145-162,250-300` |
| Settings wire shapes | same checkout `packages/settings/settings/src/types.ts:22-44,57-64` |
| Official schemas (never hand-written) | same checkout `packages/client/ui-theme/src/theme-settings.ts` (`ThemeSettingsSchema`), `packages/client/locale/src/locale-settings.ts:35` (`LocaleSettingsSchema`) |
| Official row component contracts | `ui-theme/src/client/AppearanceRow.tsx:22-31`, `FontSettingsGroup.tsx:20-28`, `locale/src/client/LanguageRow.tsx:17-25` |
| Existing 401 today (prefixed boot) | `packages/client/dsh-base-client-locale-url/src/client/address.ts:42-45` |

## 15. Revision history

| Version | Date | Change |
| --- | --- | --- |
| v1 | 2026-11-14 | First version: `settings.launcher` + `Menu` `items` data rows |
| v2 | 2026-11-14 | Slot corrected to `sidebar.settings` (`settings.launcher` does not exist for anonymous, §4.2); switched to `Menu` + `MenuItemButton` children (`disabledReason` only exists on component rows, not `items` data rows); registration changed to the `priority: 1` shadow strategy (same priority throws, lowest priority renders); first-frame policy fixed to "register only after signed-out is confirmed"; Settings item marked pending the CEO ruling (§13.2) |
| v3 | 2026-11-14 | Settings item re-ruled as B (§13.2, §16): enabled, opening an anonymous settings panel; A void, C (greying) void; new §16 design (local settings document + official row reuse + font-size/family feasibility ruling + acceptance and risks); effort updated to 3.5–4 rounds |
| v4 | 2026-11-14 | CEO 12:40 added "align the anonymous panel with the official shell": new §17 (reuse the official `SettingsPanel` inside our fork, five-section navigation, four treatments for the twelve General rows, reason copy, acceptance, 5.5–6 rounds, R14–R19); §16.4 now defers its shell to §17 |
| v5 | 2026-11-14 | CEO 13:57 added D6: new §18 (six pure client-preference items / eight visible rows become usable, disabled drops to 2, local-document allowlist extension, acceptance and R20–R26); §17.3/§17.6 now defer counts to §18; measurements and final effort pending Coder's report |
| v6 | 2026-11-14 | Recorded Coder's D6 feasibility report and finalized the route (§18.7): anonymous slot entries = 0 → "official row components + stores built from official classes + official configForms"; allowlist `ui-chat`/`ui-conversation`/`ui-settings`; `LinkOpeningRow` measured to render, R22 resolved; classification persistence finalized, 2 disabled rows; D6 adds 1.5 rounds, P8 about 7 rounds |
| v7 | 2026-11-14 | CEO ruled "all five sections must open": new §19 (P12) — shell section routing, per-section content contracts (official signed-out account card plus greyed rows, local read-only model declaration, official read-only plugin tab, official preset section), reuse-path table, security boundaries, acceptance, 3.5–4.5 rounds and R27–R33; §17.2 now defers section state to §19 |

## 16. Anonymous settings panel (option B, CEO 2026-11-14 06:22)

### 16.1 Conclusion

The anonymous Settings item is **enabled** and opens an anonymous settings panel. The panel carries exactly three locally-effective groups: language (8 locales), appearance (light / dark / follow system), and font size and family. **Font size and family were verified to work locally, so they ship** (§16.5).

Two layers:

- **Write path**: a new **local settings document** inside the settings seam. Official `ConfigForms` / `ThemeRuntime` / `LocaleRuntime` stay untouched and read/write land locally; when signed in the existing host RPC passes straight through.
- **Panel**: an official `Modal` rendering the official `LanguageRow` / `AppearanceRow` / `FontSettingsGroup` directly, fed by the official store factories and the official 8-locale namespaces.

### 16.2 Why the official services cannot write here

Verified in source: all three groups persist through the **host settings document**.

- Theme / font size / font family: `ui-theme` builds `ThemeRuntime` from `ctx.configForms.get<ThemeSettings>(THEME_SETTINGS_NAMESPACE)` (`ui-theme/src/client/index.ts:596-600`); `setTheme` / `setFontSize` / `setFontFamily` update memory and the snapshot first, then `this.write(() => this.host.mutate(...))` (`:300-320` of the same file).
- Language: the `locale` plugin builds `LocaleRuntime` from `ctx.configForms.get<LocaleSettings>(LOCALE_SETTINGS_NAMESPACE)` (`locale/src/client/index.ts:581-582`); `setLocale` updates memory and then `void this.host?.set(...)` (`:256-262`).
- The write chain is `ConfigFormController.mutate` → `ctx.remote.settings.mutate` (`ui-settings/src/client/config-form.ts:145-162`); on failure it also `recover()`s → `mirror.load()` → `settings/describe`, so one interaction can mean **several** round trips.
- For an anonymous session that chain always answers 401 (`/api/session-host` requires a session). Worse, `ThemeRuntime.write` is `void operation().finally(...)` and `LocaleRuntime` is `void host?.set(...)`, so a rejection becomes an unhandled rejection → console error. PRD §7 item 8 ("no host writes / no 401 / no console errors") would fail outright.

**Pre-existing problem found on the way**: on an anonymous visit to a prefixed address such as `/zh-CN/`, `synchronizeLocaleAddress` calls `locale.setLocale(initial.locale)` at boot (`packages/client/dsh-base-client-locale-url/src/client/address.ts:42-45`), which by the chain above issues a `settings/mutate` → 401. The local document in option B removes it; deliverable 1 reproduces it first with the network panel (treated as "happens" until then).

### 16.3 The local settings document (write path)

Location: `packages/client/dsh-base-client-session-adapter/src/client/local-settings-document.ts`, enabled by `settings-remote.ts` when the session is **confirmed anonymous**.

- Mode decision: reuse the account seam's `get-session` truth (`account-transport.ts`). Only an explicit `null` enables local mode; a failed/unknown read does **not** (it keeps the RPC path — failing is better than writing local state for a signed-in user).
- `describe`: no network request; returns `{ writable: true, hasDocument: false, namespaces: [themeView, localeView] }`.
  - `schema` comes from the official exported schemas, serialized: `ThemeSettingsSchema.toJSON()` (`ui-theme/src/theme-settings.ts`) and `LocaleSettingsSchema.toJSON()` (`locale/src/locale-settings.ts:35`). **No hand-written schema.**
  - Shape follows the official wire contract (`packages/settings/settings/src/types.ts:22-44,57-64`): `autoGenerate / ns / schema / value / base / user / applies / secrets / revision`.
- `mutate` / `update` / `replace`: accept only the allowlisted namespaces `ui-theme` and `locale`; validate with the official schema, write to localStorage (key `dsh-base.anonymous-settings.v1`), bump the revision and return an accepted view; every other namespace is refused.
- Signed in: the existing `settings/*` RPC path, unchanged.
- Effect: every read and write of `ThemeRuntime` / `LocaleRuntime` / `ConfigForms` lands in the local document —
  - theme / font size / font family: `adopt()` restores the local section at boot (`ui-theme/src/client/index.ts:322-334`);
  - language: `locale.preference` persists locally, so a bare address keeps it too; a prefixed address still wins.
- **No** new public endpoint, no Worker auth change, no `remoteAccess` change; the local document holds only the two preference namespaces and no secrets.

### 16.4 Panel UI

> **From v4 the panel shell follows §17**: it is no longer assembled from `Modal` but reuses the official `SettingsPanel` inside our own fork (800×800 two-column shell, 5-section nav, 12 rows). The rest of this section still governs the row components and copy.

- Container: the official `SettingsPanel` (see §17.1); the row components below render directly.
- Three official row components rendered directly (imported through `./src/*`, recorded in `sourceEntries`):
  - `LanguageRow` (`locale/src/client/LanguageRow.tsx`): the 8-locale selector;
  - `AppearanceRow` (`ui-theme/src/client/AppearanceRow.tsx`): the light / dark / system cubes;
  - `FontSettingsGroup` (`ui-theme/src/client/FontSettingsGroup.tsx`): font sizes plus families (text / code / terminal).
- Props match the official registration: `PropsRuntime<'settings.general.item'>` (a marker-only owner share, `ui-settings/src/client/contract/slots.ts:100-106`) + `PropsStore<official store>` + `PropsLocale<'settings.locale' | 'settings.theme'>` + the injected face.
  - The injected face calls the official services: `locale.setLocale(id)`, `theme.setTheme(id)`, `theme.setFontSize(role, px)`, `theme.setFontFamily(role, value)`.
  - Stores come from the official factories: `createLanguageRowStore()` / `createAppearanceRowStore()` / `createFontRowStore()`, fed with the official `sync(...)` semantics (`ui-theme/src/client/settings-store.ts:24-70`).
  - Spike needed: how to obtain `PropsStore.useStore` outside the slot system. The official store instances already expose `getSnapshot/subscribe`, so wrapping them in `useSyncExternalStore` is the fallback; `dsh-base-client-settings` already renders an official row component against a self-built store.
- CSS: the rows ship their own official module CSS; the panel container only adds spacing and does not reuse the official shell's navigation/groups (every entry there is account-only).
- 8 locales: labels come from the official `settings.locale` / `settings.theme` namespaces — both plugins register them unconditionally outside `whenAccess` (`locale/src/client/index.ts:586-587`, `ui-theme/src/client/index.ts:598`), so no new copy is written.
- Keyboard/focus: the official `Modal` focus trap plus the row controls; Esc closes and focus returns to the Settings item.

### 16.5 Font size / family feasibility ruling

**Works locally, ship it.** `setFontSize` / `setFontFamily` only mutate `ThemeRuntime`'s in-memory snapshot and `publish()`, which `installThemeStyles` turns into CSS variables; no Host capability is involved. Ranges come from the official `FONT_SIZE_SPECS` (text / code / terminal each with min/max/default); families are free-form input and an empty value restores the built-in stack.
The one prerequisite is the §16.3 local document; without it every font-size change fires a host write.

### 16.6 Panel scope

The panel shows only language, appearance and font size/family. These seven account-only groups **never appear**, and no fake entry is built: models, plugins, account, web search, subagent, session log, agent loop. When signed in the panel does not exist (the launcher does not register) and the official `SettingsRoot` takes over.

### 16.7 Acceptance (aligned with PRD §7)

1. Anonymous → Settings opens the panel; only the three groups exist; the seven account-only groups are **absent from the DOM** (not hidden).
2. Language: switching across 8 locales changes the URL prefix, survives a reload (language and address), and the first paint has the right `lang`/copy.
3. Theme: light / dark / system all apply and survive a reload; "system" follows OS changes.
4. Font size/family: adjustable within the official ranges and survives a reload.
5. Network: **zero** `settings/*` requests from any panel action, zero 401/403, zero console errors / pageerrors.
6. Signed-in is unchanged: the official settings panel behaves as before; `[aria-haspopup="menu"]` count = 1.
7. Screenshots: panel 8 locales × light/dark = 16; menu 16 + 2 collapsed + 2 signed-in regression.
8. `check:reuse`, `check:boundaries`, `check:packs` all green.

### 16.8 Risks

| Risk | Description | Mitigation |
| --- | --- | --- |
| R8 local-document schema drift | an official schema change breaks `decode` and preferences stop restoring | only the official exported schema objects, never a hand-written one; a pin upgrade shows up at compile time or in acceptance |
| R9 direct-render prop binding | obtaining `PropsStore.useStore` outside the slot system | spike in deliverable 1; fallback `useSyncExternalStore` over the store instance; last resort a primitives-based row with a recorded deviation |
| R10 anonymous/signed-in misjudgement | a signed-in user judged anonymous → settings write to local storage while the host never updates | enable local mode only on an explicit `null`; unknown always uses RPC; a session appearing triggers a full reload |
| R11 local-document scope creep | storing a non-allowlisted namespace or a secret | allowlist `ui-theme` / `locale` only; refuse everything else; unit tests; no secrets ever |
| R12 localStorage unavailable | private mode / quota | degrade to memory without throwing; covered by acceptance |
| R13 existing 401 (prefixed boot) | end of §16.2 | removed by the same local document; reproduce first in deliverable 1 |

### 16.9 Effort

- Deliverable 1 (0.5 round): spike (local-document schema round trip, direct rendering of official rows, zero network) plus reproducing the existing 401.
- Deliverable 2 (1.5 rounds): the local settings document (describe/mutate/update/replace + allowlist + validation + persistence + mode decision).
- Deliverable 3 (1 round): the panel UI, wiring the Settings item, 8 locales/theme, direct rendering of the official rows.
- Deliverable 4 (0.5–1 round): tests, 16 panel screenshots, bilingual docs, `official-differences` registration.

Total **3.5–4 rounds** (Coder), QA 0.5–1 round, Designer 0.2 round. That is roughly 1–1.5 rounds more than the PRD's note ("B costs ~1.5 rounds more than A"); the difference is the local settings document, which is the unavoidable cost of the PRD's "no host writes / no 401" requirement against the official implementation. Dropping it leaves only "accept the 401s", which is not viable.


## 17. Anonymous settings panel aligned with the official shell (CEO 2026-11-14 12:40)

### 17.1 Shell: reuse the official `SettingsPanel` inside our own fork, no second shell

**Decision**: export the existing `SettingsPanel` (an internal component at `dsh-base-client-settings-navigation/src/client/SettingsRoot.tsx:57`) and add two optional fields (`rows[].disabled` / `rows[].disabledReason`); the anonymous panel reuses it together with the official `SettingsRoot.module.css`. Geometry, two columns, mask, focus trap, `role="dialog"`/`aria-modal` are all official: `.panel` is 800×800 with `grid-template-columns: 188px minmax(0,1fr)` and `height: min(800px, calc(100vh - …))` (`SettingsRoot.module.css:84-106`).

The AGENTS reuse protocol, path by path:

| Path | Verdict | Reason |
| --- | --- | --- |
| Mount the official `SettingsRoot` unchanged | Not possible | It is the `sidebar.settings` occupant (sidebar trigger + panel + five child-slot declarations) and depends entirely on registrations into `settings.section` / `settings.general.item` / `settings.section.icon`. Without settings access none of those registrations happen for anonymous sessions; driving it would mean rebuilding the whole settings plugin graph anonymously (5 sections + 12 rows + icon slots), and it is bound to the sidebar trigger rather than being a dialog component. |
| Fork the official package | Not applicable (already forked) | `dsh-base-client-settings-navigation` already is a fork of `@deepseek-ai/dsh-client-ui-settings-general` (recorded in `dshBase.forkOf`). A second fork would mean two shells and two drift surfaces; adding optional capability to the existing fork is the cheapest, lowest-drift option. |
| Build an entirely custom shell | Unnecessary | The 800×800/188px geometry, mask, focus and keyboard behaviour already live in the official CSS and `useModalLayer`; a custom shell would duplicate them and drift visually. |
| **Reuse the fork's internal panel component** | **Chosen** | Smallest reuse surface: two optional row fields (off by default, signed-in rendering unchanged), with geometry and interaction 100% official. |

### 17.2 Navigation: all five sections visible

> **From §19 (P12) the four account-only sections become "clickable, read-only/disabled inside" instead of whole-row disabled.** This section keeps the v4 presentation requirements (order, icons, official labels); section state follows §19.

- Order matches the official registrations: account −10, general 0, models 10, plugins 15, agent presets 20 (`ui-settings-account/src/client/index.ts:341`, `ui-settings-general/src/client/index.ts:251`, `ui-settings-models/src/client/index.ts:138`, `ui-settings-plugins/src/client/index.ts:78`, `ui-agent-preset/src/client/index.ts:285`).
- Labels come from the official namespaces (all five are registered unconditionally at the top of each `apply`, in 8 locales):

| Section | Namespace | Registration |
| --- | --- | --- |
| Account | `settings.account` | `ui-settings-account/src/client/index.ts:49` |
| General | `settings` | `ui-settings-general/src/client/index.ts:68,102` |
| Models | `settings.models` | `ui-settings-models/src/client/index.ts:45,83` |
| Plugins | `settings.plugins` | `ui-settings-plugins/src/client/index.ts:26,37` |
| Agent presets | `settings.agentPreset` | `ui-agent-preset/src/client/index.ts:131` |

- The four account-only sections: `aria-disabled="true"`, not activatable by pointer or keyboard, with the reason "Available after sign-in" (our own 8-locale copy, the same string as §6.1). General is selected by default and usable.
- Icons: officially they come from the `settings.section.icon` slot, which does not exist anonymously, so icons move into the panel row data (the same icon components, exported through `ui-primitives`), recorded in `reuse.gaps` for pin-upgrade review.
- Row height, type size and spacing stay with the official CSS (`.navCell` 40px, `.navLabel` 22px line height, 16px icons).

### 17.3 The twelve General rows

> **§18 (D6) is finalized; this section's classification and disabled count follow §18**: 2 disabled rows (permissions, session log), with 6 items becoming usable (route in §18.7).

In order: permissions −20, language 0, appearance 10, font size 11, transcript view 12, developer tools 15, shortcuts 16, link opening 17, composer enter 20, performance usage 30, session log 90, current version 100.

Four treatments:

| Class | Rows | Approach | Risk |
| --- | --- | --- | --- |
| A usable (official component + local settings document) | language, appearance, font size | As in §16.4: render the component directly with the official store backed by the local document | low |
| B official component + stub store (component has a native unavailable state) | session log | Official `UploadRow` plus `createSnapshotStore({status:'unavailable', writable:false})`, exactly the pattern `dsh-base-client-settings` already uses | low |
| C official component wrapped in `fieldset disabled` + reason | permissions, transcript view, developer tools, shortcuts, link opening, composer enter, performance usage (7 rows; the eighth disabled row is the session log under class B) | Render the official component and wrap it in `fieldset disabled` + `aria-disabled` + a localized reason line; precedent: `UnavailableBillingSection` in `dsh-base-client-account-availability` | if a component has non-form clickable areas, `fieldset` cannot block them — verify row by row, fall back to D |
| D official primitives replica (last resort) | only when B/C would render wrong data or crash | Official row styling + official labels + grey state + reason | visual drift, must be recorded |

**Current-version row (ruled 2026-11-14)**: `CurrentVersionRow` only needs `PropsRuntime` + `PropsLocale<'settings'>` (`ui-settings-general/src/client/CurrentVersionRow.tsx`) and reads no host data, so it can show the real version; greying it out contradicts "never fake, never hide available information". **Ruling: render it as a real read-only row, do not grey it, and do not count it among the disabled rows.**

### 17.4 Reason copy

One shared string, "Available after sign-in", in 8 locales (§6.1), used for both sections and rows; no second wording.

### 17.5 Boundaries

- Single entry: the launcher's Settings item; exactly one anonymous settings dialog exists.
- Close and focus: `SettingsPanel` already uses `useModalLayer(panel, true, onClose)` (`SettingsRoot.tsx:64`), so Esc/mask closing and the focus trap come from it; on close focus returns to the Settings item.
- Signed-in is unchanged: the new fields default to `false`; `SettingsRoot`'s existing render path and slot ledger stay untouched; a signed-in regression case is mandatory.
- **No** fake sections or rows are registered into official slots: the anonymous panel's data is our own row data and never touches the settings slots in `ctx.slots`.

### 17.6 Acceptance

> **Once §18 (D6) takes effect, the counts here follow §18.5** (disabled rows = 2). The text below is the v4 snapshot.

1. DOM: all five nav rows and all twelve General rows **exist**, in the official order; the four sections and **eight rows** (session log, permissions, transcript view, developer tools, shortcuts, link opening, composer enter, performance usage) carry `aria-disabled="true"` with a readable reason; language/appearance/font size really take effect; the current-version row is present and readable.
2. Keyboard: sensible Tab order, disabled items not activatable, Esc closes, focus returns to the trigger.
3. Network/storage: as §16.7-5 (zero `settings/*` requests, zero 401s, zero console errors).
4. Signed-in unchanged: the official settings panel and navigation behave exactly as before.
5. Screenshots: panel 8 locales × light/dark = 16 plus 2 nav screenshots; menu evidence as §16.7-7.

### 17.7 Effort and risks

- Deliverable A (0.5 round): export `SettingsPanel`, add `disabled/disabledReason`, signed-in regression.
- Deliverable B (0.5 round): five-section navigation, icons, disabled semantics, 8-locale reasons.
- Deliverable C (2 rounds): classify and adapt all twelve rows (3 usable + 1 read-only usable + 8 disabled, with per-row spikes).
- Deliverable D (1 round): DOM/keyboard/screenshot matrix, bilingual docs, `official-differences` registration.
- **P8 totals about 5.5–6 rounds** (Coder; §16's 3.5–4 plus this round's 1.5–2 alignment delta), QA 0.5–1 round, Designer 0.2 round.

| Risk | Description | Mitigation |
| --- | --- | --- |
| R14 official rows rendered outside their slot | prop/store binding may not match | per-row spike; fall back to D |
| R15 `fieldset` cannot block non-form interaction | components with div+onClick | verify per row; fall back to D |
| R16 icon source | `settings.section.icon` does not exist anonymously | icons move into row data, same official components; re-check on pin upgrades |
| R17 panel changes affect signed-in | shared component inside our fork | optional fields defaulting to false + signed-in regression |
| R18 components crash or render fake data without host data | some rows depend on host stores | any hit falls back to D; no fake data may ship |
| R19 current-version row contract | ruled read-only usable; greying it by mistake conflicts with acceptance | acceptance asserts: disabled rows = 8, the current-version row exists and is readable |


## 18. Pure client-side preference rows become usable (D6, CEO 2026-11-14 13:57)

### 18.1 Decision

Six pure client-side preference items (eight visible rows) stop being greyed out in the anonymous settings panel and become **genuinely usable**:

- `transcript-view` (work-step display, collapse timing, folded replies, code work view)
- `developer-tools`
- `shortcuts`
- `link-opening`
- `composer-enter`
- `performance-usage`

Still disabled (2 rows): `permission` (host permission policy) and `session-log` (requires account upload).
The current-version row keeps the read-only-useful ruling from §17.3.

### 18.2 Rationale

1. **That is the official semantics**: DSH decouples host permissions from the DeepSeek account — in the official product unauthenticated settings largely open, because these preferences are browser-side behaviour switches, not account capabilities.
2. **Our earlier line was an engineering line, not product semantics**: nine rows were greyed because the anonymous shell cannot reach the host settings document. With the §16.3 client-side local settings document, that engineering reason no longer applies to pure client preferences.
3. **No fake usability**: usable means actually effective locally and preserved across reloads, not a disabled control dressed up as enabled.
4. **Zero network**: every read and write stays in the local settings document or the official existing localStorage; no new requests, no `remoteAccess` change, no Worker auth change.

### 18.3 Classification (twelve rows, three states)

| Row | order | State | Official component / package | Data source (verified) | Persistence |
| --- | --- | --- | --- | --- | --- |
| Permissions | −20 | **disabled** | `ui-permission-presets` | host permission policy (owner) | — |
| Language | 0 | usable | `LanguageRow` / locale | local settings document | `locale` |
| Appearance | 10 | usable | `AppearanceRow` / ui-theme | local settings document | `ui-theme` |
| Font size | 11 | usable | `FontSettingsGroup` / ui-theme | local settings document | `ui-theme` |
| Transcript view | 12 | **becomes usable** | `TranscriptViewRow` / ui-chat | hooks: [`transcriptView`, `collapseTiming`, `foldedReplies`, code work view] (`SnapshotStore`) | `ui-chat` (stores built from official classes) |
| Developer tools | 15 | **becomes usable** | `DeveloperToolsRow` / ui-settings-general | `ctx.configForms.developerTools` (owned by ConfigForms) | `ui-settings` (schema is only `enabled: boolean`) |
| Shortcuts | 16 | **becomes usable** | `ShortcutsRow` / ui-shortcuts | `ctx.shortcuts` service (catalog/config/fixedCatalog) | official already uses localStorage `dsh.keybindings.v1` |
| Link opening | 17 | **becomes usable** | `LinkOpeningRow` / ui-chat | hooks: [`linkOpening`, `browserAvailable`] + setter; measured browser tab = true, so the row renders | `ui-chat` |
| Composer enter | 20 | **becomes usable** | `EnterBehaviorRow` / ui-conversation | hooks: [`busyEnter`] + setter (`submissionPolicy`) | `ui-conversation` (stores built from official classes) |
| Performance usage | 30 | **becomes usable** | `PerformanceUsageRow` / ui-chat | hooks: [`performanceUsage`] + `performancePolicy.setMode` | `ui-chat` (stores built from official classes) |
| Session log | 90 | **disabled** | `UploadRow` (stub store) | requires the account upload service | — |
| Current version | 100 | read-only usable | `CurrentVersionRow` / ui-settings-general | `t` only | — |

Verified namespaces: `CHAT_SETTINGS_NAMESPACE = 'ui-chat'` (`ui-chat/src/chat-settings.ts:6`), `DEVELOPER_TOOLS_NAMESPACE = 'ui-settings'` (`ui-settings/src/developer-tools-settings.ts:5`, schema carries only `enabled`), and shortcuts already persist on the web in localStorage `dsh.keybindings.v1` (`ui-shortcuts/src/client/locales.ts:60`).

### 18.4 Mechanism

1. **Official row components + stores built from official classes (corrected by Coder's measurement)**: in the anonymous state the `settings.section` / `settings.general.item` entry count is 0 — the settings shell's slot declarations live inside the `settings/describe` access gate, so even the declarations never register and the **instances the official plugins already registered are unreachable**. Instead: render the official row components and instantiate their stores from the official exported store factories / policy classes (imported through `./src/*`, recorded in `sourceEntries`), reading and writing through the official `configForms` service. Slot declarations are not moved and the access gate is not touched.
2. **Extend the local settings document allowlist**: add `ui-chat`, `ui-conversation` and `ui-settings` (confirmed by Coder's measurement), keeping the preset list, the official schema validation, and the no-secrets rule.
3. **Shortcuts need no allowlist entry**: the official plugin already writes localStorage, so reuse the same key and never invent a second one.
4. **Zero network**: the local document absorbs every write; signed-in keeps the host RPC path unchanged.

### 18.5 Acceptance

1. The six items are usable and **actually take effect, surviving a reload** (behaviour verification, not just UI state): transcript-view controls change the conversation display, developer tools toggle diagnostic views, shortcuts can be rebound and work, link opening applies, composer enter applies, performance usage applies.
2. The panel still shows twelve rows; **disabled rows = 2** (permissions, session log), both `aria-disabled` with a reason; the current-version row stays read-only usable.
3. Zero `settings/*` requests, zero 401/403, zero console errors / pageerrors; and no settings slot entry is registered (the anonymous `settings.section` / `settings.general.item` entry count stays 0, proving the fake-registration road was not taken).
4. Signed-in is unchanged: the official settings panel and the same items behave and persist exactly as before.
5. Screenshots: the 16 panel shots stay; add 2 expanded-state shots for the six items (zh/en).
6. No bleed across sign-in: anonymous local values are neither migrated nor written over the host; after sign-in the host values are read.

### 18.6 Risks and fallbacks

| Risk | Description | Fallback |
| --- | --- | --- |
| R20 allowlist surface | whether `ui-chat` / `ui-settings` / `ui-conversation` contain only pure client preferences | audit each schema field; account-bearing fields are not allowlisted and that row reverts to disabled, recorded |
| R21 anonymous local values share host namespaces | bleed or overwrite after sign-in | read host only, never write back local; sign-in does a full reload; acceptance item 6 locks it |
| R22 ~~`LinkOpeningRow` may render `null`~~ | **resolved**: Coder measured `sidebarRightTabs` browser tab = true, so the row renders normally | no fallback needed |
| R23 shortcut key mismatch | a second key would split reads/writes from the official editor | pin `dsh.keybindings.v1`; never reuse the value with a different key |
| R24 UI usable but behaviour not applied | some policies may have another host-side source | verify behaviour per row rather than UI state; revert to disabled when it does not apply |
| R25 ~~§17 counts must be synced~~ | **synced**: the §17.3 / §17.6 notes now say "2 disabled rows, follow §18"; PM syncs the PRD acceptance | no action needed |
| R26 larger allowlist privacy surface | the local document could hold non-preference data | keep the preset list and no secrets; Security stance unchanged (no access-policy change) |

### 18.7 Coder feasibility report and finalized route (returned; CEO ruled go)

**Key facts (Coder measurement)**

- In the anonymous state the `settings.section` / `settings.general.item` entry count is **0**: the settings shell's slot declarations live inside the `settings/describe` access gate, so anonymous sessions never even get the declarations — the **instances the official plugins registered are unreachable**.
- Service layer measured usable: `configForms` (`unavailable` / `writable:false`, writable once the allowlist admits it), `shortcuts` (config ready, catalog of 17), `sidebarRightTabs` (browser tab = true).
- Per item: `developer-tools` and `shortcuts` are directly drivable; the stores for `transcript-view` / `composer-enter` / `performance-usage` / `link-opening` must be built from official classes plus the official `configForms` service.
- Hence `LinkOpeningRow` renders normally (it only returns `null` when the browser is unregistered); **R22 is resolved**.

**Finalized route (CEO ruled go, 2026-11-14)**

1. All six items ship, no downgrades; **slot declarations are not moved and the access gate is not touched**.
2. Row components come from the official exports; stores come from the official exported store factories / policy classes (`./src/*`, recorded in `sourceEntries`) and read/write through the official `configForms`.
3. The local settings document allowlist extends to `ui-chat` / `ui-conversation` / `ui-settings`.
4. Shortcuts reuse the official localStorage `dsh.keybindings.v1`; no second key.
5. Disabled rows drop to 2 (`permission`, `session-log`); the panel still shows twelve rows; the current-version row stays read-only usable.
6. Effort: D6 adds **1.5 rounds** (the upper bound of 1–1.5), so **P8 totals about 7 rounds** (5.5–6 from §17 plus 1.5); the Coder schedule card is authoritative.

**Still to be proven at delivery (goes into Coder's evidence)**

- Every field of the `ui-chat` / `ui-conversation` namespaces is a pure client preference (R20).
- Anonymous local values do not bleed into same-named host namespaces after sign-in (R21).
- The six items take effect as **behaviour**, not just UI state (R24).


## 19. Anonymous settings panel: all five sections open (P12, CEO 2026-11-14)

### 19.1 Position and decision

The CEO ruled: **all five sections must open**; content is shown read-only where data exists, and whatever is unavailable is greyed out with an 8-locale reason; **byte-for-byte parity with the official shell is not required**. This supersedes §17.2's "four sections disabled as whole rows" and the earlier suggestion to hide the account section for anonymous sessions.

- The shell stays §17's `SettingsPanel` (the official panel inside our fork); the only addition is **section switching**: all five left-hand rows are clickable and focusable, and the right pane renders the selected section.
- The account section is neither hidden nor whole-row disabled: it opens with the official signed-out card plus our greyed rows (balance/subscription/usage/top-up) and reasons.
- New data access still uses only three things: **our own shell + the existing read-only seams + the anonymous local settings document**.

### 19.2 Shell and section routing

- Left nav: five rows (account −10 / general 0 / models 10 / plugins 15 / agent-presets 20), all `aria-disabled="false"` and keyboard-selectable; reasons move into the content pane.
- Right pane: `general` reuses §17's twelve rows; the other four render per §19.3.
- Focus/Esc/mask come from `SettingsPanel` (`useModalLayer`, `SettingsRoot.tsx:64`).
- Single entry (the launcher's Settings item), single instance.

### 19.3 Per-section content contract

#### 19.3.1 Account and balance

- **The official signed-out branch is reusable**: when `signedIn === false`, `AccountSection` returns early with `<section class="signedOut">` containing the title `t('settingsSignedOutTitle')`, the description `t('settingsSignedOutDescription')` and a primary `t('signIn')` button (`ui-settings-account/src/client/AccountSection.tsx:149-160`). We render that official component unchanged and supply only a signed-out account snapshot plus `start`.
- Sign-in button: `start` performs `location.assign(buildLoginHref(...))` (the §7 helper, carrying `next` and `locale`). It does not open the official SignInDialog, because our sign-in is our `/login`.
- Balance/subscription/usage/top-up: the official signed-out branch **does not render** these rows, so we add a small "unavailable" list using the official row styling (title + grey value), each with an 8-locale reason:
  - Balance: "Sign in to view your balance."
  - Subscription: "Sign in to view your subscription."
  - Usage: "Sign in to view usage."
  - Top-up: "Sign in to top up."
  This block is custom UI (the official state has no such region) and is recorded in `userApprovedDeviations`.
- No `account/watch` call and no `remote.account` write; the snapshot comes from our account seam's signed-out view.

#### 19.3.2 Models

**Recommendation: a read-only local declaration list, no new public endpoint.**

- Data: reuse `buildFallbackModelCatalog` (`packages/client/dsh-base-client-session-adapter/src/client/model-catalog-fallback.ts`), which already declares two providers × two models with `available:false` and explicit reasons (owner key not configured / gateway not enabled).
- Rendering: provider groups plus read-only, greyed model rows with a reason per row (the fallback's `unavailableReason`, localized into 8 locales).
- Why not a new public endpoint: model availability depends on the owner's BYOK key, so a public endpoint could only return a static list — the same semantics with an extra surface, caching and a security review. Revisit only if server-side real availability becomes a requirement (out of scope, §19.7).
- Cost: one read-only list page (official primitives plus model icons/typography), about 0.5 round.

#### 19.3.3 Built-in plugins

**Recommendation: render the official read-only inventory tab directly with our read-only seam.**

- This deployment currently has no `settings.plugins.tab` registrant because the slot is declared by the settings shell, which does not exist for anonymous — that is a missing declaration, not missing data.
- The official `PluginInventorySettingsTab` can be rendered directly (`ui-settings-plugin-inventory/src/client/index.ts:56-66`; its injected face is narrow: `list`, `presetName`, `resolveText`, `hooks.clientSync`, `retryClient`), with `list` backed by our existing read-only seam (`remote.pluginInventory.list()`, returning real client loader entries plus Think declaration rows).
- `hooks.clientSync` uses `ctx.modules.entries.state`; if `modules` is unavailable anonymously, supply an empty-snapshot stub, and make `retryClient` a no-op.
- Install/update/uninstall keep returning the explicit "unavailable" answer from the read-only seam; no enabled write button appears.
- Cost: 0.75–1 round (direct render + stubs + empty-state fallback).

#### 19.3.4 Agent presets

**Recommendation: read-only real list first, with "make default" greyed; extending the allowlist with `agentPreset` is a deferred option.**

- Data: `remote.agentPresets.list()/read()` is already our read-only seam (`fixed-agent-presets.ts:34-55`), returning the pinned declaration roster with real names.
- Rendering: render the official `AgentPresetSection` directly (spike needed: it needs `AgentPresetSectionInjected` with `load/view/closeView/hooks`; if its store factory is not exported, fall back to a primitives-based read-only list and record the deviation).
- "Make default" writes the settings namespace (`writeDefaultPreset`, `ui-agent-preset/src/client/settings-store.ts`): grey it out with a reason first; to make it truly usable, add `agentPreset` to the anonymous local document allowlist (+0.5 round, still zero network).
- Cost: 0.75–1 round (read-only); +0.5 round (writable default).

### 19.4 Reuse paths per section

| Section | Path | Official component | New fork? |
| --- | --- | --- | --- |
| General | §17 own shell + official rows rendered directly | `LanguageRow`/`AppearanceRow`/`FontSettingsGroup` etc. | No (shell reuses the existing fork's `SettingsPanel`) |
| Account | own shell + official `AccountSection` rendered directly + custom greyed block | `AccountSection.tsx` | No (the greyed block is custom, recorded) |
| Models | own shell + own read-only list on official primitives | no official read-only component to mount; no fork | No |
| Plugins | own shell + official `PluginInventorySettingsTab` rendered directly | `PluginInventorySettingsTab.tsx` | No |
| Agent presets | own shell + official `AgentPresetSection` rendered directly (primitives fallback) | `AgentPresetSection` | No |

- Anything imported through `./src/*` is recorded in `sourceEntries` with `sourceReviewCommit`; no new forks and no copied official source.
- "Mount the official plugin unchanged" remains impossible: all five sections register behind the `settings/describe` access gate (§17.1); that conclusion stands.

### 19.5 Security boundaries (unchanged red lines)

- Anonymous access is **not** granted to `settings/describe`, `account/watch`, or `pluginManager/listBundles`.
- Our own shell is **rendering, not authorization**: no section component may call an owner-only remote. Audit checklist (verified per page in deliverable 1): `remote.settings.*`, `remote.account.*`, `remote.pluginManager.*`, `remote.llm.*`, `remote.credentials.*` must never appear on the network for anonymous sessions.
- Read-only data sources are limited to: `remote.pluginInventory` (existing read-only seam), `remote.agentPresets` (existing read-only seam), the fallback model catalog (purely local), and the signed-out account snapshot (our seam).
- The local document keeps its existing allowlist (`locale`/`ui-theme`/`ui-chat`/`ui-conversation`/`ui-settings`, optionally `agentPreset`) and stores no secrets.

### 19.6 Acceptance

1. All five sections open and are keyboard-selectable; every page has at least one piece of **real content**: the account signed-out card, the 2×2 model declaration, plugin inventory rows, the pinned preset list, and the twelve general rows.
2. Unavailable items: visible + `aria-disabled="true"` + an 8-locale reason (four account items, each model row, the preset "make default").
3. Network assertions: no `settings/*`, `account/*`, `pluginManager/*`, `llm/*` or `credentials/*` requests from the whole panel; zero 401s; zero console errors / pageerrors (same method as §16.7-5).
4. Signed-in unchanged: the official settings panel and its five sections behave as before; `[aria-haspopup="menu"]` count = 1.
5. Screenshots: 5 sections × zh/en × light/dark = 20; 8 nav snapshots across locales.
6. Gates: `check:reuse`, `check:boundaries`, `check:packs`, `pnpm check` all green.

### 19.7 Effort and schedule

| Deliverable | Content | Rounds |
| --- | --- | --- |
| A | Shell section routing (reusing §17's panel) + the security audit checklist | 0.5 |
| B | Account section (official signed-out card + the four greyed rows) | 0.5–0.75 |
| C | Models section (local read-only declaration) | 0.5 |
| D | Plugins section (official tab rendered directly + stubs) | 0.75–1 |
| E | Presets section (official section rendered directly + greyed make-default) | 0.75–1 |
| F | Acceptance evidence + bilingual docs + deviation records | 0.5–0.75 |
| **Total** | | **3.5–4.5 rounds** + QA 0.5–1 round |

- **Schedule conflict**: P12 (this section) takes priority; P10 slips. E's "writable default preset" (+0.5 round) also slips behind P10.
- Out of scope (as before): a public model-catalog endpoint, dynamic OG, D1 configuration, plugin install/update writes, real billing data.

### 19.8 Risks

| Risk | Description | Mitigation |
| --- | --- | --- |
| R27 official components rendered outside their slot | runtime/store bindings may not match (especially `AgentPresetSection`) | per-page spike in deliverable 1; primitives fallback recorded |
| R28 the account greyed block is custom UI | the official signed-out branch has no balance/subscription rows | present it as a status explanation only, never numbers or links; record in `userApprovedDeviations` |
| R29 model declarations vs real availability | the fallback catalog is a declaration, not a working model | force "not configured / available after sign-in" copy; never show a green "available" badge |
| R30 `modules` service missing anonymously | the plugin tab's `clientSync` depends on it | empty-snapshot stub; `retryClient` no-op |
| R31 preset writes need settings | "make default" depends on host settings | grey it out first; enable after the `agentPreset` allowlist extension (deferred) |
| R32 perceived access-gate bypass | we render section components ourselves | call no owner remote; lock it with the network assertions (19.6-3); Security stance unchanged |
| R33 schedule pressure | P12 vs P10 conflict | P12 first, E's writable part slips |

## 20. Anonymous Account identity separation (2026-11-17 amendment)

The user requires the original official Account UI/UX to remain, with a separate Dsh-base login prompt and button below it. This section supersedes the current applicability of the four synthetic rows in section 19.3.1, the Account row in section 19.4 and R28. The original text remains a historical decision, not the current design of this region.

- Render the pinned exported `AccountSection` signed-out branch directly with its original dictionaries and CSS. Do not override its height, centering, margins, typography or button styling.
- Separate DeepSeek Platform identity from local Dsh-base identity. Platform authorization is not adapted, so a `disabled fieldset` retains the official region as unavailable with eight-locale `platformUnavailable` copy. The official sign-in button never calls local `requestLogin()` or implies a dedicated API key, balance or billing capability.
- Remove the synthetic balance/subscription/usage/top-up rows. Add an independent lower `data-dsh-base-account-sign-in` region with Dsh-base account copy, using official `Button` and `AccountSection` row styling. Only this added button opens the local login dialog.
- Keep the existing `client-account-launcher` plugin and reviewed exported components. Add no fork, copy no official source and put no capability in App entries.
- Grant no anonymous `account/watch`, `settings/describe` or private-data access. Browsing the panel sends no private account requests. Local authentication does not establish DeepSeek authorization.

Acceptance scope: compare the official region against the pinned component; verify the unavailable official action never opens local authentication; assert the four old rows are absent; verify only the added Dsh-base button opens the local dialog with dismissal and focus return; cover eight languages, light/dark and narrow screens; preserve zero private requests and existing authorization. Actual results and deployment evidence belong in [completion status](completion-status.en.md); this amendment does not claim deployment has completed.

## 21. Preserve complete account content while anonymous (2026-11-17)

The user further requested the original complete account content, with account-dependent areas disabled while signed out. This supersedes the centered signed-out placeholder choice in section 20; identity separation and the lower Dsh-base sign-in entry remain.

The official `AccountSection` returns a placeholder for `!signedIn && !active`; its complete identity and balance cards are not independently exported. The existing Host contract cannot produce that layout. A complete marked `@dsh-base/client-settings-account` fork therefore comes from the pinned submodule's `packages/client/ui-settings-account`, with the original retained as disabled inventory. Default `auto` presentation remains unchanged. The explicit `full-unavailable` Host contract applies only to a genuine signed-out snapshot without an authorization attempt.

The complete layout reuses the original identity, account information, balance, bonus, usage and top-up areas, CSS and eight dictionaries. Missing profile/wallet data uses official signed-out copy; no identity, amounts or authentication state are invented. Unavailable Platform links have no href and cannot navigate or authorize. Only the separate Dsh-base sign-in row opens local authentication. Private Host permissions remain unchanged.

Acceptance distinguishes direct original comparisons for default states from this user-approved anonymous extension: exact source-difference review, shared markup/styles, truthful anonymous snapshots, disabled navigation and independent local sign-in. The extension must not be described as existing upstream anonymous behavior or compared through fabricated authentication state. Evidence goes under `.artifacts/acceptance/account-full-layout/`.

## 22. Anonymous Models settings reuse the official UI (2026-11-17)

The user requested that Models content match the official UI as closely as possible. This supersedes §19/R29's custom list and “Not configured / Available after sign-in” copy. Being signed out does not establish whether credentials are missing or the platform is disabled.

The existing complete marked Models fork adds an explicit `public-declarations` presentation contract. Rows remain honestly `configured:false`, `active:false`, with unknown credentials; the default `auto` branch is unchanged. Official CSS, ProviderEditor, DeepSeekModelsEditor, CustomProviderCard and eight locale dictionaries remain unchanged. Read-only forms allow browsing and disclosure while writes stay disabled. The original Add provider button requests local authentication without opening a writable draft. Gateway reuses its card with a separate local signed-out snapshot, without creating the remote-reading, focus-listening GatewayStore.

Public model declarations and DeepSeek schema/defaults move into one pure data support package shared by existing Worker and client plugins. It is not an independently active plugin. The anonymous Host accepts no Context/Remote, refuses all writes and answers editor discovery only from local declarations. No private endpoint, credential access or anonymous permission is added.

Acceptance separately compares default Models with the pinned original and anonymous read-only ProviderEditor with the pinned original. The whole anonymous view is a user-approved presentation extension, not a claim that upstream already has this page. Browser checks cover eight locales, themes, narrow screens, details and login focus return; actual reports and versions are tracked in completion status.
