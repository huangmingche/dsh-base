# apps/web

简体中文 | [English](README.en.md)

DSH Base 的通用 Web 入口，使用 Cloudflare Workers 部署官方 DSH Web UI。应用仅负责入口、部署配置和插件组合；功能实现位于仓库的 `packages/`。

## 组合与源码

- `src/client/main.tsx` 将 `virtual:dsh-composition` 交给客户端启动 seam，复用官方 BootPage、加载器和挂载流程。清单来自插件元数据与 `composition.profile.json`。
- Worker、Think 清单由根目录的 `scripts/composition/generate-worker-composition.mjs`、`generate-agent-composition.mjs` 生成；生成文件不提交。
- 官方源码只从锁定的 `.submodules/deepseek-harness` 读取。未启用的官方插件保留在清单中，不绑定可执行模块。
- `window.__DSH_BASE_PLUGINS__` 将真实 Loader fiber 状态与声明的来源、替换关系合并；清单中的存在不等于已经激活。
- 官方插件优先原样挂载；需要源码入口的 seam/fork 在包元数据中记录用途、exports 和上游审查 commit。

## Host 与存储

Better Auth 使用 `AUTH_DB` D1，当前限流为按实例的内存限流。`AUTH_SECRET` 是部署密钥，`AUTH_BASE_URL` 必须匹配公开来源。未启用邮件验证、密码重置和 Google 登录。

Session Host 为每个用户使用稳定的 `owner:<userId>:default-v49` Durable Object 身份，保存会话目录、工作区、设置与任务。Think 维护执行账本；请求标识、单会话串行化与恢复协议协调两者。代码更新不得通过修改存储身份绕过迁移。旧数据迁移校验、快照与 sidecar 成功后才原子提交完成标记。

`FILES` R2 保存工作区文件版本；`CREDENTIALS_KEY` 加密每用户凭据。模型由 Think 的 AI Gateway 插件提供。完整的官方会话权限运行时、进程/PTY、日志上传等未实现能力保留官方可见控件，并以本地化禁用状态说明限制。

英文使用 `/`，中文使用 `/zh-CN`。官方 locale 运行时决定 UI 语言，URL 与 SEO 插件负责地址及公开页面元数据。

## 开发与验收

仓库根目录统一管理 pnpm workspace，成员为本应用和 `packages/build/dsh-base-build-server-dependencies`。所有依赖只使用根目录 `pnpm-lock.yaml`，一次冻结安装覆盖根工具和两个成员。在仓库根目录执行：

```sh
pnpm dsh:init
pnpm install --frozen-lockfile
pnpm dsh:verify
pnpm check
pnpm --dir apps/web build
pnpm acceptance:local
pnpm acceptance:parity
pnpm acceptance:browser-compat
```

- `build` 必须先通过根检查，再生成清单与构建产物。
- `acceptance:local` 从构建产物启动隔离的本地 D1/R2/Durable Objects，在 Chromium 中检查认证、真实插件状态和中英文界面，不使用线上数据或模型服务。证据写入根目录 `.artifacts/acceptance/local-ui/`。
- `acceptance:parity` 对照锁定的官方组件，比较渲染文本、控件、布局、截图与交互契约；覆盖范围见 [对照说明](tests/parity/README.md)。证据写入 `dist/parity-evidence/`。它使用受控 Host，不代替真实 Host 验收。
- `acceptance:browser-compat` 验证真实 PDF.js/Excel Worker、字体/数据资源、样式和错误状态，并检查中英文注册策略提示。
- `CHROME_PATH` 可指定 Chromium。`DSH_LOCAL_COMPATIBILITY_DATE` 只覆盖本地模拟器日期；若本机 workerd 落后于部署日期，必须显式设置并在证据中保留实际日期。本次本机运行使用 `2026-10-30`，部署配置仍为 `2026-11-06`。

```sh
DSH_LOCAL_COMPATIBILITY_DATE=2026-10-30 pnpm acceptance:local
```

完整现状与未完成差异见 [完成状态](../../docs/completion-status.md)、[运行契约](../../docs/runtime-parity.md)。组件清单覆盖和局部截图一致均不能证明整个产品达到 100% UI/UX 或执行语义等价。

## 部署

`cloudflare.config.ts` 是 Worker、D1、R2、Durable Object、兼容日期及非密钥配置的来源。密钥由 Cloudflare 管理，不提交到仓库；部署环境需配置 Cloudflare API 授权、认证密钥、凭据密钥及模型 Gateway，并应用 `migrations/` 中的 D1 迁移。

```sh
cd apps/web
pnpm verify:release   # 根检查、构建、本地浏览器和官方组件对照
pnpm deploy           # 重跑发布门禁，然后 cf deploy --prebuilt
```

