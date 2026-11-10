# Public site configuration service

This client DSH plugin provides the `siteConfig` observable and reads `/api/site-config` once when the main app starts. Its snapshot contains shared defaults or the last successfully read public brand/link facts, never permissions or secrets.

`client:brand` is an active consumer and fills only the official sidebar name slot. Successful global site saves call `refresh()` to update the name; there is no polling. Failed reads retain the last good snapshot, older responses cannot overwrite a newer refresh, and disposal prevents further reads or publications.

Re-enabling this service does not restore the disabled `client:shell-extras` or add More menu items. Public login documents keep their separate composition without this service. The site settings API independently enforces site-administrator permission.

Check: `node --test packages/client/dsh-base-client-site-config/tests/*.test.mjs`.

The stable `./title-face` export adapts Host data to the official `LocaleFace`
contract at the marked locale-label fork's single installation point. It only
projects `common/brand.localBuild`: official translation applies before public
`documentTitles` arrives, then the active language, English, and site name form
the fallback chain. Other namespaces and translation parameters pass unchanged
to the official service. Title and locale changes update one revision observable;
unrelated public link changes do not rerender every localized outlet. Disposal
releases both subscriptions. The adapter adds no dictionary, layout code, or DOM
title writes; the official `DocumentTitle` still owns session-name prefixes.
