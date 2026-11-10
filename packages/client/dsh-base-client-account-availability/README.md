# 账户账单可用性接缝

账号界面由完整标记的 `@dsh-base/client-settings-account` fork 提供，其默认渲染保持官方行为。本包复用其导出的 `AccountSection` 和原注册的真实账户数据，通过原生禁用容器及链接导航拦截，让不可用的账单、用量、充值和 DeepSeek Platform 账户入口保持可见、灰色并带八种语言说明。官方账户菜单、BetterAuth 用户资料和退出登录保留真实行为。

没有复制官方源码或伪造余额。本包不提供账单服务。固定来源由 fork 元数据记录，本接缝消费其稳定 `/client` 导出；升级固定版本时复核组件合同。

浏览器验证：`node apps/web/tests/parity/run-account.mjs`。中英文各自比较固定官方组件的禁用表面，覆盖全部链接的鼠标、键盘、辅助点击和右键导航拒绝，检查原账户菜单仍可完成退出登录回调。fixture 经实际 apply 注册并按其 locale 绑定翻译，防止注册丢失本地化合同。数据为受控本机 fixture，不表示线上账户已验收。
