# apps/web

简体中文 | [English](README.en.md)

DSH Base 的通用 Web 入口，使用 Cloudflare Workers 部署官方 DSH Web UI。应用仅负责入口、部署配置和插件组合；功能实现位于仓库的 `packages/`。

## 组合与源码

- `src/client/main.tsx` 将 `virtual:dsh-composition` 交给客户端启动 seam，复用官方 BootPage、加载器和挂载流程。清单来自插件元数据与 `composition.profile.json`。
- Worker、Think 清单由根目录的 `scripts/composition/generate-worker-composition.mjs`、`generate-agent-composition.mjs` 生成；生成文件不提交。
- 三个生产清单统一读取 `scripts/composition/metadata-roster.mjs`：客户端由包元数据、profile 与官方库存生成，Worker/Think 由包元数据生成。`packs/` 只负责能力分组和 L1 管理范围，`check:packs` 独立校验其与生产清单逐行一致。
- 浏览器启动和传输支持库位于 `packages/boot/`，标记 `dshBase.boot.kind: browser-support`；它们仍受客户端依赖边界和严格类型检查约束。`packages/client/` 中的包均为真正的客户端插件。
- 官方源码只从锁定的 `.submodules/deepseek-harness` 读取。未启用的官方插件保留在清单中，不绑定可执行模块。
- `window.__DSH_BASE_PLUGINS__` 将真实 Loader fiber 状态与声明的来源、替换关系合并；清单中的存在不等于已经激活。
- 官方插件优先原样挂载；需要源码入口的 seam/fork 在包元数据中记录用途、exports 和上游审查 commit。

插件页按 `packs/` 中的功能分组展示应用 profile 与包元数据选用的组件，同时列出固定版 DSH 的内置设置和可选插件。尚未适配的插件保留官方名称、图标与说明，操作入口置灰并说明原因。“设置 → 内置插件”列出完整的运行时清单及各条目的可用状态。

其中新增的 14 个 SaaS 功能包包含 28 个运行时组件，每包各一个 Client 与 Worker：Waffo Pancake 支付、邮件、Google 登录、账号资料、用户管理、API 密钥、套餐权限、文件、订阅邮件、联系表单、通知、Crisp 客服、KV 缓存和运营面板。这些能力已实现并有本地 Worker 与浏览器验收；外部供应商默认关闭，启用组合不等于已配置供应商，受控测试也不证明真实支付或邮件送达。账号、管理、API 密钥和文件复用现有认证、D1 与 R2；管理员操作仍由部署名单授权。配置与验证边界见 [SaaS 插件说明](../../docs/saas-plugins.md)。

侧栏“更多”使用标记的官方 `ui-entry-customization` 可用状态 fork，保持原版布局和交互，仅保留“浏览更多插件”和“创建你的插件”。自有的关于、支持和环境行已按用户要求撤下；`client-shell-extras` 仍保留为禁用清单。`client-site-config` 由侧栏品牌与站点配置编辑器使用，从公开接口读取统一配置，不恢复自定义菜单。

插件目录的未适配状态使用明确的 `deploymentAvailability: "not-adapted"`，与真实错误分离。官方列表没有单项可用性标签扩展槽，因此由完整、标记来源的 `@dsh-base/client-plugin-manager` fork 仅适配该 Host 契约：列表使用与内置设置相同的灰色“不可用”，不重复红色 OS 原因与“未安装”；详情保留安装事实和部署限制。真实加载、元数据或请求错误继续显示原版错误状态。此呈现差异已由用户明确批准；原版管理插件保留为禁用库存，无可执行 resolver。

## Host 与存储

Better Auth 1.7.18 使用 `AUTH_DB` D1；HTTP 认证限流通过原生数据库后端原子计数，在 Worker 实例与重启之间共享预算，数据库故障时拒绝认证。`AUTH_SECRET` 是部署密钥，`AUTH_BASE_URL` 必须匹配公开来源。邮件验证、密码重置和 Google 登录已实现，但邮件与 Google 供应商默认关闭；配置完整后才开放相应入口，未配置时保留可见的禁用控件。强制邮件验证需显式启用，启用后不会因邮件不可用而跳过验证。

