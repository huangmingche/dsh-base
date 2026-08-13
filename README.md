# dsh-base

DeepSeek Harness Base 的 Cloudflare Workers 最小面（上游 `dsh-0.1.0-rc.5`）。

本版本只包含 rc.5 当时能成立的 Workers 主干：Worker 入口、薄路由、静态资源、最小 cookie 认证。上游 rc.5 没有会话持久化包，也没有可在 Workers 上运行的 `host/webserver`，所以**会话宿主、模型接线和官方客户端 UI 留到下一个版本**；客户端入口目前只做会话状态回显与退出登录。

## 运行

```bash
pnpm install
pnpm check      # 构建客户端与 Worker、严格类型检查、9 条冒烟
node scripts/serve.mjs   # 可选：本地起 Worker
```

认证由部署环境变量提供：`AUTH_USERNAME`、`AUTH_PASSWORD_SHA256`、`AUTH_SECRET`。未配置时登录页保持可见但禁用，并给出原因。
