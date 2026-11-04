/** The missing Host capability, shared by its disabled view and Remote failure. */
const reasons = {
  en: "Feedback submission is unavailable because this deployment has no conversation log feedback service.",
  zh: "当前部署尚无对话日志反馈服务，无法提交反馈。",
  ja: "この環境には会話ログのフィードバックサービスがないため、フィードバックを送信できません。",
  es: "No se pueden enviar comentarios porque no hay un servicio de comentarios con el registro de la conversación.",
  fr: "Les commentaires sont indisponibles : ce déploiement n'a pas de service de commentaires avec le journal de conversation.",
  de: "Feedback ist nicht verfügbar, da der Feedbackdienst für Gesprächsprotokolle fehlt.",
  ru: "Отзывы недоступны: отсутствует служба отзывов с журналом беседы.",
  pt: "O feedback está indisponível porque não há um serviço de feedback com o registro da conversa.",
} as const;

export function feedbackUnavailableReason(locale = "en"): string {
  return reasons[locale.toLowerCase().split("-")[0] as keyof typeof reasons] ?? reasons.en;
}
