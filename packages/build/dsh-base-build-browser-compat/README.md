# 浏览器源码构建兼容层

此包仅提供构建适配，应用入口不包含功能。官方源码从锁定子模块读取，不修改或复制。官方文档预览需要 PDF.js Worker、同版本字体/CMap/WASM、表格样式及打包后的 Excel parser Worker；本包为直接源码构建提供这些真实资源，第三方许可随客户端输出到 `third-party/document-preview.txt`。

Node resolver 兼容仅在 Vite `client` 环境启用，Worker 保留真实 `nodejs_compat`。浏览器文件写入明确失败，不返回虚假成功。它不提供浏览器文件系统、插件安装或 HMR。

`sourceDecorators` 在构建时识别真正的 TypeScript 装饰器节点：官方 `@Remote` 使用标准 decorator / `addInitializer` 协议，Agents 的 `callable`（含导入别名）使用旧式 descriptor 协议，分别降级为目标运行时可执行的 JavaScript。不会把官方装饰器误编译为旧协议；同一模块混用两种协议会明确失败。测试直接加载固定源码的 LLM 与权限服务，验证方法标记和初始化，而不只检查字符串。

应用 `build` 在 `cf build` 后运行本包 `check-worker-output`，对实际部署目录中的每个 Worker JavaScript 模块执行 `node --check`。该门禁不执行 Cloudflare 导入；真实启动仍由 `acceptance:local` 验证。回归位于 `scripts/conformance/tests/build-source-transform.test.mjs`，随 `check:conformance` 执行。

`sourcePackageMetadata` 只对已登记的官方 LLM `src/attribution.ts` 中确定的 `createRequire(import.meta.url)('../package.json')` 读取做构建期求值。版本来自固定子模块实际导出的 package.json，并作为构建监听依赖；官方 identity、User-Agent 和 header 函数保持原样，不依赖 Worker 内不存在的源文件路径。读取形式、包名或导出契约变化会拒绝构建，升级 pin 时必须重审。回归在没有 Node 模块解析和文件父路径的生成模块中执行真实归因函数。
