# 联系支持表单

启用 `CONTACT_ENABLED=true`，配置固定收件人 `CONTACT_SUPPORT_EMAIL`、已有邮件插件，以及 `AUTH_BASE_URL`、`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` 和 `AUTH_DB` 的公共表单/邮件schema。默认不可用。官方Session反馈命令保持独立；本表单将一般支持邮件发往部署指定收件人。

`GET /api/saas/contact/status` 返回 `{enabled,ready,turnstileSiteKey}`。公开同源 `POST /api/saas/contact` 接收 `{name,email,message,turnstileToken,locale?}`，姓名最多80字符、正文10–4000字符。Turnstile必须匹配配置域名和contact action，token在D1中单次使用。固定窗口限制每IP每10分钟5次、每contact action每天1000次、每发件地址每小时3次。

用户邮箱仅作为正文，不充当From或目标地址；HTML已转义，收件人永远是 `CONTACT_SUPPORT_EMAIL`，不是任意邮件转发接口。10分钟内相同内容复用一个持久化投递键。202仅代表供应商接受，不保证收件箱送达或回复；错误不泄露凭据、供应商正文或私有投递记录，不确定投递不自动重发。

不新增支持工单收件箱表，邮件插件仅保存摘要和状态；运营者通过实际供应商邮箱处理。根SaaS workerd测试覆盖表单权限/限流，邮件notice测试覆盖转义及固定收件人，未发送真实消息。
