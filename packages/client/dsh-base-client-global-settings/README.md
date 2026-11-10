# 全局站点设置

通过官方 `plugins.bundle.config` 槽位为 `dsh-base:global` 提供完整配置区，并通过 `plugins.row.config` 为 SEO、站点地图、robots.txt、应用清单、llms.txt 和 Google Analytics 提供分项配置。官方详情页继续负责标题、图标、返回入口和包含的组件；本插件直接使用官方稳定导出的 `SettingsForm`、`SettingsValueField`、`Button` 和 `Switch`。固定版 DSH 没有站点 SEO、发现文件、统计或站点管理员配置插件，通用设置与终端设置的 Host 命名空间也不能代替站点文档，因此新增最小字段编辑器与 CAS 草稿控制器，不复制官方页面。

支持站点身份、公开链接、八种语言的页面标题/描述/关键词/分享图片描述、全部图标路径、分享图片尺寸和类型、manifest、robots 附加规则与已注册公开页面的覆盖。关键词及规则按每行一项编辑，关键词允许为空。图片使用已有资源路径或 HTTP(S) 地址，不提供上传入口。字段校验与 Worker 使用同一个 `@dsh-base/site-config/settings` 模型。

分项入口使用官方 `<bundle>#<rowId>` 键：`dsh-base:global#cloudflare:worker:{seo,sitemap,robots,manifest,llms}`，Google Analytics 的 Client/Worker 行分别为 `dsh-base:global#client:google-analytics` 与 `dsh-base:global#cloudflare:worker:google-analytics`。SEO 只编辑页面文案、站点及分享信息；站点地图只编辑 `seo.pages` 中的优先级、更新频率和日期。重置页面字段只影响当前分项，保留另一分项的页面值。站点公开链接仍由全局汇总编辑。清单仅显示清单值及实际使用的安装图标；共用的 SVG 路径继续来自同一文档。

llms.txt 可启停并设置简介与使用说明，缺省开启。Google Analytics 缺省关闭，可先保存衡量 ID，再显式启用；启用须在部署中配置 API secret，仅统计公开页面访问，不提供完整用户归因。API secret 不进入表单或公共配置。开关只修改草稿，仍需点击官方保存按钮才生效。

登录用户通过 `GET /api/site-settings` 查看配置；只有后端授予站点管理员权限的用户可编辑。保存使用 `PUT { expectedRevision, values }`，一次提交完整文档。普通账号不能通过 UI 发起写入；后端仍独立鉴权。配置来源明确显示为部署设置或已保存的站点设置。

所有分项共享同一文档和版本；分项保存保留其他能力的值。输入只更新草稿。失败及版本冲突保留草稿，不显示保存成功；“重新加载并放弃更改”明确替换草稿，且读取失败时仍保留原内容。同一保存期间禁用编辑和重复提交。成功保存后刷新公共 `siteConfig`，侧栏名称随最新公开配置更新。离开表单及切换分项遵循官方 `SettingsForm` 的丢弃未保存编辑行为。

多行字段复用官方 `fields.module.css`。语言、页面路径和更新频率的原生选择框直接使用官方模型设置 `ModelsSection.module.css` 的 `input` / `selectInput`：32px 高、最大 240px 宽、12px 内缩箭头、官方焦点和禁用态。稳定组件没有选择字段导出，精确源导入已在 `dshBase.reuse` 标记并绑定上游提交，升级 pin 时复核。保留原生键盘交互和关联标签；语言切换只切换查看的内容，普通账号也可查看各语言；页面与频率编辑继续服从站点管理员权限。没有新增仪表盘、插件页导航或自定义标签栏。

检查：`node --test packages/client/dsh-base-client-global-settings/tests/*.test.mjs`。覆盖真实槽注册键、分项渲染隔离、八语言标签、与官方 Switch 的输出比较、跨分项字段保留、只读权限、完整 CAS 保存、冲突、网络及校验失败、并发与生命周期；真实 Worker/browser 验收另行检查官方表单挂载和公开站点输出。

## 转化汇总与动态页面

Google Analytics 编辑器复用现有官方字段/选择器，增加关闭、第一方汇总、Google 三种转化模式及活动白名单。仅站点管理员加载 `/api/site-analytics/conversions` 最近 30 个 UTC 日期的汇总；服务端再次校验管理员身份。页面覆盖下拉使用站点快照返回的已发布 `publicPagePaths`，不通过配置发布路由。

已撤下页面的已保存 SEO 覆盖仍可读取和查看，不会重新发布页面。管理员可在全局表单中明确移除这些覆盖；保存继续只接受当前已注册的公开路径，页面下线不会使整个设置编辑器无法加载。
