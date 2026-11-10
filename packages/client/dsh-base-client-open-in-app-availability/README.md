# 本地应用打开状态

保留官方 `@deepseek-ai/dsh-client-ui-open-in-app` 插件及其控制器，复用固定版本导出的 `OpenInAppAction` 和 `OpenTargetButton`。通过公开 SlotRegistry 在原会话标题栏插槽中补齐缺少本地应用时的禁用状态，不复制官方源码。

当前 Workers 部署没有本地桌面应用启动服务。没有真实工作区目录或可识别的应用时，入口保持可见，使用禁用 fieldset 阻止鼠标及键盘操作，并提供八种语言的说明。灰度采用官方 Button 的禁用透明度；不会伪造应用、目录、加载状态或打开成功。真实目录和应用同时可用时，直接交回原官方组件及控制器。

独立 Worker 插件 `@dsh-base/cloudflare-worker-open-in-app-availability` 按官方 HTTP 契约明确返回空应用目录，避免将缺失接口的 404 或 SPA 页面误当作能力探测结果。原控制器只请求一次；不修改全局 fetch，不读取匿名用户的私有数据。

固定版本 `dsh-v0.2.2-rc.1` 的本地打开入口是独立的标题栏工具。这里不拼接其他版本的“更多”菜单。源码导出及差距记录在 `dshBase.reuse`，随上游版本升级复审。

执行 `node packages/client/dsh-base-client-open-in-app-availability/tests/availability.test.mjs` 验证可用性、实际 SlotCore 生命周期及官方组件渲染。浏览器验收另比较官方菜单与禁用入口，检查鼠标、键盘、主题及本地化行为。
