# 官方实现与 Workers 适配

固定的官方版本是 `dsh-v0.2.2-rc.1`。客户端 profile 声明哪些官方插件原样挂载、哪些通过自有包派生、哪些入口在 Workers 不可用。每个派生包的 `dshBase.forkOf` 记录来源，`dshBase.reuse` 说明 Host 接口和限制。侧栏使用官方品牌槽位的默认实现。

[客户端组合](../apps/web/composition.profile.json) · [运行时边界](runtime-parity.md) · [English](official-differences.en.md)
