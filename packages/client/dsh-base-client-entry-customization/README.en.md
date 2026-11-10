# More menu

Application scope: the default workbench loads after sign-in. Signed-out states described below are component or Host contracts exercised in isolation.

A complete browser fork of the pinned official `@deepseek-ai/dsh-client-ui-entry-customization`. Source: `.submodules/deepseek-harness/packages/client/ui-entry-customization`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, MIT licensed.

The three official slots in the left sidebar, conversation views and right sidebar retain their complete menu structure, icons and copy. Before sign-in, Browse other plugins opens the mounted public catalog and Create your plugin opens the login dialog. No About, Support or Environment entries are added.

The official component has no injectable availability fields and hides discovery when its navigation service is absent, so this is a marked fork. Optional `useNavigationAccess` and `unavailableReason` props provide the Host adaptation; omitting them preserves official behavior. The public dictionary namespace retains its official type identity. CSS and dictionaries are unchanged.

Account actions remain closed while `navigationAccess` is checking or failed. Anonymous creation requests sign-in before creating a draft. Browsing requires a real public or authorized `pluginNavigation` service. Callbacks recheck account state when invoked. Authenticated creation retains the official Creator draft flow. Neither permissions nor the private Gateway are changed.

`tests/fork-source.test.mjs` checks inherited source against the explicit adaptation inventory. Focused browser acceptance checks public browsing, action-level login gates, keyboard behavior and authenticated official visual parity.

Anonymous creation opens the login dialog after the official menu closes and restores its persistent trigger, so dismissing login returns keyboard focus to More.
