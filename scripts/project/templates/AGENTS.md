# AGENTS.md

本业务项目通过固定版本的 Git 子模块引用 DeepSeek Harness Base。
先读取 `dsh.project.json`，确认当前底座路径与业务命名空间，并读取 `dsh.apps.json` 确认目标应用；初始化时的底座路径为 `__BASE_PATH__`，命名空间为 `__PRODUCT_NAMESPACE__`。

实施、配置、验证、更新或部署前，必须：

1. 如果子模块尚未初始化，执行 `git submodule update --init --recursive`。
2. 读取[固定版本底座中的 AGENTS.md](__BASE_PATH__/AGENTS.md)，包括其中的[下游产品规范](__BASE_PATH__/AGENTS.md#downstream-products)。如果底座路径已经变更，通过 `dsh.project.json.base` 定位该文件。
3. 将其中的共享产品规则应用于本仓库，包括一切皆插件、官方优先复用、官方 UI/UX 一致性、Workers 原生运行时、成本约束、源码归属及运行面边界。

固定版本底座中的 AGENTS.md 是共享流程的唯一规范来源。每次更新底座后都必须重新读取，禁止用其他检出目录或移动分支中的规范替代。
多应用的选择、产物隔离和验证遵循底座的[多应用规范](__BASE_PATH__/AGENTS.md#multi-application)。
本文件使用简体中文，只补充业务项目特有的要求，不复制底座的初始化、开发或升级流程。
