# 产品用户管理

独立 Worker 插件组合 Better Auth 1.7.18 的官方 `admin` 插件。`USER_ADMIN_ENABLED=true` 才开放管理，且当前 cookie 会话的用户 ID 必须位于部署绑定 `SITE_ADMIN_USER_IDS` 的 JSON 数组内。数据库中的 `role=admin` 是产品标签，不授予部署管理员权限；普通注册与资料更新不能写入角色。停用管理入口仍保留 ban/session hooks，已封禁用户不会因此恢复登录。

| 路由 | 契约 |
| --- | --- |
| `GET /api/user-admin/status` | `{enabled,canManage}`，不泄露用户列表 |
| `GET /api/user-admin/users` | 管理员分页列表；`limit=1..100`、`offset=0..100000`、邮箱 `search` 最长 128 字符；返回 `{users,total,limit,offset}` |
| `POST /api/user-admin/actions` | 管理员且同源；`{action,userId,role?,reason?}`；action 为 `ban`、`unban`、`set-role`、`revoke-sessions`，role 仅 `user/admin`，reason 最长 500 字符 |

请求体按流限制 4096 字节并拒绝额外字段。不能封禁部署管理员。公开 Better Auth `/api/auth/admin/*` 路径全部拒绝，只有 Worker 内部携带扩展 scope 的包装路由可调用已挂载端点。删除用户、代入用户、管理员改密码与创建用户均未挂载；文件与私有历史的删除联动尚未定义。

`schema.sql` 为 pinned Better Auth schema 增加用户角色/封禁与 session 字段；初始化工具检查已有列后应用，勿在已迁移数据库直接重复执行原始 ALTER。参见 [Better Auth admin 文档](https://better-auth.com/docs/plugins/admin)。固定版本 DSH 的 `deepseek-account` 的 `account` Remote 只提供当前平台账户，不含可挂载/分叉的产品用户管理，因此本包独立实现适配，无商业模板或 DSH 代码复制。

运行 API-key 包的 `tests/runtime.test.mjs`，在真实本地 workerd、Better Auth 和临时 D1 上验证 allowlist 权限、角色越权拒绝、原生路径绕过、封禁/解禁、停用后的封禁保留与会话撤销。没有远端写入。
