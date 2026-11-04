# 官方命令弹窗兼容适配

完整浏览器实现复制自本仓库固定子模块的 `@deepseek-ai/dsh-client-ui-commands`，提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，保留 MIT 许可证。插件替换官方原始执行行；原始行仍在 composition 中可查且禁用。

官方 `SelectOption` 缺少逐项不可用能力，单独挂载官方插件或导出组件都不能把 `/model` 中部署不支持的模型显示成禁用状态。因此只增加 Host 能力字段 `disabled` / `disabledReason`：原行保持可见，以原布局显示本地化原因与灰色状态；鼠标、Enter/Tab、箭头导航和确认入口都不能提交禁用项。普通选项的布局、搜索、确认、token 消费和焦点行为不变。

改动限定于 `contract.ts`、`popup.ts`、`PopupSelectView.tsx`、其 CSS 的禁用样式，以及 `index.ts` 的空 Config 和公共类型身份衔接。其他源文件、八种语言词典均保持固定版本原样。没有 Node Host 实现或自定义命令产品行为。升级上游固定版本须复核这些差异。

`node apps/web/tests/parity/run-commands.mjs` 验证中英文正常状态与官方参考的文本、控件、几何和截图一致；真实 `/model` 选项生成函数与 fork 控制器验证禁用鼠标/键盘零提交和可用选项正常提交。它不是全应用或线上部署等价证明。
