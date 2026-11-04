# Official command popup compatibility

The complete browser implementation comes from this repository's pinned `@deepseek-ai/dsh-client-ui-commands` submodule package at commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, preserving its MIT license. This plugin replaces the executable official row; the original remains visible in composition inventory, disabled.

The official `SelectOption` contract has no per-option availability field. Mounting the plugin or its exported view cannot show deployment-unavailable `/model` choices as disabled. This fork adds only Host capability fields `disabled` / `disabledReason`: keep the original rows visible with localized reasons and dimmed styling; pointer, Enter/Tab, arrow navigation and confirmation cannot submit them. Ordinary options retain the official layout, search, confirmation, token consumption and focus behavior.

Changes are limited to `contract.ts`, `popup.ts`, `PopupSelectView.tsx`, its additional disabled CSS rule, and `index.ts` for an empty Config and public type identity. Other source files and all eight locale dictionaries remain unchanged. No Node Host implementation or custom command product behavior is added. Re-audit these differences whenever the upstream pin changes.

`node apps/web/tests/parity/run-commands.mjs` compares normal en/zh text, controls, geometry and screenshot pixels with the official reference. It uses the actual `/model` option generation function and fork controller to verify zero disabled pointer/keyboard submissions and normal available selection. This is not a whole-application or deployed parity claim.
