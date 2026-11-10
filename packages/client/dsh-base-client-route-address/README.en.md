# @dsh-base/client-route-address

Maps official DSH client Session/Workspace selection to addressable URLs and restores deep links through the official `uiWorkspace` services.

## Addresses

- `/app/session/:sessionId`: open that Session;
- `/app/workspace/:workspaceId`: open that Workspace (official UI then selects its Session, so the address becomes `/app/session/:id`);
- Language prefixes come only from the shared `@dsh-base/locale-path` module: `/app/session/:id` is the bare English address, while `/zh-CN /ja /es /fr /de /pt /ru` select the other seven languages. Restoring a selection and mirroring later navigation keep the reader's current prefix;
- A prefix counts only at the outermost segment: `/zh-CN/app/session/:id` is a Chinese deep link, `/app/session/zh-CN/:id` is not. `/en/*` normalizes to the bare address. The retired `/zh` has no language meaning; the Worker returns 404 for unregistered document addresses.

## Behavior

- Waits for the official Session/Workspace lists to be ready, then calls
  `uiWorkspace.openSession()` / `openWorkspace()` from the address;
- Subscribes to the official Session list and mirrors user selection with
  `history.pushState`, rebuilt with the current language prefix;
- Restores addresses on `popstate`, retaining only the latest address request;
- Uses the official `layout.beginNavigation()` cancellation contract. Choosing a panel or Session, or traversing history again, supersedes pending startup or address resolution. Stale requests cannot select a Session, report errors or rewrite the URL;
- Delegates Workspace cancellation to the official `openWorkspace()` method and confirms its commit through `beforeOpen`. No readiness delay or repeated selection can override a newer user action;
- Unknown ids show a localized notice through the official `shell.overlay` +
  `Toast` and fall back to `/`;
- Renders no navigation UI and modifies no official layout; official
  `uiWorkspace` and the Session list remain the source of truth.

## Reuse decision

The official client has no URL router (no pushState/popstate/hash) and does not
map Session/Workspace selection to browser addresses. This plugin reuses the official
`uiWorkspace.openSession/openWorkspace`, `layout` services and official observables,
adding only an address seam. The prefix rules are provided by the single shared
`@dsh-base/locale-path` module; `check:locale-path` rejects a second copy here.
See `dshBase.reuse` in `package.json`.

## Verification

`pnpm check:route-address` covers the address codec and delayed navigation using the actual pinned official `LayoutController` and `UiWorkspaceService`, including a manual Session selection followed by ready catalogs in the same event turn. `pnpm acceptance:route-address-local` uses the built application and an isolated local Host: it delays a real blank-Session restoration request, clicks the official Plugins entry, releases the request, and verifies that the main content and sidebar selection stay consistent. It accesses no deployed data and calls no model.
