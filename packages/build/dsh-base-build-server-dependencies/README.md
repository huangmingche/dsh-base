# Server SDK 依赖环境

仅供构建、类型解析和测试使用，不是运行时功能插件，也不加入任何 composition。它与 `apps/web` 是仓库根工作区的两个成员，共用根目录的 `pnpm-lock.yaml`。在仓库根目录运行 `pnpm install --frozen-lockfile`；应用目录不另设工作区或锁文件。所有成员都位于仓库根目录之内，保证 Cloudflare 的配置查找边界是其祖先目录。

浏览器使用固定官方 DSH 基线 React / ReactDOM 18.3.1 与 React 18 类型。Cloudflare Think / Agents 的可选 React peer 要求 19，因此 SDK 在这个独立包中解析；这里安装的 React 19 不进入浏览器，也不调用 SDK 的 React 入口。严格检查 peer，不伪造兼容范围、不关闭检查。

`./resolution` 只导出构建和 Node 测试需要的 SDK 目录 / resolver。应用功能仍由原有 Worker / Think 插件提供。升级 SDK 或官方 pin 时重新验证 peer、实际客户端输入、分面类型和生产构建。