Session Host 为每个用户使用稳定的 `owner:<userId>:default-v49` Durable Object 身份，保存会话目录、工作区、设置与任务。Think 维护执行账本；请求标识、单会话串行化与恢复协议协调两者。代码更新不得通过修改存储身份绕过迁移。旧数据迁移校验、快照与 sidecar 成功后才原子提交完成标记。

`FILES` R2 保存工作区文件版本；`CREDENTIALS_KEY` 加密每用户凭据。模型由 Think 的 AI Gateway 插件提供。完整的官方会话权限运行时、进程/PTY、日志上传等未实现能力保留官方可见控件，并以本地化禁用状态说明限制。

英文使用裸路径 `/`，中文使用 `/zh-CN`（其余六种语言用裸 id `/ja`、`/es`、`/fr`、`/de`、`/pt`、`/ru`）；前缀规则由共享模块 `@dsh-base/locale-path` 单点生成，`/zh` 已退役为普通路径，大小写变体 301 到规范形式。官方 locale 运行时决定 UI 语言，URL 与 SEO 插件负责地址及公开页面元数据。

## SEO 与站点资产

页面 HTML 由 `@dsh-base/cloudflare-worker-seo` 负责；sitemap、robots、manifest、llms 分别由同名前缀的独立 Worker 插件负责，共用 `@dsh-base/site-seo` 与 siteSettings 配置。HTTP 插件按显式请求优先级分发：认证 0、站点配置 10、SEO 20、普通 API 100、静态资源 1000；异步插件激活先后不会改变路由顺序。


- 公开首页提供规范网址、八种语言版本的链接、社交分享信息，以及 `WebSite` 和 `Organization` 结构化数据。下游页面只链接到提供方登记的译文。登录页和私有页面使用 `noindex`，省略 canonical、Open Graph 和 JSON-LD。
- `/manifest.webmanifest` 提供本地化启动地址。生产环境启用收录后，`/sitemap.xml` 列出已发布且可收录的页面，`/robots.txt` 提供 sitemap 地址。Staging 的 sitemap 为空，robots 省略该地址。
- 站点事实统一来自站点配置 Worker 服务：D1 已保存文档优先；未保存时采用 `deployment.local.json` 的 `seo` 和旧品牌/链接字段，再采用包内默认。编辑保存严格校验，不将无效输入静默替换为默认值；数据库故障返回 503，避免已保存配置意外回退。
- 默认十件资产在 `apps/web/public/`，通过 `node scripts/assets/generate-site-assets.mjs` 从固定版 DSH 稳定导出的 `FISH_LOGO_PATH` / `FISH_LOGO_VIEWBOX` 生成，与侧栏共用小鲸鱼形状。网页默认仅声明官方黑白透明 SVG 主题配对，不混入无主题条件的 ICO/PNG 候选。ICO 和 16/32 PNG 保留为透明黑色文件，供直接访问及自定义配置使用；显式自定义资源仍保留。安装图标保留独立底板。资产包含黑白 SVG、ICO、16/32 PNG、Apple touch、192/512、maskable 512 与分享图片。`pnpm check:site-assets` 检查来源、尺寸和产物哈希；默认资源 URL 带内容版本，避免继续显示旧图标。自定义图标路径和查询参数保留原值。
- 缺失资产由 assets 插件返回真实 404：命中扩展名白名单且 ASSETS 回 404 或 `text/html` 时绝不再把 SPA 壳当图片/字体/manifest。

验收：`pnpm check:seo`、`pnpm acceptance:seo-local`、`node apps/web/scripts/acceptance-locale-routes-local.mjs`（301/noindex 无回归）。

## Dsh-base 全局

“插件 → Dsh-base 全局”使用官方插件详情的配置槽与 SettingsForm，编辑站点名称、公开链接、八种语言的页面信息、图标和分享图片、manifest、robots、sitemap、llms.txt 与 Google Analytics。各组件通过官方行配置槽打开自己的分项表单，汇总编辑仍保存同一版本文档。`packs/global/pack.json` 列出负责品牌、公开配置、页面登记、站点存储与 SEO 的组件。AI 预设、模型、附件和子代理归入 AI 对话；语言、导航与权限等保留在基础功能。

