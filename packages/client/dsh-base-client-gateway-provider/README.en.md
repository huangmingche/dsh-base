# @dsh-base/client-gateway-provider

Independent Cloudflare AI Gateway custom provider slot plugin (not a pure seam). The official Models
plugin is mounted through the marked DeepSeek-provider Models fork; the original DeepSeek provider and editor stay official. Through the
official `settings.models.provider-card` contract this plugin contributes the
independent `cloudflare-ai-gateway` provider id (settings namespace
`llm-cloudflare-gateway`) with its real platform availability, operator-managed
read-only explanation and real Gateway catalog. Gateway settings are not
user-editable and the Host write boundary rejects that namespace.

The Plugins page exposes one **Cloudflare AI Gateway** bundle and one account switch for this model settings card and the Think platform model service. Official details retain both real components as “Model settings” and “Platform model service”, with read-only component switches explaining bundle management. Package names, composition IDs and provider IDs remain stable. Legacy state follows the Think service selection to preserve existing execution permissions; explicit Session overrides still apply and own-API-key routing remains independent.

When platform authentication is ready, the provider name shows the official `credentialDot credentialDotConfigured` green dot (8px, same class/token/position as the official DeepSeek row). The green dot means platform authentication is configured and available; it is **not an API key or credential state**, and no credential is read. loading/error/unavailable/signed-out states show no dot and keep an honest reason in the details; the custom Available/Unavailable/Checking/Error text label is removed.

Anonymous Models supplies a purely local view through `createSignedOutGatewayStore(catalog?)`, reusing the same `GatewayCard` and official detail styles. Status and authentication say “Sign in to view”; unknown readiness is never presented as disabled, unconfigured or available. Optional model names come from public declarations supplied by the caller and remain labelled “Models”, without implying account access. This view never constructs the real `GatewayStore`, reads the Host or installs refresh listeners; `start`/`load` preserve its signed-out state. An authenticated page supplies its own live state source; refreshing the anonymous view cannot grant authority.

The card is collapsed by default and reuses the pinned official `ModelsSection`
compact row, 28px secondary action and editor styling: the name, official status dot and action share
the row, while the raw provider id appears only as secondary information in the
expanded details. Details use the official disclosure pattern with status,
authentication and model fields; operator-managed read-only configuration is never
presented as a fake editable form. In production the marked Models fork owns the one-open-card state and passes it
through the explicit `GatewaySeatControl` (`gatewayOpen`/`onGatewayToggle`)
adapter, so DeepSeek/Gateway expansion is mutually exclusive. As a standalone/
parity fallback, when no control contract is supplied the plugin retains an
internal open state; that fallback is not part of the production single-card state. A reactive store refreshes on settings/llm
invalidations, connection recovery and window focus with generation fencing,
disposal cleanup, loading/error/retry/unavailable states. Copy is localized in
en/zh/ja/es/fr/de/ru/pt. It never uses the unknown-namespace editor or the
cordis.patch.yml hint, reads only the independent Gateway provider state, and never
depends on the owner key.
