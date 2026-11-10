# 私人文件库

本插件提供登录产品账号的R2文件库，与官方会话附件上传及工作区文件分开。启用 `FILES_ENABLED=true`，绑定R2 `FILES`，先将 `schema.sql` 应用到 `AUTH_DB`。ready只检查配置，不探测存储或表。

`GET /api/saas/files/status` 返回 `{enabled,ready,maxBytes}`。登录后 `GET /api/saas/files?cursor=&limit=50` 仅列本人就绪文件，使用UUID游标，每页最多100条。同源 `POST /api/saas/files?name=example.txt` 上传原始正文。单文件最多10MiB；D1原子预留限制每账号200文件/100MiB，pending/deleting记录计入额度。

`GET`/`HEAD /api/saas/files/{id}` 仅本人可下载附件；`/view` 只允许带基本格式签名校验的PNG/JPEG/WebP。下载禁止缓存，设置nosniff、限制性CSP及同源资源策略；SVG/HTML不作为内联图片。本能力不宣称病毒扫描或完整图片解码。

同源 `DELETE /api/saas/files/{id}` 先在同一D1批次标记删除并清理对应账号头像，然后删除R2，最后移除记录。失败保留可重试deleting状态；active pending上传不可删除。上传完成必须仍有对应预留，否则执行清理并拒绝虚假成功。进程崩溃可能留下pending预留或R2对象，管理员须核对存储后再清理，无公开分享或后台清扫服务。

`tests/files.test.ts` 覆盖上传期间元数据消失；根SaaS运行测试覆盖所有权、配额并发、下载头和R2删除，未访问生产存储。
