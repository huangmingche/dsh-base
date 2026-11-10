# Email configuration status

Shows public email status from `/api/auth-policy` through the official `plugins.bundle.config` slot for `dsh-base:email`, using unchanged official buttons and settings field styles. Displays enablement, configuration readiness and provider only; readiness does not mean delivery succeeded. There is no browser secret editor or test-message action. Site administrators configure sender and credentials in deployment; the existing login plugin owns verification and password recovery. The purchased template was a workflow reference only; no source is copied here.

Failed reads and invalid configurations never appear ready. Supports all eight official languages, registers no settings section and reads no private account. Check: `node --experimental-strip-types --test packages/client/dsh-base-client-email/tests/*.test.ts`; real slot/control rendering is covered by the Waffo Pancake client package's `tests/panels.test.mjs`.

The plugin registers its own public bundle configuration through the lifetime-scoped `publicPluginConfigurations` compatibility service. The default workbench requires sign-in. The panel and server authorize account and administrator actions. Unloading removes the registration and never exposes private row configuration.