所有登录账号可查看配置，只有部署配置 `siteAdminUserIds` 中的真实账号 ID 可保存。首次授权应先从账号数据库核验用户名对应的不可变 ID，再配置此列表；空列表不授予任何人权限。`DSH_SITE_ADMIN_USER_IDS` 可用 JSON 数组覆盖该字段。管理员名单只传入 Worker，不出现在公开接口或可编辑文档中。

`GET/PUT /api/site-settings` 使用登录会话和同源校验。保存携带 `expectedRevision`，D1 单语句比较并更新；冲突返回 409 并保留本地草稿。公开 `/api/site-config`、服务端 HTML、图标链接、manifest、robots 和 sitemap 以及 llms.txt 和统计配置都读取同一文档。保存后编辑器刷新侧栏名称和本地化浏览器标题，标题仍由官方组件按原会话规则组合；图标等 head 资源在下次页面加载时更新，其他浏览器下次读取时使用新值。登录页和会话页同样使用配置图标与 manifest，但保持 noindex 且不输出公开 canonical/OG。复用现有 AUTH_DB 的单行表，按需要读取，无后台轮询或新增常驻服务。

部署前运行 `pnpm --dir apps/web schema:plugins`，应用站点设置及 SaaS 插件自带的可重复执行建表与增量字段语句；新增字段前检查现有列，保留已有数据。常规 `pnpm deploy` 在检查通过后自动执行。全新模板先运行原认证迁移。`pnpm acceptance:global-settings-local` 使用真实构建 Worker、Better Auth 与隔离 D1 验证管理员保存、普通账号拒绝和公开输出一致性。

独立插件清单、与 mkfast 的源码对比、Google Analytics 可选密钥配置及统计边界见 [SEO 插件说明](../../docs/seo-plugins.md)。

## 部署与可观测性

Worker 的 `observability` 同时开启 `traces` 与 Workers Logs（`logs.enabled: true`），用 invocation 日志为部署验收提供原始请求/子请求证据（例如「平台关闭时零出站」）。Workers Logs 按事件计费，会随请求量产生日志成本；不需要时把 `logs.enabled` 改为 `false` 再部署即可关闭。注意当前 cf/config 版本不接受 wrangler 的 `invocation_logs` 字段（`cf deploy --dry-run` 会报 `Unrecognized key`），只认 `logs.enabled`。

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
- `acceptance:browser-compat` 验证真实 PDF.js/Excel Worker、字体、样式、预览错误和中英文注册策略提示。Excel 验收包含官方 XLSX 兼容样例、从工作区完整读取超过 1 MiB 的表格，以及浏览器产物附带的许可声明。
- `CHROME_PATH` 可指定 Chromium。`DSH_LOCAL_COMPATIBILITY_DATE` 只覆盖本地模拟器日期；`acceptance:local` 为当前本机 workerd 默认采用 `2026-10-30` 并在证据中记录，也可显式覆盖。部署配置仍为 `2026-11-06`。

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

默认 Web 应用每次部署到 Staging 后会自动验证本次发布的 Worker 版本。准备专用验收账号，将 `base`、账号凭据和两个既有工作区的 `workspaceIds` 写入私有账号文件（`DSH_ACCEPTANCE_CONFIG` 或根目录 `.artifacts/acceptance/review-account.json`），每个工作区需有可复用的空会话。浏览器实际双向切换、刷新、退出并重新登录，逐步核对完整地址与服务端会话归属。手动复验使用 `DSH_EXPECTED_DEPLOYMENT_VERSION=<本次版本 UUID> pnpm acceptance:cross-workspace-deployed`。

上线后的模型调用与传输恢复另由根命令 `pnpm acceptance:host`、`pnpm acceptance:browser` 验证；这些命令面向配置的真实部署，不能用本地无模型验收代替。

### 模板配置与首次部署

