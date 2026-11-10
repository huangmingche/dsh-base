# Support contact form

Enable `CONTACT_ENABLED=true`, set the fixed `CONTACT_SUPPORT_EMAIL`, and configure the existing email plugin plus `AUTH_BASE_URL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` and `AUTH_DB` public-form/email schemas. The default is unavailable. The official Session feedback command remains independent; this form sends general support mail to the deployment-owned recipient.

`GET /api/saas/contact/status` returns `{enabled,ready,turnstileSiteKey}`. Public same-origin `POST /api/saas/contact` accepts `{name,email,message,turnstileToken,locale?}`. Names are at most 80 characters and messages 10–4000 characters. Turnstile must match the configured hostname and `contact` action; tokens are durably single-use. Fixed-window budgets allow 5 requests/IP/10 minutes, 1000/contact-action/day and 3 requests/sender-address/hour.

The supplied sender is message content, never a From header or a destination. HTML content is escaped. The recipient is always `CONTACT_SUPPORT_EMAIL`; this is not an arbitrary mail relay. Identical content within a ten-minute window uses one persistent email delivery key. Provider acceptance returns 202, not a promise of inbox delivery or a reply. Errors never expose provider credentials, payloads or private delivery records. Ambiguous deliveries do not automatically resend.

No support message is stored in a custom inbox table; the email plugin retains hash-only delivery state. Operators should monitor their provider mailbox. Root SaaS workerd tests cover form authority and budgets; email notice tests cover escaping and fixed recipients. No real message was sent.
