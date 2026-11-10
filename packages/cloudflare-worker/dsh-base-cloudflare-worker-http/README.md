# Worker HTTP 分发

`http.use(handler, priority = 100)` 注册请求处理器，较小的优先级先执行，同优先级按注册顺序执行。
返回 `undefined` 继续分发；返回 Response 结束当前请求。注册返回的清理函数只撤销该次注册。
跨来源请求检查始终在所有处理器之前运行。

请求分发优先级独立于组合的加载顺序和异步插件激活：认证为 0，站点配置为 10，
SEO 为 20，普通 API 默认 100，静态资源兜底为 1000。即使静态资源插件先启动，
也不能跳过认证、覆盖 SEO 文档或把 robots/sitemap 当作缺失静态资源返回。
每次请求使用处理器快照；执行期间的注册和注销从下一次请求生效。

回归：`node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-http/tests/dispatch.test.ts`。

处理器抛出的 `HttpError` 保留其明确状态和公开错误码，并经过响应钩子后结束分发；认证服务暂时不可用返回 503，不能误报为未登录或继续静态资源兜底。未知异常保留现有运行时错误处理。
