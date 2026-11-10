# @dsh-base/client-deepseek-provider

Application scope: the default workbench loads after sign-in. Signed-out states described below are component or Host contracts exercised in isolation.

Complete marked fork of pinned `@deepseek-ai/dsh-client-ui-settings-models`. The
original DeepSeek provider, key, endpoint and model-directory editor/semantics
stay official; the fork adds the independent operator-managed Cloudflare AI
Gateway provider row rendered through the official provider-card contract, avoiding
the desktop unknown-namespace YAML hint. Gateway data is contributed by a separate
plugin.
DeepSeek `apiKeyEnv`, `baseURL` and model directory feed real Host execution: for an
explicit `deepseek-official/<model>` selection the Host resolves the owner settings
and injects them into the direct provider. This deployment executes OpenAI-compatible
Chat Completions, so the UI protocol hint matches that, not Anthropic. Gateway
configuration/credentials never participate in this direct route.

## Anonymous browsing

The stable `/client` entry exports `ModelsSection`, `ModelsSectionController`, `createSettingsSchemaOperations` and related types. The default `presentation: 'auto'` retains the existing account view and operations.

The Host may provide a local snapshot containing only public provider declarations with `presentation: 'public-declarations'`. The page reuses the official provider cards, read-only forms, custom-settings disclosure and Add model provider button. Declaration rows do not require `configured: true`; that flag keeps its original configuration meaning. Public presentation always forces read-only editors. The Host must not supply or infer owner credentials, availability, private settings or custom models.

Optional `onRequestAccess` makes the original Add model provider button request sign-in and immediately return. It neither marks an anonymous snapshot writable nor opens a private write flow. Expand, collapse and cancel retain the original components' local interactions. Host operation callbacks must also refuse unauthorized calls independently of disabled UI.

The controller contract contains only the `store` and `load` consumed by the component. An anonymous Host can supply local declarations without constructing `ModelsSettingsStore`, which reads private settings and credentials. Public defaults come from the shared declaration source, without copying an owner's user layer. The separate Gateway plugin represents signed-out state without reporting unknown configuration as enabled or disabled.

## Provenance and validation

The sole upstream source is `packages/client/ui-settings-models` in the pinned submodule, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, under MIT. The full `src/` and `locale/` trees and license are retained; original CSS and editor source remain unchanged.

[host-adaptations.json](host-adaptations.json) records earlier Gateway, Loader and copy changes under `baselineChanges`, and this public-presentation contract under `changes`. Run `node --test packages/client/dsh-base-client-deepseek-provider/tests/*.test.mjs` to reverse these adaptations and compare every source and resource byte for byte. Application acceptance additionally compares actual official rendering and interaction. These new parameters do not imply support for Platform billing, arbitrary providers or anonymous model calls.
