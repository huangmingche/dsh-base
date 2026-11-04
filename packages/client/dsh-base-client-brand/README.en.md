# Official sidebar brand display-text seam

The official brand plugin registers its slots only when `DSH_CLIENT_BUILD_PROFILE === 'official'`; outside that profile its `apply()` returns immediately, so the sidebar renders the official `SidebarRoot` fallbacks. This package occupies only the public `sidebar.brand.name` slot and returns a plain `<span>dsh-base</span>`, keeping the product name identical in every locale.

The mark slot is not registered: the sidebar keeps the official fallback (`FishLogo size=24`, wrapped in a click-to-copy version when `DSH_CLIENT_VERSION` exists). No CSS is added and layout, typography and interaction are untouched; the `<span>` inherits the official styling.

Explicitly approved by the user on 2026-11-13: the sidebar shows the code name `dsh-base` in every locale; the product display name `DeepSeek Harness Base` is used in README and documentation, not in the sidebar. The one unavoidable difference is that the official name fallback also renders the local-build name, the version line and the click-to-copy version inside that slot; occupying the name slot removes that fallback, so the name line no longer carries a version. The Settings current-version row and the mark's click-to-copy version are unaffected. `dshBase.reuse` records the no-op fact, the approved deviation and the gap; the official brand plugin keeps the official default enabled state (a no-op) and is neither marked disabled nor declared as replaced.

Browser acceptance: `node apps/web/scripts/acceptance-local-ui.mjs` asserts the sidebar brand is `dsh-base` in both locales; after deployment `node apps/web/scripts/acceptance-sidebar-brand.mjs` re-checks English/Chinese identity, the official mark fallback and the sidebar structure.
