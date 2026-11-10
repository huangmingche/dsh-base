# 邮件配置状态

通过官方 `plugins.bundle.config` 槽位为 `dsh-base:email` 显示 `/api/auth-policy` 的公开邮件状态，使用原样官方按钮和设置字段样式。仅显示启用状态、配置是否齐全和服务商；就绪不代表邮件已送达。不提供浏览器密钥编辑或测试邮件发送。站点管理员在部署环境配置发件人与凭证，账号登录插件负责验证和密码找回交互。商业模板仅作流程参考，本包没有复制其源码。

读取失败或非法配置不会呈现就绪。支持官方八种语言，不注册设置页，不读取私有账号。检查：`node --experimental-strip-types --test packages/client/dsh-base-client-email/tests/*.test.ts`；实际槽位与控件渲染验证位于 Waffo Pancake 客户端包的 `tests/panels.test.mjs`。

本插件通过 `publicPluginConfigurations` 兼容服务按生命周期登记自己的公开 bundle 配置入口；默认工作台要求登录；面板和服务端根据账号权限提供对应操作。卸载插件会注销入口，不开放组件级私有配置。
