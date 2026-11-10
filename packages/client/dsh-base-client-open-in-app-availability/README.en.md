# Open in local application availability

The official `@deepseek-ai/dsh-client-ui-open-in-app` plugin and its controllers remain mounted. This seam reuses the pinned exports `OpenInAppAction` and `OpenTargetButton` through the public SlotRegistry to preserve the original session-header utility when local applications are unavailable. It copies no official source.

The Workers deployment has no local desktop application launcher. Without a real workspace directory and a recognized application, the control stays visible inside a disabled fieldset, blocking pointer and keyboard operations with an explanation in eight languages. Its opacity matches the official Button disabled state. No applications, directories, loading states or successful launches are fabricated. When both a real directory and an application are available, the original official component and controller handle them unchanged.

The separate `@dsh-base/cloudflare-worker-open-in-app-availability` plugin explicitly returns an empty catalog through the official HTTP contract, so a missing-route 404 or SPA document is never mistaken for a capability response. The original controller requests the catalog once. No global fetch replacement or anonymous private-data access is introduced.

In the pinned `dsh-v0.2.2-rc.1` release, local opening is a separate header utility. This seam does not recreate another release’s combined More menu. Source exports and the tracked gap are recorded in `dshBase.reuse` for pin-upgrade review.

Run `node packages/client/dsh-base-client-open-in-app-availability/tests/availability.test.mjs` to verify availability, the real SlotCore lifecycle and official component rendering. Browser acceptance separately compares the official menu and unavailable utility, including pointer, keyboard, themes and localization.
