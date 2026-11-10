# 公共KV缓存

启用 `CACHE_ENABLED=true` 并绑定Workers KV为 `CACHE`。这是仅供可信服务端保存公开数据的服务，不新增表。官方Session投影检查点缓存的一致性和所有权契约不同，已记录复用决策。

`ctx.publicCache.get(env,key)`、`put(env,key,value,ttlSeconds)`、`delete(env,key)` 仅接受 `public:` 命名空间键，存储时再加部署前缀。JSON值最多256KiB，TTL为60–86400秒。KV最终一致，删除不能保证全球立即失效。不得缓存会话、凭据、支付、权益或私人账号数据。

`GET /api/saas/cache/status` 公开返回 `{enabled,ready}`。`GET /api/saas/cache` 及同源 `DELETE /api/saas/cache?key=public:example` 要求登录且属于 `SITE_ADMIN_USER_IDS`。HTTP不提供缓存内容读取或任意写入。绑定缺失时拒绝使用，供应商错误不泄露细节；无预热定时器或额外运行时。

根SaaS workerd测试覆盖管理员权限、键边界、TTL/值大小及真实本地KV。
