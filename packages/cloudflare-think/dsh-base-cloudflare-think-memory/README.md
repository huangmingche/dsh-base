# @dsh-base/cloudflare-think-memory

简体中文 | [English](README.en.md)

需要人工批准的持久记忆 Think 插件。

- 向官方 system-prompt 注册表贡献记忆段落，并读取 Agent SQLite 中已批准的事实。
- `recall_facts` 工具读取已保存事实。
- `remember_fact` 动作通过 `approval: true` 请求内联批准，标注低风险，并使用稳定幂等键避免同一事实重复执行。
- 存储由组合后的 Think Agent 的 `dsh_agent_facts` SQLite 表持有；插件只调用 `DshAgentRuntime.rememberFact` 与 `listFacts`。

记忆是当前 Agent 的持久数据，不等同于官方 DSH 的跨会话全局记忆服务。
