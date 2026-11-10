# @dsh-base/cloudflare-think-subagent

只恢复「**明确声明不可用 + 兼容导出**」，**不是真实子代理能力**；本部署**存储为空、无历史可验**。

## 当前状态

- **不注册 `delegate_task`**：模型侧工具目录为空（`subagentTools.tools()` 返回 `{}`），系统提示写明
  `SUBAGENT_UNAVAILABLE_REASON`，并要求「不要声称启动过子代理」。
- `DshSubagent` 类名与 Worker 导出保留，继承官方 Think 存储实现，保证持久化的 facet 类名仍可解析；
  但模型 / turn / step / tool 入口统一抛 `SUBAGENT_UNAVAILABLE_REASON`，不会借平台凭证继续执行。
- **存储为空**：Commit 1 的 `deleted` 迁移已清空历史 facet / 会话记录；本包只恢复类名、导出与继承的读取路径，
  本部署没有任何历史数据可用于验证「历史可读」——验收与文档都只能写「无历史可验」，不得写成能力恢复。
- 交互式子代理控制（客户端 `remote.subagents.prompt/interruptByParent`）继续返回 `subagent/unavailable` 明确拒绝。
- Worker 侧 `DshSubagent` Durable Object 以 sqlite 存储复活（原来的 `state: "deleted"` 墓碑移除）；B 态部署日志已证
  该墓碑是 stale（无同名 namespace 需要保留），复活即全新空存储。若 Cloudflare 拒绝同名复活，按 ADR §11.9 改名三处，
  验收口径同步。

## 为什么不用官方实现

官方委派工具需要 DSH 子代理会话地址、所有权、执行与取消生命周期；Think facet 身份不等于 owner Session 地址，
挂载官方实现或只做 Host 接缝都无法提供这些生命周期，旧 agentTool 桥也没有携带 owner BYOK 与会话作用域。
因此本部署声明不可用并隐藏工具入口，而不是伪造一个能跑的子代理。

## 复用决策

官方候选 `@deepseek-ai/dsh-tool-subagent`、`@deepseek-ai/dsh-subagent` 均因上述生命周期缺口无法挂载；
详见 `package.json` 的 `dshBase.reuse`（`availability: "unavailable"`）。
