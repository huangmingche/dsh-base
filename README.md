# DeepSeek Harness Base

简体中文 | [English](README.en.md)

DeepSeek Harness Base（`dsh-base`）是基于 DeepSeek Harness 的应用开发模板。项目通过 Git 子模块固定 DeepSeek Harness 的官方发布版本，并在上游发布新版后同步更新对应子模块。

DeepSeek Harness Base 遵循「一切皆插件」原则：开发者可以复用官方 dsh 插件，也可以按需开发自己的 dsh 插件，再将选用的 dsh 插件组合成独立应用，最终部署到 Cloudflare Workers。
