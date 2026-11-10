/** Sidebar More dictionaries; pure data so the completeness guard needs no browser. */
export const MORE_NS = "dshBase.sidebarMore";
/**
 * Product rows appended after the official More entries.
 *
 * Configured facts render as live rows. A missing support mailbox or
 * environment label keeps its row visible but disabled with a localized
 * reason: the deployment truth is "not configured", never a placeholder.
 */
export const moreCopy = {
  en: {
    about: "About", support: "Contact support", environment: "Environment",
    environmentHint: "Deployment environment, read-only.",
    supportUnavailable: "No support mailbox is configured for this deployment.",
    environmentUnavailable: "No environment label is configured for this deployment.",
    environmentMissing: "Environment: not configured",
  },
  zh: {
    about: "关于", support: "联系支持", environment: "环境",
    environmentHint: "部署环境，只读。",
    supportUnavailable: "此部署未配置支持邮箱。",
    environmentUnavailable: "此部署未配置环境标识。",
    environmentMissing: "环境：未配置",
  },
  ja: {
    about: "概要", support: "サポートに連絡", environment: "環境",
    environmentHint: "デプロイ環境（読み取り専用）。",
    supportUnavailable: "このデプロイにはサポート用メールアドレスが設定されていません。",
    environmentUnavailable: "このデプロイには環境ラベルが設定されていません。",
    environmentMissing: "環境: 未設定",
  },
  es: {
    about: "Acerca de", support: "Contactar soporte", environment: "Entorno",
    environmentHint: "Entorno de despliegue, solo lectura.",
    supportUnavailable: "Este despliegue no tiene un buzón de soporte configurado.",
    environmentUnavailable: "Este despliegue no tiene una etiqueta de entorno configurada.",
    environmentMissing: "Entorno: sin configurar",
  },
  fr: {
    about: "À propos", support: "Contacter le support", environment: "Environnement",
    environmentHint: "Environnement de déploiement, lecture seule.",
    supportUnavailable: "Aucune boîte de support n'est configurée pour ce déploiement.",
    environmentUnavailable: "Aucun libellé d'environnement n'est configuré pour ce déploiement.",
    environmentMissing: "Environnement : non configuré",
  },
  de: {
    about: "Über", support: "Support kontaktieren", environment: "Umgebung",
    environmentHint: "Bereitstellungsumgebung, schreibgeschützt.",
    supportUnavailable: "Für diese Bereitstellung ist kein Support-Postfach konfiguriert.",
    environmentUnavailable: "Für diese Bereitstellung ist kein Umgebungslabel konfiguriert.",
    environmentMissing: "Umgebung: nicht konfiguriert",
  },
  ru: {
    about: "О продукте", support: "Связаться с поддержкой", environment: "Среда",
    environmentHint: "Среда развертывания, только чтение.",
    supportUnavailable: "Для этого развертывания не настроен почтовый ящик поддержки.",
    environmentUnavailable: "Для этого развертывания не настроена метка среды.",
    environmentMissing: "Среда: не настроена",
  },
  pt: {
    about: "Sobre", support: "Contactar suporte", environment: "Ambiente",
    environmentHint: "Ambiente de implantação, somente leitura.",
    supportUnavailable: "Nenhuma caixa de suporte está configurada para esta implantação.",
    environmentUnavailable: "Nenhum rótulo de ambiente está configurado para esta implantação.",
    environmentMissing: "Ambiente: não configurado",
  },
} as const;

/** Dictionary table registered with the official locale service. */
export const MORE_DICTIONARIES = moreCopy;
