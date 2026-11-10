# __PRODUCT_NAMESPACE__

简体中文 | [English](README.en.md)

本项目通过 Git 子模块引用 Dsh-base，业务功能在本仓库开发为 DSH 插件。

- 底座路径：`__BASE_PATH__`。
- 业务命名空间：`__PRODUCT_NAMESPACE__`。
- 当前路径与命名空间以 `dsh.project.json` 为准。
- `dsh.apps.json` 声明当前 Web 应用及默认应用；多应用的范围与操作见[底座规范](__BASE_PATH__/AGENTS.md#multi-application)。

首次克隆如尚未初始化子模块，先运行 `git submodule update --init --recursive`。
初始化、开发、配置、验证、部署、手动或定时更新及回退统一遵循[固定版本底座的 AGENTS.md](__BASE_PATH__/AGENTS.md#downstream-products)。
项目特有的开发要求写入本仓库 [AGENTS.md](AGENTS.md)，共享流程只在底座维护。
