# @dsh-base/site-config

Shared public site configuration and editing contracts, with no DOM, Worker or React dependencies.

`./settings` exports complete `SiteSettingsValues`, versioned `SiteSettingsSnapshot` with edit permissions, deployment-default resolution and strict publication validation. SEO, sidebar branding and public links use one document. It defines titles, descriptions and keywords for eight languages, icons, social images, manifest, robots, and sitemap overrides for implemented public pages.

Deployment values supply defaults before the first save. The site-config Worker plugin stores the complete published document in D1. Validation rejects unknown fields, unsafe URLs, incomplete documents and sitemap overrides for private or nonexistent pages. Account IDs, secrets and edit permissions are never part of saved values.

The root `SiteConfig` export retains public-projection and client-service compatibility. The disabled shell-extras plugin remains disabled.

Upstream has no deployment-site configuration contract; this package shares data only. The separate client-global-settings plugin supplies the editor through official settings components and the plugin configuration slot.

## Conversion configuration

`analytics.conversions` is independent from public page views, defaults off, and supports off/aggregate/google plus public campaign labels. Strict validation rejects unknown modes, duplicate/invalid labels and Google mode without a Measurement ID. Secrets, user consent and visitor identifiers are not stored.
