# 公开套餐契约

平台无关的纯解析库，供部署配置和支付 Worker 共享套餐、展示价格与权益映射。无插件组合条目，不独立交付功能，不导入 Worker、浏览器、React 或 Node。

`parsePlans`、`parseFeatures` 严格校验部署声明；`publicCatalogFromDeployment` 输出带 `priceSource:"deployment"` 的不含凭据投影。缺少价格不推测金额，订阅展示价必须声明周期，币种精度不可静默舍入；默认 `ready:false`。实际支付状态、金额与授权仍由支付和权益插件处理。
