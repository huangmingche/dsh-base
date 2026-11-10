# 类型检查

运行 `node scripts/typecheck/check.mjs`，可用 `--app <id>` 选择 `dsh.apps.json` 中的应用。使用仓库根锁文件为所选应用安装的 TypeScript 6.0.3，先验证上游 pin，再生成声明和独立 Client / Worker 配置。底座默认 Web 应用保留 `.artifacts/typecheck/`；下游默认 Web 使用 `.artifacts/dsh/.artifacts/typecheck/`；其他应用使用 `.artifacts/dsh/applications/<id>/.artifacts/typecheck/`。所有自有 Client、Worker、Think 的 `src` TypeScript 文件及应用运行入口使用 `strict: true` 检查；漏掉任一自有源码会失败。

官方 Cordis 等共享依赖按其包级编译选项检查并输出声明。官方公开 Typert `WorkspaceAnalyzer` 和 `FaceModelEmitter` 从锁定 Host 源码生成真实 Remote 声明。其它官方依赖通过 TypeScript `emitDeclarationOnly` / `noCheck` 提取声明后作为依赖消费，不把所有官方包的声明扩展合并成一个待检查源码工程。`noCheck` 只用于依赖声明提取，自有代码检查不使用它，也不按文件路径过滤诊断。

这不是完整上游仓库的语义检查：上游有自己的 Host / Client 项目边界和测试。本命令不拼装接口、不替换为 `any`，不写入子模块，不安装上游工作区依赖。所有生成文件均可删除后重建；通过报告列出实际检查的自有文件。构建和浏览器验收另行验证运行时。

消费项目使用 `DSH_PRODUCT_ROOT=/path/to/product node /path/to/product/.submodules/dsh-base/scripts/typecheck/check.mjs`（也接受 `--root` 和 `--app`）。先为同一个应用准备生成文件；配置、官方声明、Remote 声明和报告只写入该应用的类型生成目录。TypeScript、浏览器依赖从所选应用的 `node_modules` 读取，服务端 SDK 从产品 `packages/build/product-server-dependencies/node_modules` 读取，基础仓库不需要安装依赖。

严格检查同时枚举基础仓库及产品的 Client / Worker / Think 插件，以及浏览器支持包。编译宿主将基础源码和应用入口对生成模块的相对引用重定向到所选应用的生成目录，即使默认应用或基础仓库留有旧生成文件也不会误用；缺失所选应用生成文件会失败。根文件同样重定向，因此不能直接用原生 `tsc -p` 替代本检查入口。`node --test scripts/typecheck/tests/*.test.mjs` 验证双根严格诊断、漏检保护和产品依赖/生成文件解析。

应用选择、批量检查与下游操作遵循 [AGENTS.md 的多应用规范](../../AGENTS.md#multi-application)。选择的应用 ID 与构建配置的应用目录不一致时必须失败，不能静默检查另一个应用。
