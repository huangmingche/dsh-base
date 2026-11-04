/** The Host has local account identity, but no DeepSeek Platform billing service. */
const reasons: Record<string, string> = {
  en: "Billing is unavailable in this deployment.",
  zh: "此部署不提供账单服务。",
  ja: "このデプロイでは請求サービスを利用できません。",
  es: "La facturación no está disponible en este despliegue.",
  fr: "La facturation n’est pas disponible dans ce déploiement.",
  de: "Die Abrechnung ist in dieser Bereitstellung nicht verfügbar.",
  ru: "Оплата недоступна в этом развёртывании.",
  pt: "A faturação não está disponível nesta implementação.",
};
export const billingUnavailableReason = (locale: string): string => reasons[locale] ?? reasons.en!;
