/** Localized Host limitation shared by disabled official controls and commands. */
export const permissionAvailability = {
  en: { label: "Unavailable", reason: "Workers execution has no official per-session permission runtime." },
  zh: { label: "不可用", reason: "Workers 执行环境尚未提供官方的会话级权限运行时。" },
  ja: { label: "利用不可", reason: "Workers 実行環境には、公式のセッションごとの権限ランタイムがありません。" },
  es: { label: "No disponible", reason: "Workers no dispone del entorno oficial de permisos por sesión." },
  fr: { label: "Indisponible", reason: "Workers ne dispose pas du moteur officiel de permissions par session." },
  de: { label: "Nicht verfügbar", reason: "Workers unterstützt die offizielle Berechtigungsverwaltung pro Sitzung noch nicht." },
  ru: { label: "Недоступно", reason: "В Workers нет официальной среды управления правами отдельных сеансов." },
  pt: { label: "Indisponível", reason: "O Workers não dispõe do ambiente oficial de permissões por sessão." },
} as const;

export function permissionUnavailableReason(locale: string = "en"): string {
  const language = locale.toLowerCase().split("-")[0] as keyof typeof permissionAvailability;
  return (permissionAvailability[language] ?? permissionAvailability.en).reason;
}
