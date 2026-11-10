# Sign in with Google when configured.

Independent client plugin `client:google-auth`, grouped under `dsh-base:google-auth` through the official `plugins.bundle.config` slot. This package owns its response validation, fields and actions; browser support supplies only same-origin request lifetime and unchanged official control rendering. Adds no settings section and does not modify DeepSeek Platform account behavior. The server independently authorizes all private reads and writes. Missing configuration and denied access remain explicit. Supports all eight official languages. No purchased template or official source is copied.

This panel shows deployment Google OAuth enablement only. The existing login plugin provides the real sign-in action; client secrets are never edited in the browser.

The plugin registers its own public bundle configuration through the lifetime-scoped `publicPluginConfigurations` compatibility service. The default workbench requires sign-in. The panel and server authorize account and administrator actions. Unloading removes the registration and never exposes private row configuration.
