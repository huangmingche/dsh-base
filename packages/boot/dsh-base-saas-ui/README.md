# SaaS 浏览器兼容支持

`@dsh-base/client-saas-ui` 是无独立组合项的 `browser-support` 库。各客户端插件拥有独立 API 契约、字段、业务决策和组合元数据；本库仅提供同源请求、生命周期、官方 `plugins.bundle.config` 注册适配及原样官方 Button/Input/Switch 渲染。字段和选择框使用固定官方导出的样式，来源记录在包元数据中。

私有读取先验证真实会话，401/403 清除私有状态，页面退出中止请求并清除一次性密钥。创建密钥成功后，即使列表刷新失败也保留本次密钥，避免误称创建失败或重复创建。操作使用服务器路由授权，不以客户端状态代替权限校验。Turnstile 仅在已配置且挂载的公开表单中加载，过期和错误会清除令牌，提交后重置，卸载移除组件。不包含秘密配置或独立产品入口。

检查：`node --experimental-strip-types --test packages/boot/dsh-base-saas-ui/tests/transport.test.ts`。隔离浏览器验证见 `tests/run-browser.mjs`，只使用本地夹具和请求拦截，不发送真实邮件、支付、客服或通知。

调用方通过兼容服务显式登记自己的公开 bundle 配置入口；登记随插件卸载注销，不影响账号动作鉴权。
