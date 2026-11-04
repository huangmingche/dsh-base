# 类型检查

运行 `node scripts/typecheck/check.mjs`。使用仓库根锁文件为应用安装的 TypeScript 6.0.3，先验证上游 pin，再在 `.artifacts/typecheck/` 生成声明和独立 Client / Worker 配置。所有自有 Client、Worker、Think 的 `src` TypeScript 文件及应用运行入口使用 `strict: true` 检查；漏掉任一自有源码会失败。

官方 Cordis 等共享依赖按其包级编译选项检查并输出声明。官方公开 Typert `WorkspaceAnalyzer` 和 `FaceModelEmitter` 从锁定 Host 源码生成真实 Remote 声明。其它官方依赖通过 TypeScript `emitDeclarationOnly` / `noCheck` 提取声明后作为依赖消费，不把所有官方包的声明扩展合并成一个待检查源码工程。`noCheck` 只用于依赖声明提取，自有代码检查不使用它，也不按文件路径过滤诊断。

这不是完整上游仓库的语义检查：上游有自己的 Host / Client 项目边界和测试。本命令不拼装接口、不替换为 `any`，不写入子模块，不安装上游工作区依赖。所有生成文件均可删除后重建；通过报告列出实际检查的自有文件。构建和浏览器验收另行验证运行时。