根目录 `pnpm template:init --worker-name my-dsh-app --auth-base-url https://真实域名` 生成被忽略的 `deployment.local.json` 和仅限本机开发的随机密钥。配置文件及 `DSH_*` 环境变量由 `scripts/deployment-config.mjs` 验证，环境变量优先；未知字段（包括密钥）会被拒绝。配置不会继承本项目维护者的资源。

1. 在自己的 Cloudflare 账号创建 D1 数据库和 R2 bucket，把名称与 D1 id 填入配置。已有部署必须保持 Worker 名称、资源 id 与 `default-v49` 身份稳定。
2. 设置真实 HTTPS `authBaseUrl`；如使用平台提供商，配置自己的 Gateway 中 DeepSeek provider 凭据，填写 `aiGatewayId` 并明确设置 `platformAiEnabled: true`。否则保持关闭并使用用户 BYOK。
3. 通过 Cloudflare 的秘密管理准备 `AUTH_SECRET`（至少 32 字符）、`CREDENTIALS_KEY`（32 随机字节的 Base64）、`AUTH_REGISTRATION_TOKEN` 与 `PLUGIN_CONTROL_TOKEN`（各至少 32 随机字符）。不要将密钥写入 JSON 部署配置、仓库或客户端。
4. 在 `apps/web` 执行 `pnpm exec cf d1 migrations apply <自己的D1-id> --dir migrations`，然后执行发布门禁及 `pnpm schema:plugins`。首次部署可将独立生产密钥放入受限权限的 Git 忽略 JSON 文件，执行 `pnpm run deploy:prebuilt --secrets-file /绝对路径/生产密钥.json`。`--prebuilt` 只发布刚验证的产物；不能跳过前面的门禁与数据库准备。
5. 后续 `pnpm deploy` 会先验证部署配置并重跑发布门禁。新增密钥用 Cloudflare CLI 管理；不要轮换 `CREDENTIALS_KEY` 来解决代码部署问题，否则旧 BYOK 数据无法解密。

公开 `GET /api/auth-policy` 返回安全的能力状态：注册开关、邮件供应商与启用/就绪状态、密码重置、邮件验证及强制验证策略，以及 Google 登录、用户管理和 API 密钥扩展的可用性；不返回密钥或管理员名单。这些状态不授予私有数据或管理权限。关闭注册时，管理员可向标准 `POST /api/auth/sign-up/email` 添加 `x-dsh-registration-token` 创建首个/审查账号；该 token 仅用于运营脚本，不能交给浏览器 UI。普通账号不能更改全局插件组合；写入同时要求登录与 `PLUGIN_CONTROL_TOKEN`。跨来源的修改请求和 WebSocket 升级均被拒绝。历史公开共享验收账号已停用，数据保留。

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

仓库 CI 缓存根目录唯一锁文件，在根目录执行一次 `pnpm install --frozen-lockfile` 和 workspace 依赖审计，初始化锁定子模块。常规 CI 运行构建与真实本地验收；涉及 UI、Host、组合或依赖的 PR 另外自动运行完整 `verify:release`（含官方组件对照与浏览器兼容检查），也支持手动触发。不读取部署密钥、不部署、不调用付费模型。构建将完整许可清单保存在 `.artifacts/distribution/web/third-party-notices.txt`，浏览器资源随附其适用的许可声明。

插件分类数量由独立 `@dsh-base/client-plugin-counts` 插件提供；应用不实现计数功能。浏览器对照用例通过官方 `configLedgerSource` 连接真实配置插槽，稳定 client 入口未导出该值，因此使用已登记的 `./src/*` 导出，并随官方 pin 升级复查。计数之外的页面继续与固定版本官方界面对照。

侧栏登录态/未登录态回归：`pnpm acceptance:sidebar-parity` 对照固定版官方界面的中英、明暗和三种宽度；`pnpm acceptance:anonymous-sidebar` 在本地隔离 Worker 验证八种语言的访客登录页及零私有请求。部署后使用显式 `DSH_BASE_URL` 重跑匿名验收，使用专用账号运行 `pnpm acceptance:authenticated-sidebar`，确认真实目录读取可用且不修改会话或设置。
