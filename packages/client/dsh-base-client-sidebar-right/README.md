# 右侧栏会话引用兼容分叉

完整复用固定版本的官方 `@deepseek-ai/dsh-client-ui-sidebar-right` 浏览器实现，来源为 `.submodules/deepseek-harness/packages/client/ui-sidebar-right`，提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，MIT 许可及原声明见 [LICENSE](./LICENSE)。官方原插件保留在组合库存中并禁用，本插件通过 `replaces` 接替它。

唯一行为修正位于 `src/client/session-view.ts`：Workers 导航在远程历史尚未打开时可能释放旧视图。官方 `SessionReference.release()` 会拒绝该引用的 `ready`；已经由自己释放的视图不应把这次取消报告为打开失败。仍然拥有引用的视图发生真实打开失败时，继续报告原错误。`entry.ts` 仅提供本地 Loader 的配置契约。类型接缝复用官方 `/client` 的 Cordis/slot 声明与参数映射，避免分叉重复声明丢失其他官方插件的扩展；同时遵循官方 React 18 RefObject（current 本身可空）类型，补全 POSIX 匹配器使用面以及标签导航的泛型参数。以上类型修改不改变运行行为。

布局、CSS、组件、插槽、本地化、保留标签页和引用所有权均保持官方实现。没有模拟引用成功，也没有修改官方子模块。升级上游 pin 时必须重新检查该取消契约。

回归使用真实官方 `ClientSessions` 及 `SessionReference`，比较原实现与分叉：待打开引用取消、切换视图、重复释放和真正打开失败。运行 `node apps/web/tests/parity/run-sidebar-lifecycle.mjs`。
