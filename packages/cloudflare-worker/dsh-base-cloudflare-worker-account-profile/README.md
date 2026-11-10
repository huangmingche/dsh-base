# 产品账号资料

本 Worker 插件管理当前登录的本地 Better Auth 账号，与官方 DeepSeek Platform 账号控制分开。复用 `AUTH_DB` 和认证服务，无额外表或凭据。

- `GET /api/saas/account-profile` 仅返回本人姓名、用户名、邮箱、验证标记、图片，以及 `canChangePassword` 和可用的本人 `avatarFileId`。
- 同源 `PUT` JSON `{name,avatarFileId?}`：姓名最多80字符；省略头像保留原值，`null` 清空；选择的PNG/JPEG/WebP文件必须在提交时仍就绪且属于本人。
- `POST /api/saas/account-profile/password` 接收 `{currentPassword,newPassword}`，通过同一 Better Auth 策略与限流处理器执行 `revokeOtherSessions:true`。保留所有轮换后的会话cookie，响应正文不暴露会话token。

不支持此接口修改用户名/邮箱或指定外部头像URL。文件删除会原子清除对应头像引用，并发头像更新安全失败。响应禁止缓存。`tests/profile.test.ts` 覆盖cookie轮换和删除竞争；根SaaS运行测试覆盖真实D1行为。

新注册不接受客户端 `image` 字段，原生 Better Auth `update-user` 路由关闭；自定义头像必须选择本人 R2 文件。既存头像与官方 Google provider 返回的头像不做迁移，单独改姓名会保留这些原值，显式清空或更换时再应用上述规则。
