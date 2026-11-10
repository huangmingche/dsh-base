# 产品构建适配

此构建包让外层产品通过只读 Git 子模块使用 base；不提供运行时功能或组合条目。

`./vite` 导出 `defineDshViteConfig({ productRoot, appRoot })` 和 `dshSource(options)`；所有工具从产品 app 依赖环境加载。`./cloudflare` 导出 `createDshCloudflareConfig(cfConfig, { deploymentPath, entrypoint })`，由产品传入自己的 `cf/config` API。

生成数据映射到产品 `.artifacts/dsh/<base 相对路径>`。官方源码始终来自 base 锁定的嵌套子模块，只解析其 exports。产品 server SDK 依赖安装在 `packages/build/product-server-dependencies`，浏览器和服务器 React 环境保持隔离。

开发模式将兼容日期限制在已安装 workerd 支持的版本内，并默认关闭远程 bindings。`DSH_LOCAL_COMPATIBILITY_DATE` 只覆盖本地日期；生产 build/deploy 保留配置日期。产品公共 CLI 在启动服务器前准备本地 D1 schema。
