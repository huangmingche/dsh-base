# Cloudflare AI Gateway 模型传输插件

该 Think 插件仅通过 Cloudflare AI Gateway 调用 DeepSeek，只接受显式的 `cloudflare-ai-gateway/*` 模型标识，不读取用户密钥。自备密钥（BYOK）由独立的 `@dsh-base/cloudflare-think-deepseek` 插件处理，两者不自动回退。模型目录直接复用固定官方子模块的 `@deepseek-ai/dsh-llm-deepseek/src/models.ts`；请求发送真实的 `deepseek-flash`、`deepseek-v4-pro`，不再把产品名称映射为旧版 `deepseek-chat` / `deepseek-reasoner`。

Host 为每次提交持久化模型及推理强度，Think 在执行和审批续跑时读取同一配置。本插件的请求转换工具通过 AI SDK 的公开接口，将 `off` 转为 `thinking.type=disabled`，将 `low`、`high`、`max` 转为 `thinking.type=enabled` 和相应的 `reasoning_effort`。省略强度使用官方默认 `high`；未知值在请求前失败。该转换当前仅用于 Gateway 路由；Gateway 认证和上游密钥由 AI binding 管理，BYOK 凭据由 Host 单独注入其提供者。

插件页将客户端设置卡片与此 Think 提供者归入同一个 Cloudflare AI Gateway 插件包，账号开关在一次事务、一个 revision 内保存两个组件的选择。关闭时隐藏卡片，默认使账号的 Gateway 模型不可选，并拒绝后续网关请求，显式会话覆盖仍按其配置生效。关闭开关不承诺取消正在执行的请求，也不影响独立 BYOK 路由。部署还必须显式启用平台 AI 并指定 Gateway ID，账号或会话开关不能覆盖部署禁用。

官方 DSH provider 使用 Cordis Host 服务及 Messages 协议，不能直接作为 Think 的 AI SDK LanguageModel 挂载；fork 仍需要同一协议桥。此自定义 Think 插件提供必要的运行时/传输适配，复用官方目录，不复制官方实现。`dshBase.reuse` 记录源入口及固定提交，升级时必须复审。

部署可通过 `ENTITLEMENTS_OPERATIONS_JSON` 将 `platform_ai` 映射到收费权益；未声明映射保持原有免费策略，平台 AI 自身仍须显式启用。Host 在开始普通提交或审批恢复前检查，Think 每次实际 `gateway.run` 前通过内部鉴权的 owner Host 再检查当前权益，因此退款或到期会阻止后续模型请求。身份来自 Durable Object 名称，客户端不能提交 owner；丢失可信授权接口时拒绝出站。已经开始的请求不会因此被撤回。

`PLATFORM_AI_MAX_OUTPUT_TOKENS` 可设置每次平台模型请求的输出上限（整数 `1..131072`）；未设置或空串保留原有提供者限制。实际请求使用部署上限和调用者更小限制中的较小值。非法配置在出站前失败。此限制不构成累计用量配额，也不改变 BYOK 请求。

协议依据（核对日期 2026-11-10）：[DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。支持 tool calling 的思考消息必须完整回传；实际 AI SDK 的序列化已纳入回归。

验证：

```sh
node --experimental-strip-types packages/cloudflare-think/dsh-base-cloudflare-think-ai-gateway/tests/provider-policy.test.ts
node --experimental-strip-types packages/cloudflare-think/dsh-base-cloudflare-think-ai-gateway/tests/request-contract.test.ts
```

请求合同测试使用真实 AI SDK 与内存 Gateway 接收器，验证 Gateway 的两模型、四档与默认强度、凭据隔离及推理历史回传；策略测试另行验证 Gateway 与 BYOK 两插件的模型归属互斥、部署启用条件及拒绝时零出站。测试不发送外部模型请求，不代表线上凭据或上游服务已通过实测。
