# Dsh-base public browsing

Composes the plugin manager page and official automation task components for anonymous browsing. Account operations request sign-in. The public catalog contains deployment declarations only; account settings, sessions, workspaces and tasks remain private. Both task creation entry points request sign-in before the account UI reads workspaces or tasks.

The client composition entry is `client:public-navigation`. Package metadata records the user-approved anonymous behavior and official exported sources.

Configuration entries remain visible in anonymous details. The public slot gate renders an official sign-in button for unregistered private configuration without mounting its forms. Actual plugin selections, configuration and tasks retain their original authorization.

Configuration mounting is denied by default. Plugins can explicitly register their own action-gated public bundle configuration through the exported `publicPluginConfigurations.registerBundle(key)` service. Registrations are lifetime scoped and reference counted; changes refresh the view. Unregistered bundles, private global configuration and every `plugins.row.config` retain the sign-in gate.
