# Retired permission availability seam

The current Host enforces per-session permission policies, R2 operation checks and approval policy. The composition mounts the unchanged official `ui-permission-presets` plugin. This package remains disabled inventory; it no longer replaces the official plugin or participates in the normal UI.

Vite and conformance checks share the composition metadata reader, preserving this package's `disabled` flag and reason. Generated code contains no import, module loader, or namespace loader for it, so its locale registration cannot conflict with the mounted official plugin. `scripts/conformance/tests/client-composition.test.mjs` executes the generated module to verify this boundary.

Its exported-component seam is retained only for other Hosts explicitly lacking permission services: pinned official `PermissionSelect` and `PermissionRow` stay visible and disabled with eight-language explanations. Source exports and review commit remain recorded for pin-upgrade review. Upstream source is neither edited nor copied.
