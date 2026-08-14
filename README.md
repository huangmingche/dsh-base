# dsh-base

DeepSeek Harness Base 的 Cloudflare Workers 面（上游 `dsh-0.1.0-rc.6`）。

本版本在 rc.5 的静态与认证面之上新增：**Durable Object 会话宿主**（`SessionHostObject`，单 DO 单会话，DO SQLite 持久化）、`/api/session-host` 方法面（create/append/list/state/page）与 rc.6 会话持久化后端的标记 fork（`dshBase.forkOf: @deepseek-ai/dsh-session-persistence-sqlite`，只替换 `node:sqlite` 边界）。

**模型**：`prompt` 在配置 `DEEPSEEK_API_KEY` 时走官方 DeepSeek HTTP API 发一轮真实请求并把 turn 事件落库；未配置时明确返回 501 `model_not_configured`，provider 失败返回 502 并记下错误 turn，不伪造回答。本轮不含工具循环。

**边界**：官方客户端 shell（`client-runtime`/`layout`/`conversation`）仍未接入；真实出词需在带 key 的部署上验证。

## 运行

```bash
pnpm install
pnpm check      # 构建 + strict tsc + 18 条测试（表面 9 / 持久化语义 5 / DO 3 / Worker 转发 1）
```

认证环境变量：`AUTH_USERNAME`、`AUTH_PASSWORD_SHA256`、`AUTH_SECRET`。
