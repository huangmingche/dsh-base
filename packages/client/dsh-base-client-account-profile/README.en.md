# Manage your profile and password.

Independent client plugin `client:account-profile`, grouped under `dsh-base:account-profile` through the official `plugins.bundle.config` slot. This package owns its response validation, fields and actions; browser support supplies only same-origin request lifetime and unchanged official control rendering. Adds no settings section and does not modify DeepSeek Platform account behavior. The server independently authorizes all private reads and writes. Missing configuration and denied access remain explicit. Supports all eight official languages. No purchased template or official source is copied.

Name, avatar and password have separate save actions. Avatar choices come from the account’s uploaded images; a name-only save preserves the existing avatar. Arbitrary remote avatar addresses are not accepted. Better Auth verifies passwords and revokes other sessions.

The plugin registers its own public bundle configuration through the lifetime-scoped `publicPluginConfigurations` compatibility service. The default workbench requires sign-in. The panel and server authorize account and administrator actions. Unloading removes the registration and never exposes private row configuration.
