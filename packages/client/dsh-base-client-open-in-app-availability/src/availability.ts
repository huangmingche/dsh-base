/** Honest native-open availability without inventing a local application catalog. */
import { APP_LABEL_KEY } from "@deepseek-ai/dsh-client-ui-open-in-app/src/client/applications.ts";

const reasons = {
  en: "Opening local applications is unavailable in this deployment.",
  zh: "当前部署不支持打开本地应用。",
  ja: "この環境ではローカルアプリを開けません。",
  es: "No se pueden abrir aplicaciones locales en este despliegue.",
  fr: "L’ouverture d’applications locales n’est pas disponible dans ce déploiement.",
  de: "Lokale Anwendungen können in dieser Bereitstellung nicht geöffnet werden.",
  ru: "В этом развертывании нельзя открывать локальные приложения.",
  pt: "Não é possível abrir aplicativos locais nesta implantação.",
} as const;

export function openInAppUnavailableReason(locale = "en"): string {
  return reasons[locale.toLowerCase().split(/[-_]/u)[0] as keyof typeof reasons] ?? reasons.en;
}

/** Both the actual workspace directory and a nameable Host application are required. */
export function canOpenDirectory(cwd: string | undefined, applications: readonly string[] | null): boolean {
  return Boolean(cwd) && applications !== null && applications.some(id => Object.hasOwn(APP_LABEL_KEY, id));
}
