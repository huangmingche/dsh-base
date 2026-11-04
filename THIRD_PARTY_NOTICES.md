# Third-party notices / 第三方声明

DeepSeek Harness Base (code name `dsh-base`) is an independent derivative of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is not an official DeepSeek hosted service or an endorsement by DeepSeek. DeepSeek Harness Base（代码名 `dsh-base`）是 DeepSeek Harness 的独立衍生项目，并非 DeepSeek 官方托管服务或背书。

The official source is pinned to `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, under `.submodules/deepseek-harness`. It remains unmodified. 官方代码仅来自锁定子模块，保持原样。

- DeepSeek Harness: Copyright (c) 2026 DeepSeek, MIT. The full license is retained at [.submodules/deepseek-harness/LICENSE](.submodules/deepseek-harness/LICENSE).
- Upstream third-party notices, including Cordis and other vendored projects, are retained at [.submodules/deepseek-harness/THIRD_PARTY_NOTICES.md](.submodules/deepseek-harness/THIRD_PARTY_NOTICES.md); vendored license files remain with their source.
- Browser forks in `packages/client/dsh-base-client-model-selection`, `dsh-base-client-commands`, `dsh-base-client-settings-navigation`, and `dsh-base-client-sidebar-right` retain upstream MIT licenses. Each package records `dshBase.forkOf` with the exact package, source path, commit, and license, plus bilingual documentation of the adaptation.
- Worker protocol forks `packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host` and `dsh-base-cloudflare-worker-wire-rpc` retain the upstream MIT license and exact fork metadata.
- Other compatibility seams import exported official components directly; they do not claim authorship of those components. The sidebar shows the code name `dsh-base` (the product display name `DeepSeek Harness Base` is used in README and documentation) and the sidebar version is removed; these are approved branding adaptations, and the official mark and Settings version are preserved.
- Own modifications are covered by the root [MIT license](LICENSE). DeepSeek names and marks remain the property of their respective holders; the source license does not transfer trademark ownership.

Builds generate `/third-party-notices.txt` from these notices, retained upstream/vendor licenses, and licenses shipped by installed production dependencies. This file accompanies deployed assets. PDF.js data assets retain their own upstream license. 构建会生成随部署资源发布的 `/third-party-notices.txt`，包含来源、上游及 vendor 许可与实际安装的生产依赖许可；PDF.js 数据资源另保留其上游许可。

When upgrading the upstream pin or adding a fork/dependency, review the metadata and licenses together. 升级上游或添加 fork/依赖时，应同步复核来源元数据与许可文件。
