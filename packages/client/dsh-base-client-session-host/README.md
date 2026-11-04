# @dsh-base/client-session-host

Workers-native Session Host 的浏览器 transport seam。

JSON 请求验证 HTTP 成功状态和明确的 `result` 字段。错误状态、空信封、无效 JSON 与 Host 业务错误都会拒绝，业务 `code/message/details` 保留；成功的 void 操作用 `result: null` 确认，不能把缺失响应当作成功。真实 HTTP/SSE 与失败信封回归见 `tests/transport.test.ts`。

## 职责

- `POST /api/session-host` JSON 请求
- `GET /api/session-host/follow` SSE
- `GET /api/session-host/control` SSE
- 暴露 list/state/page/projections/rename/create/fork/selectModel/models/prompt/cancel/updateQueue/claim/follow/control
- `createOfficialSessionGateway()`：官方 `session/<method>` 信封客户端（第 1 个迁移命名空间）
- `createOfficialWorkspaceGateway()`：官方 `workspace/<method>` 信封客户端，并提供 `workspace/follow`（第 2 个迁移命名空间）
- `openWireStream()`：`/api/remote.mux` logical stream 浏览器 carrier（`session/follow`、`session/control`、`workspace/follow`）
- `session/page` / `session/prompt` / `session/fork(atSeq)` 的官方 envelope 客户端

## 边界

这是 transport seam，不是官方 session-controller client，也不伪造 UI。
后续官方 `api-session-controller` client 将消费这个 transport。

## 验证

```bash
pnpm check:session-client
pnpm check:workspace
```

## 官方 Remote seam

实际应用通过 `@dsh-base/client-session-adapter` 提供 Host 接缝，官方会话控制器负责生命周期。
本包的 `remote-stream` 直接复用官方 `RemoteStream`，只区分物理载体故障与业务/协议错误。
已移除从未挂载的旧 `createOfficialSessionRemote` 占位实现；不导出空成功的命令/子代理接口，
也不使用固定游标或自写单代迭代器冒充官方会话状态和恢复协议。

## 官方 session RPC gateway

`createOfficialSessionGateway()` 按官方生成的 Remote 契约发送
`{ type: "client-request", payload: { args } }`：

- endpoint 前缀：`/api/session/<method>`
- Connection 插件可用时经 `connection.rpc.call("/api", endpoint, payload)` 发送；
  Connection 尚未激活时使用同源 `fetch`（仍然是官方信封）
- 方法：`list / state / projections / create / fork / rename / selectModel /
  modelCatalog / cancel / page`
- `page` 接收 `throughSeq`、`beforeSeq`、`maxMessages` 与 `turnWindow`，返回共享
  稠密 journal 上的官方 `{ records, hasMore }` 页
- `isOfficialEndpointUnavailable()` 只把“端点不存在”归类为可回退；业务错误和
  已受理后的 carrier 错误不会回退
- `SESSION_REMOTE_ENDPOINTS` / `SESSION_REMOTE_DESCRIPTOR` 暴露已桥接的方法清单

自定义 `/api/session-host` transport 保持不变；`session-adapter` 在官方端点不可用时
回退到它。提示词/claim 与 `fork` 仍走自定义 transport；direct-subagent 历史也保留
自定义 `page` 读取（桥只服务普通 Session 地址）；`follow`/`control` 使用
`/api/remote.mux` 流，并以自定义 SSE transport 作为回退。原因见
`docs/typed-remote-mapping.md`。

## 官方 workspace RPC gateway

`createOfficialWorkspaceGateway()` 复用同一官方信封与 Connection/fetch 选择逻辑：

- 方法：`create / initializeDefault / rename / delete / insertBefore /
  insertSessionBefore / archiveSession / unarchiveSession / pinSession /
  unpinSession`
- 载荷遵循官方生成契约：`{ args: { request } }`，`initializeDefault` 为 `{ args: {} }`
- `follow(signal)` 消费 `/api/remote.mux` 的 `workspace/follow` logical stream，
  帧类型为官方 `baseline` / `replace` / `upsert` / `remove` / `order` /
  `archived` / `pinned`
- `WORKSPACE_REMOTE_ENDPOINTS` / `WORKSPACE_REMOTE_DESCRIPTOR` /
  `WORKSPACE_FOLLOW_ENDPOINT` 暴露已桥接的方法与流清单
- `isOfficialEndpointUnavailable()` 同样只把“端点不存在”归为可回退

`session-adapter` 的 `remote.workspace.*` 先走官方端点，仅在端点不可用时回退到
自定义 `/api/session-host`；`follow` 只在流发出 baseline 之前失败时回退到轮询。


投影版本由 Host 的 SQLite 事务生成，与聊天事件游标独立。所有 baseline、控制帧、rename 回执和旧 SSE 接缝使用同一服务器版本；客户端不再用 `Date.now()` 构造序号，也不在收到快照后读取更新的 state 重算旧版本值。缺少真实版本的旧 Host 会明确失败。这个版本域仍不是官方统一事件日志的 consistent cut，保留为已登记兼容差异。

流恢复直接使用固定版本稳定导出的 `RemoteStream`，保留官方 Connection 代次、首帧确认、重启与取消规则。仅物理 WebSocket 丢失映射为 `RemoteStreamCarrierError`；Host 业务信封、无效 JSON 与不可序列化参数保持终止错误，不能借回退或重试掩盖。`tests/reconnect.test.ts` 用真实官方控制流、工作区流、Session 日志流及投影存储验证断线后的 baseline/游标恢复、旧投影拒绝、用户消息不重复、离线等待、有限重试和销毁。官方 Connection/Gateway 的真实握手集成另由客户端接缝测试覆盖。
