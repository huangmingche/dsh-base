# Crisp配置

本Worker插件仅暴露可选客户端客服集成所需的公开配置。设置 `CRISP_ENABLED=true` 和有效UUID `CRISP_WEBSITE_ID`；默认关闭，缺失或无效ID不会启用组件。

`GET /api/saas/crisp` 禁止缓存，返回 `{enabled,websiteId}`；其他方法为405。website ID有意公开，并非secret。Worker不加载脚本，不向Crisp发送会话、邮箱或用户身份。客户端配套插件负责交互和按需加载，官方Session反馈保持原状。无需数据库、额外服务或后台请求。

仅本地验证配置与UI，不宣称已经连接真实Crisp账号或完成客服会话。
