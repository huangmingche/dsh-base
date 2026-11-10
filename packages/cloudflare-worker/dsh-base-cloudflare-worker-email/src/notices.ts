import { isEmailAddress } from "./config.ts";
import { EmailError, type EmailConfig, type EmailEnv, type EmailMessage, type NoticeEmail } from "./types.ts";
import { emailLocale } from "./templates.ts";
const escape = (s: string) => s.replace(/[&<>"']/gu, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const COPY = {
  en: ["Confirm your subscription", "Use the link below to confirm your newsletter subscription. If you did not request this, ignore this email.", "New contact message"],
  zh: ["确认订阅", "请使用下方链接确认订阅。如果你没有请求订阅，请忽略此邮件。", "新的联系消息"],
  ja: ["購読を確認", "下のリンクで購読を確認してください。心当たりがない場合は無視してください。", "新しいお問い合わせ"],
  es: ["Confirma tu suscripción", "Confirma tu suscripción con el enlace. Si no la solicitaste, ignora este mensaje.", "Nuevo mensaje de contacto"],
  fr: ["Confirmez votre abonnement", "Confirmez votre abonnement avec le lien. Ignorez ce message si vous ne l’avez pas demandé.", "Nouveau message de contact"],
  de: ["Abonnement bestätigen", "Bestätigen Sie das Abonnement über den Link. Ignorieren Sie diese Nachricht, falls Sie sie nicht angefordert haben.", "Neue Kontaktanfrage"],
  pt: ["Confirme sua assinatura", "Confirme sua assinatura pelo link. Ignore esta mensagem se você não a solicitou.", "Nova mensagem de contato"],
  ru: ["Подтвердите подписку", "Подтвердите подписку по ссылке. Если вы её не запрашивали, проигнорируйте письмо.", "Новое сообщение"],
} as const;
export function renderNotice(env: EmailEnv, config: EmailConfig, input: NoticeEmail): EmailMessage {
  if (!input || (input.locale !== undefined && (typeof input.locale !== "string" || input.locale.length > 64)) || typeof input.idempotencyKey !== "string" || !input.idempotencyKey || input.idempotencyKey.length > 4096 || /[\x00-\x1f\x7f]/u.test(input.idempotencyKey)) throw new EmailError("email_invalid_intent");
  const copy = COPY[emailLocale(input.locale)];
  if (input.kind === "newsletter-confirm") {
    if (!isEmailAddress(input.to) || typeof input.actionUrl !== "string" || input.actionUrl.length > 8192 || /[\x00-\x1f\x7f]/u.test(input.actionUrl)) throw new EmailError("email_invalid_intent");
    let url: URL;
    try {
      url = new URL(input.actionUrl);
      if (url.origin !== config.origin || url.username || url.password || url.pathname !== "/" || url.hash || !/^[a-f\d]{64}$/u.test(url.searchParams.get("newsletterToken") ?? "") || url.searchParams.getAll("newsletterToken").length !== 1 || [...url.searchParams.keys()].some(key => key !== "newsletterToken")) throw new Error();
    } catch { throw new EmailError("email_invalid_intent"); }
    return { to: input.to, from: config.from, subject: copy[0], text: `${copy[1]}\n\n${url.href}`,
      html: `<h1>${escape(copy[0])}</h1><p>${escape(copy[1])}</p><p><a href="${escape(url.href)}">${escape(copy[0])}</a></p>` };
  }
  if (input.kind !== "contact-message" || !isEmailAddress(env.CONTACT_SUPPORT_EMAIL) || !isEmailAddress(input.email)
    || typeof input.name !== "string" || !input.name.trim() || input.name.length > 80 || /[\x00-\x1f\x7f]/u.test(input.name)
    || typeof input.message !== "string" || input.message.trim().length < 10 || input.message.length > 4000 || /[\x00\x0b\x0c\x7f]/u.test(input.message)) throw new EmailError("email_invalid_intent");
  const text = `${input.name}\n${input.email}\n\n${input.message}`;
  return { to: env.CONTACT_SUPPORT_EMAIL, from: config.from, subject: copy[2], text,
    html: `<h1>${escape(copy[2])}</h1><pre style="white-space:pre-wrap">${escape(text)}</pre>` };
}
