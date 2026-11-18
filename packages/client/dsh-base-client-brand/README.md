# 官方侧栏品牌名称接缝

官方 brand 插件只在 official 构建 profile 注册；其它部署沿用 `SidebarRoot` fallback。本插件只占用公开的 `sidebar.brand.name` 槽位，通过框架注入的 `siteConfig` observable 显示已配置的站点名称。首次公开快照到达前使用共享默认值，管理员保存全局设置后随公共快照更新。

这是用户批准的全局站点配置名称消费者。不注册 mark 槽位，保留官方 `FishLogo` 与版本复制行为；不增加 CSS，不改变侧栏布局或交互。名称继承原槽位排版。

占用名称槽位仍会替代该 fallback 原有的版本行和点击复制版本；官方 mark 与设置页版本信息不变。`dshBase.reuse` 继续记录这一缺口。原官方 brand 插件保持 enabled/no-op，不声明替换它。
