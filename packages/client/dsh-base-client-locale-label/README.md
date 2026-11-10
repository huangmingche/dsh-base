# @dsh-base/client-locale-label

pinned 官方 `@deepseek-ai/dsh-client-locale` 的完整标记 fork（commit
`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，MIT）。把内置 `zh` 的显示名从
“中文”改为用户明确要求的“简体中文”；内部 locale id 仍为 `zh`，持久化偏好、
`/zh-CN` 路由、语言选择器、词典和 RPC 合同均保持官方实现不变。

这是用户授权的显示名差异，不迁移或改写用户数据；可通过 `dshBase.forkOf` /
`dshBase.reuse.gaps` 追溯。

全局站点标题通过官方 `LocaleFace` 安装点接入：`client-site-config/title-face`
只为渲染器的 `common/brand.localBuild` 提供公开站点标题，按当前语言、英文、站点名称回退。
公开标题尚未加载时委托原版翻译，其他命名空间和 key 始终委托原版。词典内容不变，
不重复注册语言或安装第二个 locale face；原样 `AppFrame` / `DocumentTitle` 继续负责
页面标题与会话名称前缀。适配器合并语言和公开标题的订阅，随插件销毁释放。

`siteConfig` 是显式注入依赖；该服务没有 locale 依赖，启动时不等待公开 HTTP，
并发组合加载可在安装 locale face 前提供它，不产生服务循环。

`pnpm check:locale-fork` 是漂移守卫：把 `src/` 与 pin 官方包逐文件比对，只允许配置
schema 导出、中文显示名及三处标题 Host 接入修改；任何额外差异或 `forkOf.commit`
与 pin 不一致即失败。升级 pin 后按 ADR §9.5 同步。标题投影和订阅回归位于
`client-site-config/tests/title-face.test.mjs`。