上线后的模型调用与传输恢复另由根命令 `pnpm acceptance:host`、`pnpm acceptance:browser` 验证；这些命令面向配置的真实部署，不能用本地无模型验收代替。

### 模板配置与首次部署

根目录 `pnpm template:init --worker-name my-dsh-app --auth-base-url https://真实域名` 生成被忽略的 `deployment.local.json` 和仅限本机开发的随机密钥。配置文件及 `DSH_*` 环境变量由 `scripts/deployment-config.mjs` 验证，环境变量优先；未知字段（包括密钥）会被拒绝。配置不会继承本项目维护者的资源。

1. 在自己的 Cloudflare 账号创建 D1 数据库和 R2 bucket，把名称与 D1 id 填入配置。已有部署必须保持 Worker 名称、资源 id 与 `default-v49` 身份稳定。
2. 设置真实 HTTPS `authBaseUrl`；如使用平台提供商，配置自己的 Gateway 中 DeepSeek provider 凭据，填写 `aiGatewayId` 并明确设置 `platformAiEnabled: true`。否则保持关闭并使用用户 BYOK。
3. 通过 Cloudflare 的秘密管理准备 `AUTH_SECRET`（至少 32 字符）、`CREDENTIALS_KEY`（32 随机字节的 Base64）、`AUTH_REGISTRATION_TOKEN` 与 `PLUGIN_CONTROL_TOKEN`（各至少 32 随机字符）。不要将密钥写入 JSON 部署配置、仓库或客户端。
4. 在 `apps/web` 执行 `pnpm exec cf d1 migrations apply <自己的D1-id> --dir migrations`，然后执行发布门禁。首次部署可将独立生产密钥放入受限权限的 Git 忽略 JSON 文件，执行 `pnpm exec cf deploy --prebuilt --secrets-file /绝对路径/生产密钥.json`。`--prebuilt` 只发布刚验证的产物；不能跳过前面的门禁。
5. 后续 `pnpm deploy` 会先验证部署配置并重跑发布门禁。新增密钥用 Cloudflare CLI 管理；不要轮换 `CREDENTIALS_KEY` 来解决代码部署问题，否则旧 BYOK 数据无法解密。

公开 `GET /api/auth-policy` 只返回注册是否开放。关闭注册时，管理员可向标准 `POST /api/auth/sign-up/email` 添加 `x-dsh-registration-token` 创建首个/审查账号；该 token 仅用于运营脚本，不能交给浏览器 UI。普通账号不能更改全局插件组合；写入同时要求登录与 `PLUGIN_CONTROL_TOKEN`。跨来源的修改请求和 WebSocket 升级均被拒绝。历史公开共享验收账号已停用，数据保留。

### 部署后验收

远程脚本不再默认选择任何服务器或共享账号。明确设置 `DSH_BASE_URL` 与私有账号，或用管理员令牌运行 `pnpm acceptance:provision` 创建隔离账号。脚本把凭据写入根目录 `.artifacts/acceptance/` 的权限受限文件，只输出路径。

```sh
# 在根目录；AUTH_REGISTRATION_TOKEN 从本机秘密管理注入。
DSH_BASE_URL=https://真实域名 pnpm acceptance:provision
DSH_ACCEPTANCE_CONFIG=/脚本输出的绝对路径.json DSH_EXPECTED_DEPLOYMENT_VERSION='本次部署返回的实际UUID' pnpm acceptance:all
DSH_ACCEPTANCE_CONFIG=/脚本输出的绝对路径.json DSH_EXPECTED_DEPLOYMENT_VERSION='本次部署返回的实际UUID' pnpm acceptance:files
```

将版本占位符替换为本次部署命令返回的 UUID。模型验收先只读检查 Host 的实际部署版本及生命周期能力，精确匹配后才提交模型输入；最多等待 360 秒处理 Durable Object 的延迟代码升级。省略版本变量只验证能力，不能证明本次部署已生效。

`acceptance:files` 验证官方上传、会话凭据原子消费与重放、跨会话拒绝、文件历史和完整字节校验；通过一次真实模型调用，证明读取工具可访问预览截断位置之后的内容。

这些验收会在指定账号中创建会话、工作区及测试文件，部分流程调用真实模型，因此只对专用账号运行。普通运行不自动注册；确需脚本内注册须明确设置 `DSH_ACCEPTANCE_REGISTER=true` 与管理员令牌。日志、截图、配置、密钥及构建产物均不提交。

仓库 CI 缓存根目录唯一锁文件，在根目录执行一次 `pnpm install --frozen-lockfile` 和 workspace 依赖审计，初始化锁定子模块并运行同一 `verify:release` 门禁；不读取部署密钥、不部署、不调用付费模型。部署资源带 `/third-party-notices.txt` 保留上游及依赖许可。
