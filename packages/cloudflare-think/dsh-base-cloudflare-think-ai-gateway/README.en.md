# Cloudflare AI Gateway model transport plugin

This Think plugin calls DeepSeek only through Cloudflare AI Gateway. It accepts explicit `cloudflare-ai-gateway/*` model identifiers and never reads an owner key. The independent `@dsh-base/cloudflare-think-deepseek` plugin handles owner BYOK; neither provider falls back to the other. It reuses the pinned official `@deepseek-ai/dsh-llm-deepseek/src/models.ts` catalog. Requests use the actual `deepseek-flash` and `deepseek-v4-pro` identifiers instead of mapping product names to legacy `deepseek-chat` / `deepseek-reasoner` aliases.

The Host persists the model and reasoning effort for each admitted request. Think retains that configuration during execution and approval continuation. This plugin's request utility uses the public AI SDK transformer to map `off` to `thinking.type=disabled`, and `low`, `high`, or `max` to `thinking.type=enabled` with the corresponding `reasoning_effort`. An omitted effort uses the official `high` default; unknown values fail before a request. This transformation currently applies only to the Gateway route. The AI binding manages Gateway authentication and upstream keys; the Host separately injects owner credentials into the BYOK provider.

The Plugins page groups the client settings card and this Think provider into one Cloudflare AI Gateway bundle. Its account switch atomically saves both component selections in one revision. Disabling the bundle hides the card and makes Gateway models unavailable by default for the account, rejecting subsequent Gateway requests; explicit Session overrides still apply. Toggling off carries no promise to cancel requests already running; independent BYOK routing is unaffected. Deployment configuration must also explicitly enable platform AI and specify a Gateway ID; account or Session selection cannot override deployment opt-out.

The official DSH provider consumes Cordis Host services and the Messages protocol, so it cannot directly supply Think's AI SDK LanguageModel; a fork would still need this protocol bridge. This custom Think plugin provides the necessary runtime/transport adaptation and reuses the official catalog without copying implementation fragments. `dshBase.reuse` records the exported source entry and reviewed pin for upgrades.

A deployment can map `platform_ai` to a paid feature through `ENTITLEMENTS_OPERATIONS_JSON`. An absent mapping preserves the existing free policy; platform AI still requires explicit opt-in. The Host checks before ordinary execution or approval recovery, and Think checks again through its authenticated owner Host before every actual `gateway.run`. Refunds or expiry therefore block subsequent model requests. Identity comes from the Durable Object name, never a client-supplied owner. Missing trusted authorization fails before outbound inference. Requests already in flight are not recalled.

`PLATFORM_AI_MAX_OUTPUT_TOKENS` optionally caps each platform model request (`1..131072`, integer). Missing or empty configuration preserves the existing provider limit. The request uses the smaller of the deployment cap and any caller limit. Invalid configuration fails before an outbound request. This is not an accumulated usage quota and does not change BYOK requests.

Protocol references, checked on 2026-11-10: [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) and [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/). Thinking content must be retained for subsequent tool requests; the real SDK serialization is covered by regression tests.

Validation:

```sh
node --experimental-strip-types packages/cloudflare-think/dsh-base-cloudflare-think-ai-gateway/tests/provider-policy.test.ts
node --experimental-strip-types packages/cloudflare-think/dsh-base-cloudflare-think-ai-gateway/tests/request-contract.test.ts
```

The request contract test uses the real AI SDK with an in-memory Gateway receiver to verify both Gateway models, all four efforts and the default, credential isolation, and reasoning history passback. The policy test separately verifies exclusive model ownership between the Gateway and BYOK plugins, deployment opt-in, and zero outbound calls on refusal. These tests send no external model requests and do not establish that live credentials or the upstream service work.
