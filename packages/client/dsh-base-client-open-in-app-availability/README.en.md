# Open in a local application

The official `@deepseek-ai/dsh-client-ui-open-in-app` plugin registers Open in on the Session row and Session header context menus. When the workspace has a directory and a native application is available, the official submenu lists applications and its controller opens the selection.

Workers has no native desktop launcher. The seam subscribes to the application catalog exposed by the official Files action. When the official action is absent, it contributes a disabled item with the official menu icon, order and disabled styling, and an explanation in eight languages. The separate `@dsh-base/cloudflare-worker-open-in-app-availability` plugin serves the catalog through the official HTTP contract. Reading the existing state requires no additional request.

The Files toolbar targets the current workspace directory. The original empty state appears without a workspace. When the catalog finishes loading with no eligible target, the toolbar shows the original compact `OpenTargetButton` in a disabled group with a localized explanation on hover. The official action opens the directory whenever an application is available.

`tests/availability.test.mjs` checks both menu targets, mount and disposal, disabled dispatch and localization. The browser regression in `apps/web/tests/parity/run-session-menu.mjs` compares the official menus and exercises submenu launch, keyboard interaction, themes and narrow screens.
