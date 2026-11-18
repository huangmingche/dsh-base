# Dsh-base account settings

[简体中文](README.md)

`@dsh-base/client-settings-account` is a complete runtime fork of the official account settings plugin. It preserves the account identity, balance, bonus balance, usage and top-up UI, adding one unavailable presentation explicitly selected by the Host. A separate account-launcher plugin still provides Dsh-base local sign-in.

## Official source and reuse decision

- Official package: `@deepseek-ai/dsh-client-ui-settings-account`.
- Sole source: `.submodules/deepseek-harness/packages/client/ui-settings-account`, pinned to `dsh-v0.2.2-rc.5`, commit `9c2670d3bce5275e0d1610272958121af87787bb`, under the MIT license.
- The full `src/` and `locale/` trees, image assets inside the source tree, and upstream license are retained. The upstream checkout is not modified.

Mounting the official plugin or reusing its exported `AccountSection` renders a centered sign-in prompt when genuinely signed out with no authorization in progress. The official component has no presentation parameter that shows complete account cards in this state. The user explicitly requested the complete account content with only unavailable actions greyed out. This package therefore forks the complete official runtime and adds the smallest presentation parameter. The default branch, original registration, dictionaries and original CSS remain unchanged; it does not introduce a separate account UI.

## Presentation and permissions

Stable entries `.` and `/client` export the original plugin's `apply`, `inject` and types, along with `AccountSection` and the local Loader's `name` and `Config`.

`AccountSection` adds `presentation?: 'auto' | 'full-unavailable'`:

- The default `auto` retains official rendering and behavior.
- `full-unavailable` applies only to genuine `status === 'signed-out'` with `attempt === null`. Unknown state, signed-in state and every authorization attempt keep the official branch.
- This state retains the official identity card, account information, balance card, bonus balance and More action layout. Balance and bonus use the official `balanceSignedOut` copy without invented amounts or stale private account information.
- Account information, usage and top-up anchors have neither `href` nor Host click handlers and set `aria-disabled="true"` and `tabIndex={-1}`. They do not construct a Platform URL, navigate or trigger local sign-in.
- `AccountAvailability.module.css` adds the official Button's disabled opacity and cursor treatment only in this state and suppresses enabled hover treatment. The original `AccountSection.module.css` remains byte-identical.

The parameter controls visibility, not authentication or data access. The Host supplies the anonymous snapshot and permission boundary. The separate `client-account-launcher` places the Dsh-base sign-in copy and button below, keeping the local identity distinct from a DeepSeek Platform account.

## Composition and difference verification

The composition ID is `client:settings-account`, with `origin: fork` and order `69`, replacing the official account plugin. The original official entry must remain in the inventory disabled to prevent duplicate registration.

[host-adaptations.json](host-adaptations.json) records every difference: `AccountSection.tsx` changes, with a new stable entry and unavailable-state stylesheet. One type-only import in `AccountOnboarding.tsx` follows the deployed model-provider fork to avoid redeclaring the `settings.models` namespace from its disabled original; it does not change runtime UI or behavior. Re-audit these changes and source export contracts when upgrading the upstream pin.

Run `node --test packages/client/dsh-base-client-settings-account/tests/*.test.mjs` to verify provenance, license, the complete file inventory and reversed adaptations. Images, original CSS and dictionaries are compared as binary data. The application's account acceptance covers account states, disabled interactions and rendered comparisons of the default branch. This package does not implement Platform sign-in, billing or anonymous private-data access.
