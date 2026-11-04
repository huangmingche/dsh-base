# @dsh-base/client-deepseek-provider

Complete marked fork of pinned `@deepseek-ai/dsh-client-ui-settings-models`. The
original DeepSeek provider, key, endpoint and model-directory editor/semantics
stay official; the fork only adds the independent operator-managed Cloudflare AI
Gateway provider row rendered through the official provider-card contract, avoiding
the desktop unknown-namespace YAML hint. Gateway data is contributed by a separate
plugin.
DeepSeek `apiKeyEnv`, `baseURL` and model directory feed real Host execution: for an
explicit `deepseek-official/<model>` selection the Host resolves the owner settings
and injects them into the direct provider. This deployment executes OpenAI-compatible
Chat Completions, so the UI protocol hint matches that, not Anthropic. Gateway
configuration/credentials never participate in this direct route.
