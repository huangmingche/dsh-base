# 本地应用可用性

为原样挂载的官方“在应用中打开”客户端提供 Host 能力目录。固定版本客户端自行创建 HTTP 控制器，没有可注入的目录服务；官方 Host 包依赖 Node 文件系统与子进程，不能在 Workers 上挂载。这里复用官方稳定 `@deepseek-ai/dsh-host-open-in-app/shared` 路径及响应契约，不复制或修改官方代码。

`GET /open-in-app/apps` 明确返回 `{ "apps": [] }`，`HEAD` 返回相同响应头且没有响应体。只声明当前部署确实没有桌面应用，不探测设备、不读取账号、会话或工作区，不伪造启动成功。客户端继续使用官方控件和既有禁用状态适配层。启动及图标接口不由此插件提供。

该精确公开路径在导航鉴权和静态资源处理之前响应；其他路径保持原有鉴权。响应禁止缓存及索引，跨源请求、查询参数和非读取方法明确拒绝。没有数据库、存储或后台任务成本，每次客户端初始化只进行官方原有的一次目录请求。

执行 `node packages/cloudflare-worker/dsh-base-cloudflare-worker-open-in-app-availability/tests/routes.test.mjs` 检查方法、边界与真实 Cordis 挂载和卸载；客户端包 `dsh-base-client-open-in-app-availability` 的回归同时使用原官方控制器验证真实空目录及一次性请求行为。
