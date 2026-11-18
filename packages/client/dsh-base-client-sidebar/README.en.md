# Sidebar navigation

A complete browser fork of the pinned official `@deepseek-ai/dsh-client-ui-sidebar`. Source: `.submodules/deepseek-harness/packages/client/ui-sidebar`, commit `9c2670d3bce5275e0d1610272958121af87787bb`, MIT licensed.

The pinned panel controls, shared panel icon factory and Workspace scroll handoff come directly from the pinned official sidebar. The site-account checks apply when the corresponding actions activate.

The official layout, brand slots, collapse animation, shortcut hints, panel list and footer remain intact. Before sign-in, New Session opens the login dialog and mounted public Plugins and Automation tasks pages can be browsed. More retains its official structure.

## Host adaptation

- `navigationAccess` reports checked SaaS sign-in state; it grants no official `RemoteAccess` permission.
- Anonymous New Session requests sign-in; actual creation requires both an authenticated account and the real `session/create` grant. Its callback checks authentication again when invoked.
- Public Plugins and Automation tasks declarations register the official icons and labels at priority 1. Real public or authorized priority-0 panel entries replace them automatically. A missing real panel stays disabled even after authentication.
- Optional `useNavigationAccess` and `unavailableReason` props separate visibility from operation permission. Omitting them preserves the official component render.
- Unavailable controls use the official menu opacity, cursor and Tooltip behavior, retain keyboard focus, and expose `aria-disabled` and a description. The private Gateway is unchanged.

The official component has no configurable visibility/disabled interface, and an outer wrapper cannot adapt its internal buttons, so this is a marked fork. Public slot and dictionary namespace types keep their official identity. The four panel icon/dictionary source entries use the official declared `./src/*` export and are recorded in `dshBase.reuse.sourceEntries`; re-audit them on pin upgrades.

`tests/fork-source.test.mjs` checks every inherited file against the explicit adaptation inventory. Browser acceptance compares the authenticated view with the pinned official implementation and verifies anonymous entry visibility and action isolation.
