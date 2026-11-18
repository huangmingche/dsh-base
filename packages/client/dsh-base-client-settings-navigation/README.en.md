# Official settings navigation slot projection fix

Source is copied from the read-only pinned submodule's `packages/client/ui-settings-general`. `dshBase.forkOf` records the pin and MIT license, with the original notice retained in LICENSE. The complete browser implementation, styles and eight-language dictionaries are preserved.

The only behavior change reads settings navigation and onboarding order through public `entriesOfSlot()`, selecting each id's winner, rather than raw `entries()` containing shadowed originals. The official renderer already elects those winners; availability wrappers must not create duplicate navigation. Mounting the original plugin produces duplicates, and exported SettingsRoot cannot redeclare child slots owned by the original registration, requiring this minimal fork. The additional entry.ts only supplies the local Loader Config/name contract.

Run `node apps/web/tests/parity/run-settings-navigation.mjs`: real SlotCore registrations and the apply projection drive official SettingsRoot, comparing the English/Chinese original reference against shadowed entries and checking unique navigation and interaction.


The General settings version row appends the pinned upstream release on the official current-version line as `DeepSeek Harness` plus the tag. The app version is read from `apps/web/package.json`; the upstream repository and encoded release URL are derived from `dsh-source.lock.json` (`repository` with `.git` removed, `tag` encoded) and injected at build time. `DeepSeek Harness` links to the repository and the tag links to the pinned `/releases/tag/<tag>`; native anchors use `target="_blank" rel="noopener noreferrer"` and focus-visible styling. No URL/version constants are written in the component, no latest tracking, and a pin upgrade updates the display automatically. The row wraps on narrow Settings panes.
## Anonymous-panel extension (optional fields)

`SettingsPanel` is now exported (`src/client/SettingsRoot.tsx`, also re-exported from `./client`) and `SettingsSectionRow` gains three optional fields: `disabled`, `disabledReason` and `icon`. Official section registrations never set them, so signed-in nav cells keep their exact attributes, styling and activation path; the projection lives in `src/client/panel-rows.ts` and is covered by `tests/panel-rows.test.ts` (absent / false / reason-only all fall back to official behavior). The anonymous account entry uses these fields to render “the other four sections visible but disabled with a hover reason”; that is consumer behavior, not this fork's default render path.
