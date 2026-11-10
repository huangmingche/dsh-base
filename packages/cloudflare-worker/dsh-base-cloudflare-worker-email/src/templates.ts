import { hreflangFor, isLocaleId, type LocaleId } from "../../../boot/dsh-base-locale-path/src/index.ts";
import type { EmailKind } from "./types.ts";

type Copy = { verify: string; reset: string; verifyBody: string; resetBody: string; ignore: string };
const COPY: Record<LocaleId, Copy> = {
  en: { verify: "Verify your email address", reset: "Reset your password", verifyBody: "Use the link below to verify your email address.", resetBody: "Use the link below to choose a new password.", ignore: "If you did not request this email, you can ignore it." },
  zh: { verify: "验证电子邮箱", reset: "重置密码", verifyBody: "请使用下方链接验证你的电子邮箱。", resetBody: "请使用下方链接设置新密码。", ignore: "如果你没有请求此邮件，请忽略。" },
  ja: { verify: "メールアドレスを確認", reset: "パスワードをリセット", verifyBody: "下のリンクからメールアドレスを確認してください。", resetBody: "下のリンクから新しいパスワードを設定してください。", ignore: "このメールに心当たりがない場合は、無視してください。" },
  es: { verify: "Verifica tu correo electrónico", reset: "Restablece tu contraseña", verifyBody: "Usa el siguiente enlace para verificar tu correo electrónico.", resetBody: "Usa el siguiente enlace para elegir una contraseña nueva.", ignore: "Si no solicitaste este correo, puedes ignorarlo." },
  fr: { verify: "Vérifiez votre adresse e-mail", reset: "Réinitialisez votre mot de passe", verifyBody: "Utilisez le lien ci-dessous pour vérifier votre adresse e-mail.", resetBody: "Utilisez le lien ci-dessous pour choisir un nouveau mot de passe.", ignore: "Si vous n’avez pas demandé cet e-mail, vous pouvez l’ignorer." },
  de: { verify: "E-Mail-Adresse bestätigen", reset: "Passwort zurücksetzen", verifyBody: "Bestätigen Sie Ihre E-Mail-Adresse über den folgenden Link.", resetBody: "Wählen Sie über den folgenden Link ein neues Passwort.", ignore: "Wenn Sie diese E-Mail nicht angefordert haben, können Sie sie ignorieren." },
  pt: { verify: "Confirme seu e-mail", reset: "Redefina sua senha", verifyBody: "Use o link abaixo para confirmar seu e-mail.", resetBody: "Use o link abaixo para escolher uma nova senha.", ignore: "Se você não solicitou este e-mail, pode ignorá-lo." },
  ru: { verify: "Подтвердите адрес электронной почты", reset: "Сбросьте пароль", verifyBody: "Перейдите по ссылке ниже, чтобы подтвердить адрес электронной почты.", resetBody: "Перейдите по ссылке ниже, чтобы задать новый пароль.", ignore: "Если вы не запрашивали это письмо, просто проигнорируйте его." },
};
const escape = (value: string): string => value.replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export function emailLocale(locale?: string): LocaleId {
  const language = locale?.toLowerCase().split(/[-_]/u)[0];
  return isLocaleId(language) ? language : "en";
}

/** Small static HTML and plain text; no React, remote images, tracking or raw HTML input. */
export function renderEmail(kind: EmailKind, actionUrl: string, locale?: string): { subject: string; html: string; text: string } {
  const language = emailLocale(locale);
  const copy = COPY[language];
  const subject = kind === "verify-email" ? copy.verify : copy.reset;
  const body = kind === "verify-email" ? copy.verifyBody : copy.resetBody;
  const html = `<!doctype html><html lang="${hreflangFor(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="font-family:Arial,sans-serif;color:#18181b;background:#ffffff"><main style="max-width:560px;margin:32px auto;padding:24px"><h1 style="font-size:24px">${escape(subject)}</h1><p>${escape(body)}</p><p><a href="${escape(actionUrl)}">${escape(subject)}</a></p><p style="font-size:14px;color:#52525b">${escape(copy.ignore)}</p></main></body></html>`;
  return { subject, html, text: `${subject}\n\n${body}\n\n${actionUrl}\n\n${copy.ignore}` };
}
