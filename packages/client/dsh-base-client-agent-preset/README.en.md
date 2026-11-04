# @dsh-base/client-agent-preset

Complete, marked fork of the official `@deepseek-ai/dsh-client-ui-agent-preset` (pinned `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, MIT).

- Preserves every official controller/component behavior: real `load()`, introduce animation, refusal Toast/dismissRefusal, main=false handling, Coding Tools menu effects, official guides, official CSS and locales;
- Only Host availability is adapted:
  - adds a distinct `unavailable` row state for platform limitations; it never reuses the official `broken` error state;
  - `presetOptions` keeps unavailable rows instead of hiding official modes from the composer;
  - the official `AgentPresetSeat` menu marks unavailable/broken items `disabled`, shows the localized gap as their description and guards `onSelect`;
  - `seat-store.select` returns refused for unavailable/broken ids;
  - `AgentPresetSection` renders platform-unavailable cards neutral gray with a localized badge/reason and no `role=alert`; true load failures keep the official red broken card;
  - the viewer stays available for the four official declarations/guides; only the Cloudflare Think row (no official declaration) is disabled;
  - the Creator entry stays visible but disabled while Cordis is unavailable/broken;
  - the Add-plugin Creator entry uses the same guard.
- The official composition row remains disabled inventory; this fork is active with `replaces`, and its real origin is custom.
- Declaration sources are the pinned `@deepseek-ai/dsh-web-app/presets/*.patch.yml` exports, generated and verified by build checks.

Verified by `node apps/web/tests/parity/run-host-capabilities.mjs`, `node apps/web/tests/parity/run-settings-navigation.mjs` and full local UI acceptance.
