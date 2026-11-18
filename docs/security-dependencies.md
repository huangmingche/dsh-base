# 依赖安全检查

简体中文 | [English](security-dependencies.en.md)

2026-11-18，`pnpm audit` 在原锁文件中报告一项高危问题。公告覆盖 `picomatch <= 4.0.7`，当日官方尚未发布修复版。受影响的解析器对部分单分支重复扩展模式生成会过度回溯的正则。详见 [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)。

浏览器右栏、Vite、Rolldown 的 Babel 插件、tinyglobby 和 fdir 通过原有的 `picomatch` 导入名解析到 `@ryotsu/picomatch@4.0.7-a`。这是独立维护的 MIT 分支。已将 npm 发布包中的文件逐一与[固定修复提交](https://github.com/ryotsu-kankichi/secured-picomatch/commit/3ab5a7627d480259e3d9ca67fbc14c125d374f0e) 对照，锁文件固定发布包的完整性摘要。该包没有运行时依赖和安装钩子。

Cloudflare CLI 的 Wrangler 配置迁移工具内嵌了 `picomatch@4.0.5`，锁文件审计无法识别这份副本。仓库通过 `patches/cf-picomatch.patch` 移除内嵌实现，并为 CLI 声明对同一修复版的直接依赖。下游产品从固定底座路径读取两份补丁。

安全分支会折叠可等价化简的重复通配符。对于无法证明等价的复杂分支，解析器沿用字面量回退，这会限制部分自定义模式。仓库的 `patches/picomatch-compat.patch` 保留这项防护，即使调用者关闭递归深度限制也会执行单分支检查。补丁同时恢复 4.0.7 的四处原有语义，涉及否定字符组、POSIX 标点类、跨行 globstar 和带扩展名的双星模式。

`pnpm check:dependencies` 检查真实调用方解析的包、浏览器 POSIX 入口、路径扫描、正则生成、目录遍历和 Vite 的敏感文件保护。回归还运行已安装的 `cf migrate --dry-run`，通过函数覆盖率确认文件发现使用修复后的实现。`pnpm audit` 按完整锁文件执行。升级匹配器或 Cloudflare CLI 时须重新核对命令行工具内嵌的匹配器，以及公开入口和安全分支的兼容性。
