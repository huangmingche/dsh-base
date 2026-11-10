# AGENTS.md

## 产品定位与范围

DeepSeek Harness Base（`dsh-base`）是基于 DeepSeek Harness 的 SaaS 代码模板，供用户构建各类 AI 应用。

模板的能力范围包括 AI、认证、支付、数据库、存储、邮件、订阅邮件、博客、仪表盘和 SEO 等，统一通过 DSH 插件组合，并部署在 Cloudflare Workers 上。

- **运行与部署**：使用 Cloudflare Workers 和 Cloudflare Think，持久化、存储等基础设施使用 Workers 原生 Cloudflare 服务。应用必须始终能够完整部署在 Cloudflare Workers 上。禁止引入 Cloudflare Containers 或同类依赖容器、虚拟机的应用运行时，也不得将其作为上游 DSH 能力的后备实现。
- **成本是架构约束**：尽量降低持续的基础设施和运营成本，优先采用按用量计费、按需运行的 Workers 原生服务，避免常驻计算和不必要的基础设施。新增能力时必须考虑请求、存储、后台任务及 AI 推理成本。
- **能力范围与交付状态**：各项能力必须遵循下文的官方复用协议和插件组合规则。能力范围不代表所有列出的能力都已交付；文档和界面必须明确区分已实现且已验证、计划中以及不可用的能力。

本项目是 DSH 产品的可部署应用底座。上游 DeepSeek Harness 固定在 `.submodules/deepseek-harness` 的官方发布版本，自有应用和包位于 `apps/` 与 `packages/`。上游是依赖，禁止修改其检出源码；必须固定到官方发布标签，而不是 master 分支的最新提交。产品变更归属于自有应用和包。

## 一切皆插件

遵循上游 Everything is a Plugin（一切皆插件）原则：自有应用的全部功能，通过组合和管理官方 DSH 插件及自有 DSH 插件交付。应用只作为入口，不承载功能逻辑。新增能力必须作为插件及其组合条目交付，禁止直接向应用入口添加功能代码。

