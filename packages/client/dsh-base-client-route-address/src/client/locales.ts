/** Localized copy for the invalid-address notice. */
export const NS = "dshBase.routeAddress";

/** Dictionary table registered with the official locale service. */
export const copy = {
  en: { invalidAddress: "That Session or Workspace link no longer exists." },
  zh: { invalidAddress: "这个会话或工作空间链接已不存在。" },
  ja: { invalidAddress: "そのセッションまたはワークスペースのリンクは存在しません。" },
  es: { invalidAddress: "Ese enlace de sesión o espacio de trabajo ya no existe." },
  fr: { invalidAddress: "Ce lien de session ou d'espace de travail n'existe plus." },
  de: { invalidAddress: "Dieser Sitzungs- oder Arbeitsbereichslink existiert nicht mehr." },
  ru: { invalidAddress: "Эта ссылка на сеанс или рабочую область больше не существует." },
  pt: { invalidAddress: "Esse link de sessão ou espaço de trabalho não existe mais." },
} as const;

/** Copy namespace key type. */
export type CopyKey = keyof typeof copy.en;

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dshBase.routeAddress": CopyKey;
  }
}
