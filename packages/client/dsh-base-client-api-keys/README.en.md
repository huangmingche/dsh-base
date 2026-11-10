# Create and revoke personal API keys.

Independent client plugin `client:api-keys`, grouped under `dsh-base:api-keys` through the official `plugins.bundle.config` slot. This package owns its response validation, fields and actions; browser support supplies only same-origin request lifetime and unchanged official control rendering. Adds no settings section and does not modify DeepSeek Platform account behavior. The server independently authorizes all private reads and writes. Missing configuration and denied access remain explicit. Supports all eight official languages. No purchased template or official source is copied.

Keys have only profile:read permission and cannot replace a browser login session. Creation shows the secret once; leaving the panel or clearing the result erases it. Default validity is 30 days, configurable from 1 to 365 days. Lists are paginated and revocation operates only on the owner’s keys.

The plugin registers its own public bundle configuration through the lifetime-scoped `publicPluginConfigurations` compatibility service. The default workbench requires sign-in. The panel and server authorize account and administrator actions. Unloading removes the registration and never exposes private row configuration.