下游业务仓库遵循本文件的[下游产品规范](#downstream-products)。本文件是初始化、插件开发、配置、验证、更新和回退的唯一规范来源。README 和旧指南只链接到这里，不得另行维护这些流程的副本。

## 官方 UI/UX 一致性（最高产品规则）

dsh-base 必须以 **100% 保真度**还原官方 DeepSeek Harness Web UI 和 UX，包括布局、侧边栏、右侧边栏、对话与轨迹视图、输入区、模型与思考强度及权限控件、设置、面板、各种状态、空态、错误态、加载态、本地化和交互行为。以官方 DSH UI、插件和插槽为准；已有官方 UI 时，禁止自行设计、简化、隐藏或用自定义 UI 替代。

- 官方 UI 能力无法在当前 Workers 原生部署中挂载或实现时，必须保留可见入口，置灰或禁用，并提供本地化说明。禁止隐藏不可用的官方控件、移除其入口或伪造行为。
- 兼容适配层（seam）和派生包（fork）只能适配 Host 服务与数据，必须保留官方视觉和交互契约。只有官方实现无法使用，且没有可派生的官方组件时，才允许自定义后备实现，并在 `dshBase.reuse` / `dshBase.forkOf` 中记录。
- 所有偏离官方 UI/UX 的地方都必须作为差距跟踪，记录在组合元数据或包的复用元数据中；能呈现为禁用状态的应呈现，并保持可审查。保留任何有意的视觉或行为偏差，必须获得用户明确批准。
- 验收必须对比实际渲染的界面与交互是否符合官方 DSH，不能只检查自有组件能否渲染。

## 官方复用协议（最高优先级）

每项能力都必须先执行本协议，再按下文的插件选择顺序实施。

- 官方 DSH 源码只能来自 `.submodules/deepseek-harness` 中固定的发布版本，直接读取已初始化的子模块。禁止修改其源码，禁止从其他检出目录、npm 或网页复制官方代码。
- 先查找官方包。优先原样挂载官方插件：将包条目加入组合，并通过兼容适配插件提供其声明的 Host 服务。
- 兼容适配层是自有的最小适配器，为官方插件通过 `inject` 声明的服务提供实现，或满足其插槽、配置契约。它不属于官方源码，也不是派生包，不得包含产品行为；必须标注并记录为兼容适配层。
- 只能复用官方包 `exports` 映射声明的接口。优先使用稳定入口（`.`、`/client`、`/remote`、语言 JSON）；只有稳定入口未导出所需组件或类型时，才可使用 `./src/*`，并记录以供固定版本升级时复审。禁止导入包未导出的文件。
- 官方插件无法挂载，且其已导出组件不足以满足需求时，按固定提交派生官方包。在 `dshBase.forkOf` 中记录上游包名、源码路径、提交和许可证；只适配 Host 接口，禁止将未标明来源的官方代码片段粘贴进自定义包。
- 只有不存在官方包、也没有可派生的官方导出实现时，才可实现自有插件。在 `dshBase.reuse` 中记录考察过的官方候选，以及无法挂载和派生的原因。
- 每个客户端、Worker、智能体包都必须在包元数据中记录复用决策。验收检查 `origin` 和实际激活的插件实例（fiber）；`pnpm check:reuse` 检查官方导出。每次变更上游固定版本，都必须重新审查派生包及 `./src/*` 的使用。

**插件选择顺序**：优先直接复用官方 DSH 插件；无法原样使用但可以派生源码时，派生官方包并适配；两条路径都不可行时，才实现自有插件。禁止在排查完官方插件及其派生路径之前直接自研。

## 文档语言

本文件及下游 `AGENTS.md` 模板统一使用简体中文；产品名、包名、路径、配置字段和命令保留原始写法。共享规范只维护本文件。

README 保持双语：`README.md` 使用简体中文，`README.en.md` 使用英文；相关变更必须同步更新两份文件。

## 源码、组合与运行面边界

上游 harness 仅位于 `.submodules/deepseek-harness` 参考子模块。`pnpm dsh:init` 负责初始化；`pnpm dsh:verify` 根据 `dsh-source.lock.json` 检查其 HEAD、源码树及工作区是否干净。应用直接从该子模块解析官方包，不使用需要复制或提交的生成源码覆盖层。

自有能力必须作为 DSH 插件交付：

- `packages/client/*` 是客户端插件包，必须包含 `dsh.client` 和 `dshBase.client` 元数据、`/client` 入口及 `Config` 配置校验 schema。客户端清单由这些元数据和所选应用的 `composition.profile.json`（默认 `apps/web/composition.profile.json`）生成到 Vite 虚拟模块 `virtual:dsh-composition`；禁止在应用中手写插件清单。
- `packages/cloudflare-worker/*` 是 Cloudflare Worker 插件包，命名为 `@dsh-base/cloudflare-worker-*`。`scripts/composition/generate-worker-composition.mjs` 根据 `dshBase.worker` 元数据生成被 Git 忽略的 Worker 清单；Worker 入口只启动该清单，并通过它分发每个请求。
- `packages/boot/plugin-loader-static` 是两端共用的静态插件加载器，提供 `entries`、`modules` 和插件清单。
- 仅供浏览器使用的启动、传输支持库位于 `packages/boot/*`，声明 `dshBase.boot.kind: "browser-support"`。它们不声明组合条目，也不独立交付产品功能；仍受客户端导入边界限制，禁止被 Worker、Think 或平台无关的共享包导入，并纳入严格的客户端类型检查。`packages/client/*` 下的每个包仍必须满足上述客户端插件契约。
- 智能体能力通过 `packages/cloudflare-think/dsh-base-cloudflare-think-*` 下的 Cloudflare Think 插件交付，包名为 `@dsh-base/cloudflare-think-*`。`scripts/composition/generate-agent-composition.mjs` 根据 `dshBase.agent` 元数据生成被 Git 忽略的清单，所选应用的 `src/agent/index.ts` 只负责启动它。

应用仅由入口和组合条目构成。能力变更必须落在插件包中，禁止写入应用入口。

`packs/` 对元数据和 profile 生成的组合进行分组，并声明哪些打包能力可由账号所有者管理；它不选择生产环境的插件清单成员。`pnpm check:packs` 独立对比每个 pack 的条目、字段和顺序是否与实际元数据、profile 清单一致。覆盖缺失或内容偏移必须阻断发布检查。

生成的客户端清单必须包含所有声明了 `dsh.client` 的官方包，未启用的官方条目标记为 `disabled: true`。禁用条目只用于展示清单，不执行代码；除非插件已经适配并启用，否则不得携带打包模块的解析器。派生包必须记录 `dshBase.forkOf` 和 `dshBase.client.replaces`；被替换的官方原包仍保留在清单中并禁用。

**命名规则**：Cloudflare 专用插件使用 `cloudflare-` 包名前缀（`@dsh-base/cloudflare-worker-*`、`@dsh-base/cloudflare-think-*`），组合 ID 使用 `cloudflare:worker:*` / `cloudflare:think:*`。客户端插件保持平台无关，包名使用 `@dsh-base/client-*`，组合 ID 使用 `client:*`。`apps/web` 是默认 Web 应用入口；其他 Web 应用按下文的多应用契约声明。

`pnpm check:boundaries` 强制检查运行面契约：客户端包禁止导入 Worker、Think、Node 或 Workers 模块；Worker 和 Think 包禁止导入浏览器、React 或客户端包；包的组合 ID 前缀必须符合所属运行面。

<a id="multi-application"></a>

## 多应用与终端范围

同一仓库可以声明多个 Web 应用，复用同一套插件源码。应用注册、构建与依赖同步属于构建支持，不作为新的运行时插件统计，也不得承载产品功能。当前支持的应用平台为 `web`，客户端仍遵循官方 DSH Web 插件契约。多个 Web 应用不代表已经交付原生 iOS、Android、桌面安装包或跨端登录；PWA 的 manifest 和图标也不代表离线、推送已经实现。新增终端必须单独设计 Host 服务、认证与传输契约，并继续执行官方复用和 UI/UX 一致性要求。

- 应用注册由仓库根目录 `dsh.apps.json` 管理，结构为 `{"version":1,"default":"web","apps":[{"id":"web","path":"apps/web","platform":"web"}]}`。缺少该文件的旧项目按默认 `web` 应用兼容。应用 ID、目录不得重复；路径必须属于本仓库的 `apps/`，禁止通过绝对路径、路径穿越或符号链接访问依赖源码及仓库外目录。不支持的平台必须明确报错。
- 每个应用只持有入口、自己的客户端 profile、依赖声明和部署配置，功能仍来自插件。应用 profile 不得修改共享包元数据；下游继续继承固定底座的默认组合，只配置业务自有客户端插件。Worker 和 Think 清单仍由共享包元数据生成，不按应用复制业务实现。
- 应用选择必须贯穿组合、静态资源、严格类型检查、构建与部署。默认应用保持既有行为；指定应用时，禁止回退到另一个应用的 profile、部署配置或旧生成文件。批量检查和构建应逐应用传递显式上下文，禁止修改进程全局选择后并发复用。
- 默认底座 `apps/web` 保留原有产物位置；下游默认 `web` 的生成文件保留在 `.artifacts/dsh`。其他应用的组合、资源及类型生成文件放在 `.artifacts/dsh/applications/<id>`，构建输出和本地 Cloudflare 状态归对应应用目录。生成文件不提交，不得写入任一级只读依赖，也不得回退读取其中的旧产物。
- `pnpm-workspace.yaml` 显式登记应用和必要的依赖隔离包。多个应用各自保留直接依赖与业务扩展，服务端 SDK 继续使用独立 peer 依赖环境；禁止用全量 workspace 通配或源码复制代替依赖解析。
- 多个 Web 部署共享的是插件源码，不自动共享账号、数据库或文件。每个部署使用独立的 Worker、D1、R2 标识、站点源和密钥。应用间账号互通、共用 API 服务或数据资源是独立能力，必须另行设计并验证权限，禁止通过放宽 CORS、取消鉴权或共享密钥实现。

### 新增与操作应用

以下命令在当前仓库根目录运行，适用于底座检出目录及新初始化的业务仓库：

```sh
# 新增 apps/admin；只生成入口、配置和独立本地密钥，不创建云资源。
pnpm dsh:app --id admin
# 可在新增时指定 --worker-name NAME 和 --auth-base-url URL。
pnpm install
pnpm dsh:prepare --app admin
pnpm dsh:check --all
pnpm build:all
```

新增器拒绝覆盖既有目录，并同步 `dsh.apps.json`、workspace 及适用的继承依赖契约。安装后审查锁文件，提交应用入口、公开配置和应用注册；`.dev.vars`、`deployment.local.json` 仍须忽略。`pnpm dsh:app` 不为应用添加通过验收的声明，也不启用注册、付费推理或外部服务。

`pnpm dsh:run <command>` 支持 `prepare`、`check`、`build`、`dev`、`deploy`。使用 `--app <id>` 选择应用；未指定时使用 `DSH_APP` 或注册文件的默认应用。构建配置传入的 `appRoot` 必须与所选应用一致，冲突时直接失败。`--all` 仅支持准备、检查和构建，逐个启动独立子进程；禁止用于开发或部署，也不能与 `--app`、`DSH_DEPLOYMENT_CONFIG` 或共享部署身份覆盖同时使用。

```sh
pnpm dsh:run build --app admin
pnpm dsh:run dev --app admin
# 下游原有命令同样可以选应用：
pnpm build --app admin
```

开发前按所选应用的实际地址配置其 `.dev.vars`。部署前必须完成该应用自己的实际 UI/UX 验收，并在其 `package.json` 声明 `verify:release`；缺少该脚本时部署失败，禁止用默认 Web 应用的截图或跳过检查替代。只有用户明确要求部署，且独立资源、真实站点源及 Worker Secrets 均已配置时，才执行 `pnpm dsh:run deploy --app <id>`。部署始终只处理一个应用。

旧业务仓库更新底座不会自动重写根脚本。缺少上述脚本时，从业务根目录直接运行 `node <base>/scripts/project/add-app.mjs --id admin` 或 `node <base>/scripts/project/run.mjs <command> --app admin`；`<base>` 以 `dsh.project.json.base` 为准。可以审查后添加对应脚本，不得重新运行初始化器。

默认 Web 应用每次部署到 Staging 后，必须对本次 Cloudflare 发布的准确版本运行跨工作区浏览器验收。复用隔离验收账号中的两个既有工作区及其空会话，双向切换，核对地址、会话归属，并验证刷新及同标签页退出后重新登录的完整回跳。发布命令必须传播验收失败。

底座的 `pnpm acceptance:multiapp` 在临时源码快照中新增第二个 Web 应用，验证独立 profile、生成产物、严格类型、Workers 构建、实际浏览器插件状态及匿名私有接口拒绝访问。它只读复用当前安装的依赖，不代表全新安装或远程部署验收；证据写入 `.artifacts/multiapp-acceptance`，临时应用在结束后删除。

## 公开内容、收录与商业化

- 底座默认对外提供工作台首页。完整的依赖、版本和许可清单只保存为非公开构建产物，浏览器资源随附其适用的许可声明。产品如需新增介绍、指南、法律或定价页面，应通过自己的 dsh 插件交付正文和样式，并向公开页面目录登记实际路径、访问权限、语言、发布状态及收录资格。页面与材料归提供它们的产品维护。
- 验收须核对匿名直接访问、实际正文、语言链接和收录状态。首页的各语言版本由底座提供，未登记的页面和缺少译文的地址应返回真实 404。
- 搜索收录默认关闭。只有部署配置明确设置 `indexing: { environment: "production", enabled: true }` 且 `authBaseUrl` 为实际 HTTPS 站点源时才启用。该源统一用于 canonical 和 sitemap；管理员不能另设冲突域名。Staging、开发和预览仍可浏览，但 HTML 为 `noindex`，sitemap 为空且 robots 不声明提交地址。登录页保留可抓取的 `noindex`，未知页面返回真实 404；robots 不是私有数据的权限边界。
- 套餐声明、展示价格与功能映射来自部署 `saas` 配置，禁止在客户端另写一套价格或权益。展示价格不代表已收款金额；支付权益和购买统计只依据已验签、服务端确认的支付结果。套餐在工作台的 Waffo Pancake 支付面板中展示。`saas.entitlementOperations` 只约束显式配置的付费操作，缺少映射时保留默认免费行为；受保护操作在服务端执行前重新检查，不以按钮状态或登录回跳结果代替校验。
- 转化统计默认关闭。`analytics.conversions.mode` 支持 `off`、第一方 `aggregate` 和可选 `google`；Google 转化还需要当前用户明确同意、已配置的服务及允许的活动标签。注册、激活和付款事件必须来自真实成功状态并去重；不得发送账号标识、私有会话、提示词或任意查询参数。管理员汇总不提供可靠独立访客、跨设备归因或完整 GA4 报表能力。

<a id="downstream-products"></a>

## 下游产品规范

可以直接把本仓库作为模板开发，也可以由独立业务仓库通过固定版本的 Git 子模块引用。需要持续接收底座更新的产品，应采用子模块模式。GitHub 的模板标记不负责依赖升级。

上述产品规则同样适用于下游业务插件。开始工作前，必须读取产品所固定的底座版本中的本文件，禁止用其他检出目录或更新分支的指南替代。生成的业务仓库 `AGENTS.md` 记录底座路径与命名空间，并明确要求读取本文件。业务特有要求留在业务仓库，共享流程在这里维护，使底座更新携带与代码匹配的规范。

本节的路径和命令均相对于**外层业务仓库**，明确标注位于底座内的除外。默认底座路径是 `.submodules/dsh-base`；已有产品以 `dsh.project.json.base` 为准。前文提到的官方源码路径，应解析到底座内部的 `<base>/.submodules/deepseek-harness`。

<a id="ownership-and-plugin-composition"></a>

### 所有权与插件组合

```text
my-product/
├── .submodules/dsh-base/              # 公共底座：固定提交，只读
│   └── .submodules/deepseek-harness/  # 官方 DSH：由底座固定发布版本
├── apps/web/                         # 默认应用的入口、profile、部署配置
├── apps/<id>/                        # 其他已声明的 Web 应用（按需新增）
├── packages/client/                  # 业务界面插件
├── packages/cloudflare-worker/       # 业务服务插件
├── packages/cloudflare-think/        # 业务智能体插件
├── packages/build/                   # 产品独立安装的构建依赖
├── packs/                            # 业务能力分组
├── dsh.project.json                  # 底座路径与业务命名空间
├── dsh.apps.json                     # 应用注册与默认应用
├── dsh.dependencies.json             # 继承的依赖契约快照
└── .artifacts/dsh/                   # 生成的组合、类型与资源
```

- 外层 gitlink（Git 记录的子模块提交）固定底座版本，底座的锁文件及嵌套 gitlink 固定官方 DSH 发布版本。必须保持两级依赖源码干净。禁止使用 `git submodule update --remote` 递归跟踪它们的分支。
- 业务代码、依赖安装、配置、密钥、缓存、生成产物和部署资源全部归外层仓库所有，禁止写入任一级依赖。公共修复应在独立的 dsh-base 检出目录中开发，发布新提交后，再更新业务项目的版本指针。应用只负责启动组合，禁止复制官方应用或向入口添加业务行为。
- `dsh.project.json` 的结构为 `{"version":1,"base":".submodules/dsh-base","namespace":"my-product"}`。必须使用独立的业务命名空间；共享库和构建支持包不因此成为运行时插件。

| 运行面 | 包名 | 组合 ID |
| --- | --- | --- |
| 客户端 | `@my-product/client-*` | `client:my-product:*` |
| Worker | `@my-product/cloudflare-worker-*` | `cloudflare:worker:my-product:*` |
| Think | `@my-product/cloudflare-think-*` | `cloudflare:think:my-product:*` |

- 使用固定的官方源码，执行前文的官方优先复用协议。保留适用的 `dsh.client`、`dshBase.client/worker/agent`、`Config`、exports 和复用、派生元数据。复用官方 UI 组件、主题和插槽；同时验证实际渲染与交互、元数据及激活的插件实例。
- 初版下游组合契约**只允许新增**。各应用的 `composition.profile.json` 继承底座默认组合，只配置产品自有的客户端条目。禁止覆盖底座标识、重新启用不可用的官方插件，或重复声明底座、官方条目。未来如需支持替换，必须单独设计、验证和验收其契约。
- 业务 pack 使用 `<namespace>:<name>` ID，只引用业务插件，可以依赖基础 pack。由部署配置管理，使用 `toggleable: "none"`；禁止重新划分底座插件或扩大底座的账号所有者管理白名单。未来如需支持账号级管理，必须单独验证和验收其契约。
- 普通第三方依赖声明在外层所选应用的 `package.json`，默认是 `apps/web/package.json`。现有服务端 SDK（`@cloudflare/think`、`agents`、`@cloudflare/computer`）在 `packages/build/product-server-dependencies` 中保留独立的 peer 依赖环境；扩大该隔离集合时，必须同步支持构建与类型解析。禁止把底座源码包加入产品 pnpm workspace，或手工修改继承的依赖约束来绕过依赖同步。
- 新的云资源绑定在外层 Cloudflare 配置中组合，基础绑定复用 `createDshCloudflareConfig`。对应行为必须放在 Worker、Think 插件中，禁止写进配置或应用入口。
- 生成文件的导入必须解析到产品自己的 `.artifacts/dsh`，禁止回退到基础源码内的过期文件。禁止编辑或提交生成产物。重复包名或 ID、跨运行面导入、跨包入口、底座分组改写及符号链接导致的输出路径逃逸，都必须校验失败。

<a id="initialize-or-clone-a-product"></a>

### 初始化或克隆业务项目

选中的底座提交必须已经包含 `scripts/project/init.mjs`；旧的 GitHub 模板提交不会自动获得该接口。新项目按以下步骤初始化：

```sh
mkdir my-product
cd my-product
git init
git submodule add https://github.com/huangmingche/dsh-base.git .submodules/dsh-base
# 可选择已审查的底座标签或提交，然后暂存对应的 gitlink：
# git -C .submodules/dsh-base checkout <base-tag-or-commit>
# git add .submodules/dsh-base
git submodule update --init --recursive
# 初始化前，选择符合 .submodules/dsh-base/package.json 中 engines.node 要求的 Node。
node .submodules/dsh-base/scripts/project/init.mjs --namespace my-product
```

Node 必须符合固定底座的 `package.json` → `engines.node` 要求，pnpm 使用生成的业务项目 `packageManager` 固定的版本。然后运行：

```sh
pnpm dsh:init
pnpm install
pnpm build
```

审查并提交业务源码、gitlink、依赖声明和 `pnpm-lock.yaml`，禁止包含本地配置或密钥。初始化器要求依赖源码干净，拒绝覆盖已有输出文件，并生成独立的本地密钥。注册、平台付费推理及外部服务默认关闭。初始化器不创建云资源，也不复制 Staging 的账号、管理员、资源标识或凭据。缺失的官方发布标签按锁文件精确获取，官方检出版本不得跟随移动分支。

克隆已有业务项目时，保留已提交的锁文件：

```sh
git submodule update --init --recursive
pnpm dsh:init
pnpm install --frozen-lockfile
pnpm build --all
```

禁止对已有项目重新运行初始化器。执行共享命令前，先满足固定版本的运行时要求。

<a id="configuration-local-development-and-deployment"></a>

### 配置、本地开发与部署

- 所选应用目录下的 `deployment.example.json` 是产品已提交的配置基准，默认是 `apps/web/deployment.example.json`。创建被 Git 忽略的 `deployment.local.json` 时，必须先完整复制产品 example 再修改；系统会整体选择 local 文件，不会与 example 合并。本地文件不存在时，构建和 CI 可以使用 example；显式指定的 `DSH_DEPLOYMENT_CONFIG` 路径必须存在。产品必须使用独立的 Worker、D1 和 R2 资源标识。
- 克隆后，从产品 example 准备本地配置，并以 `<base>/apps/web/.dev.vars.example` 为字段参考创建所选应用目录下的 `.dev.vars`。生成新的随机密钥，禁止复制其他部署的密钥。两份本地文件均不得进入 Git。
- 本地 `.dev.vars` 的 `AUTH_BASE_URL` 必须与实际开发地址一致，初始值为 `http://localhost:5173`。修改主机或端口后，同步更新并重启。下游开发模式只读取这一项本地地址覆盖，不会让其他文本绑定通过 `.dev.vars` 改写。生产构建和部署忽略该本地地址覆盖。功能开关通过部署配置修改，不得隐式开启注册或付费推理。
- `pnpm dev` 在所选应用的 `.cloudflare/state/v3` 中准备 D1（默认 `apps/web/.cloudflare/state/v3`）：先应用底座认证迁移，再应用底座插件的数据结构，最后应用产品插件的数据结构。重复启动必须保留已有数据。准备过程使用本地 Miniflare，不访问远程数据库。禁止通过清空本地状态来伪装升级成功。
- 开发模式采用生产兼容日期与已安装 workerd 支持日期中的较早值，并输出调整说明。可用 `DSH_LOCAL_COMPATIBILITY_DATE=YYYY-MM-DD pnpm dev` 显式覆盖本地日期；生产构建和部署忽略该变量。下游开发模式默认关闭远程绑定，外部模型和服务必须显式配置。
- 只有用户要求部署时，才在配置真实 HTTPS 地址、D1 UUID、独立资源和生产 Worker Secrets 后执行 `pnpm deploy`。显式部署按同样的认证、底座、产品顺序初始化目标 D1。只自动应用可重复的建表、索引及已支持的增列语句；不支持的迁移必须失败。更新底座版本不代表获得部署、破坏性迁移或更改私有数据权限的授权。

<a id="validation"></a>

### 验证

把相关业务回归测试加入产品根目录的 `test:plugins` 脚本。多应用仓库必须执行 `pnpm dsh:check --all` 和 `pnpm build --all`，不能只验证默认应用。`pnpm dsh:check` 检查两层插件的运行面边界、声明的导出、复用来源、分组覆盖、官方 UI 覆盖及严格类型，并在存在该脚本时执行它。`pnpm build` 还会生成可部署产物并检查 Worker 模块。仍须执行前文要求的官方实际界面与交互验收；仅检查元数据不够。

安装依赖、生成和构建后，确认底座及官方源码保持干净。汇报实际执行的检查，区分本地工作流测试与真实 GitHub Actions 执行结果。业务项目的 `README.md` 和 `README.en.md` 必须同步更新，链接到本规范，不复制共享流程。

<a id="manual-updates"></a>

### 手动更新

在业务工作区及两级依赖源码均干净时，从业务仓库根目录运行：

```sh
pnpm dsh:update --ref <base-tag-or-commit>
# 或明确选择跟踪底座 main 的最新提交：
pnpm dsh:update --ref main
```

更新器固定到具体 SHA，按候选底座记录的提交初始化嵌套子模块，同步所有已声明应用的继承依赖与产品锁文件，并运行全部应用的构建和业务测试。必须保留各应用的业务专有依赖、业务代码、部署标识和本地配置。继承依赖的手工修改如有冲突，必须失败，不得静默覆盖。更新成功后审查并提交，禁止自动合并或部署。

候选版本更改 Node 或 pnpm 要求时，先准备升级：

```sh
pnpm dsh:update --ref <base-tag-or-commit> --prepare-only
# 根据候选底座选择 Node，根据更新后产品的 packageManager 选择 pnpm。
pnpm install --no-frozen-lockfile
pnpm build --all
```

`--prepare-only` **不代表验证通过**。单独准备完成后的安装或构建失败，不在更新器的自动验证事务内，必须按下文的回退流程处理。

底座自有 pnpm 补丁位于 `<base>/patches/`。ExcelJS 和 FortuneSheet 使用 `<base>/.submodules/deepseek-harness/patches/` 中固定发布版本的官方补丁。应先初始化两层子模块，再安装依赖。初始化器和更新器会将两类补丁路径转换为相对于业务仓库的路径。

从旧更新器升级时，根据准备结果选择迁移方式：

- 旧更新器已完成 `--prepare-only`，但 workspace 仍使用相对于底座的路径：从业务根目录运行 `node <base>/scripts/project/dependencies.mjs --migrate-prepared-patches`，再安装依赖并构建。旧定时工作流也应在刷新锁文件前执行此步骤。
- 旧更新器仅接受底座的 `patches/` 目录，遇到官方嵌套补丁后拒绝准备并已回退：在业务仓库外检出已审查的候选底座提交，在干净的业务根目录运行 `node <候选底座检出目录>/scripts/project/update.mjs --ref <同一候选提交SHA> --prepare-only`。随后按上文安装、验证并审查改动。

<a id="scheduled-updates"></a>

### 定时更新

初始化会生成两个归业务项目所有的 GitHub Actions 工作流：

- `verify.yml` 在默认分支 push、PR 和手动派发时，执行冻结锁文件安装、全部已声明应用的业务构建与测试，以及源码干净状态检查。跳过功能分支的 push，避免与 PR 构建重复。
- `update-dsh-base.yml` 每周一 **03:23 UTC / 北京时间 11:23（Asia/Shanghai）**检查，也可手动派发并指定标签、SHA 或分支。底座未变更时不安装依赖；存在变更时准备候选分支与锁文件，创建可审查的 PR，并显式触发验证。安装依赖前，先选择候选版本要求的 Node 和 pnpm。
- 重试时核对已有分支的底座版本，补建缺失的 PR 或重新派发失败的验证；同一提交正在验证或已验证成功时复用结果。禁止强推覆盖审查中的分支，禁止重开已关闭或合并的 PR。只复用显式派发的验证结果，防止把跳过的 push 误当成构建通过。
- 在业务仓库中允许 Actions 创建 PR，并用分支规则要求合并前通过当前版本的检查与审查。通过 `GITHUB_TOKEN` 创建的 PR 不会触发常规 PR 工作流，因此必须显式派发验证。工作流禁止自动合并或部署。

下游项目自行管理调度频率，可以调整频率，或移除 `schedule` 并保留手动派发。共享模板位于底座，但升级 gitlink 不会覆盖业务项目已有的 `AGENTS.md`、README 或工作流。业务项目的 `AGENTS.md` 必须持续引导智能体读取当前固定版本的本规范；采用新的自动化行为时，应审查模板变化。

<a id="failure-recovery-and-rollback"></a>

### 失败恢复与回退

正常更新器在验证失败时，会恢复原 gitlink 及本次修改的全部应用依赖声明、锁文件。如果已经执行过安装，恢复后重新运行 `pnpm install --frozen-lockfile`。如果自动回退无法安全完成，必须先检查报告中的路径和工作区，再继续操作；禁止绕过路径保护或覆盖无关改动。

主动回退或处理失败的 `--prepare-only` 候选时，恢复上一已知可用版本中的底座 gitlink、`dsh.dependencies.json`、全部已声明应用的依赖清单、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml`，然后运行：

```sh
pnpm dsh:init
pnpm install --frozen-lockfile
pnpm build --all
```

审查并提交回退。数据库结构与业务数据具有独立生命周期：**代码回退不会撤销数据库迁移**。禁止把删除数据或重置数据库结构作为底座更新、回退的隐含步骤。
