# Workspace navigation availability fork

This package retains the complete browser source and locale resources of the pinned official `@deepseek-ai/dsh-client-ui-workspace`, read from `.submodules/deepseek-harness/packages/client/ui-workspace` at commit `9c2670d3bce5275e0d1610272958121af87787bb`. See [LICENSE](./LICENSE) for the MIT license. The official original remains visible and disabled in composition inventory; this package takes its place through `replaces`. The application entry contains no feature implementation.

The session home picker and the reusable `workspace.picker` factory share the site-account check. Signing out withdraws the picker and pending creation checks access again before returning a workspace.

The official plugin assumes Host workspace navigation already has account access. Its internally registered browser, directory flow, shortcuts and `uiWorkspace` service have no account-availability configuration. Replacing exported components alone cannot prevent shortcuts or startup restoration from accessing private data. This complete marked fork adapts only the checked Host account state:

- Anonymous workspace search, view options and add controls remain clickable and open the login dialog before account-bound work. Checking/error states remain disabled with localized official Tooltips. Official geometry and enabled styling are unchanged.
- As explicitly requested on 2026-11-17, the anonymous workspace list stays empty without an extra icon, sign-in explanation or link; its heading, actions and layout seat remain. Checking/error feedback keeps the official `EmptySessions` structure and styling. Opening the conversation hero picker still requests the login dialog without mounting a private directory flow.
- Service actions, directory calls, create/rename/reorder callbacks and startup restoration share the account prerequisite. New Session/search/add shortcuts request sign-in anonymously; private-session commands remain denied. Shortcuts recheck between resolution and execution. Losing access releases the main Session reference, cancels pending navigation and menus, hides previous owner rows, and discards invalidated directory results.
- `navigationAccess` is only an additional prerequisite. Authenticated use retains real official `RemoteAccess` resource grants and Host behavior. No local permission is fabricated and server authorization is not relaxed.

Authenticated browsing keeps the official tree, list, watermarks, drag behavior, menus, ordering, shortcuts, directory flows, dictionaries and service semantics. Public Cordis, Session-reference and slot types retain their official `/client` identity. The internal toast declarations remain unchanged because the official stable declaration output does not retain that private augmentation. `entry.ts` only supplies the local Loader configuration contract. Re-audit these adaptations when the upstream pin changes.

Run the regression tests:

```sh
node --experimental-strip-types packages/client/dsh-base-client-workspace/tests/navigation-access.test.mjs
```

They use the real pinned Cordis/store runtimes and this fork's service to cover denied states without Host calls, independent account/resource gates, reference release on sign-out, invalidated async responses, owner-snapshot isolation and shortcut rechecking. The shared workspace-navigation acceptance provides rendered official comparisons and browser verification.
