# @dsh-base/cloudflare-think-fetch

简体中文 | [English](README.en.md)

Cloudflare Think 官方 `createFetchTools` 的部署/账号配置接缝。保留 SDK 的
私网检查、下载上限（1 MB）、模型文本上限（24,000 字符）和重定向处理。
固定上游 DSH 的 `web-fetch-http` 使用 Node `undici`，`tool-web` 依赖原生工具服务；
两者均未提供部署与账号白名单的子集校验。复用决策记录在 `package.json`。

`FETCH_ALLOWLIST` 是逗号分隔的部署白名单；未配置或空字符串时只允许
`https://developers.cloudflare.com/**` 和 `https://ai-sdk.dev/**`。
账号/会话配置 `{ "allowlist": [...] }` 只能缩小这个范围：

- 接受绝对 HTTPS origin/path 模式，路径可以包含 `*` 或 `**`；拒绝 userinfo、
  authority 通配符、查询参数、片段、空白/控制字符和反斜杠。配置路径中的编码
  分隔符、嵌套百分号编码和非法转义也会被拒绝。
- 域名大小写、默认端口、域名尾点和路径 dot segment 先规范化；裸 origin
  表示 `/**`，显式 `/` 只表示根路径，与 Think 的匹配语义一致。
- origin 必须相同。部署 `/docs/**` 允许 `/docs/` 内的路径或模式，不允许
  `/docs-other/**`。exact 或复杂部署 glob 只接受相同的规范化模式，不猜测子集。
- 未提供配置、未提供 `allowlist` 或空数组继承部署策略。非空列表中任何非法、
  越界或无法证明为子集的条目都会使整组配置失败，绝不恢复更宽的部署权限。

控制面在持久化账号/会话配置前验证策略；Think 再验证已经保存的配置，避免旧数据
或管理员写入绕过执行边界。两处共用 `@dsh-base/plugin-management` 的纯函数。
重定向显式使用 `allowlisted`，每一跳都受最终白名单约束。路径约束针对 URL
规范化后的 pathname，不声明能够约束目标服务器自行二次解码后的资源。

运行 `pnpm check:fetch`：纯策略测试、真实 Think SDK + 本地 fetch stub 的
请求/重定向回归，以及控制面拒绝写入与 revision 保持测试。该命令已接入
`check:security`，测试不发出真实网络请求。
