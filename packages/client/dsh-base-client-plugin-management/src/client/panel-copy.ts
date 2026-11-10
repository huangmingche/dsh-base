/** Copy key selection for the management-scope panel; pure so tests need no CSS or browser. */
import type { PluginsSubject } from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import { GATEWAY_BUNDLE_NAME } from "../../../../boot/dsh-base-plugin-management/src/index.ts";

/** Keys the panel may render; every one exists in the plugin's English dictionary. */
export type ManagementPanelKey =
  | "workerTitle" | "workerBody"
  | "thinkTitle" | "thinkBody" | "thinkManagedBody"
  | "subagentTitle" | "subagentBody"
  | "officialUnavailableTitle" | "officialUnavailableBody"
  | "requiredTitle" | "requiredBody"
  | "unbundledTitle" | "unbundledBody"
  | "gatewayTitle" | "gatewayBody"
  | "optionalTitle" | "optionalBody";

/** The unified bundle controls owner defaults; Session overrides keep their separate scope. */
export const GATEWAY_PANEL_COPY = {
  "en": {
    "gatewayTitle": "Account defaults",
    "gatewayBody": "Controls platform models and their settings for this account. Session settings take precedence. Turning it off does not stop requests already running or affect your own API key."
  },
  "zh": {
    "gatewayTitle": "账号默认设置",
    "gatewayBody": "管理本账号的平台模型及其设置。会话中的单独设置优先；关闭不会中断正在执行的请求，也不影响自带 API Key。"
  },
  "ja": {
    "gatewayTitle": "アカウントの既定設定",
    "gatewayBody": "このアカウントのプラットフォームモデルとその設定を管理します。セッションごとの設定が優先されます。無効にしても実行中のリクエストは停止せず、自分の API キーにも影響しません。"
  },
  "es": {
    "gatewayTitle": "Valores predeterminados de la cuenta",
    "gatewayBody": "Controla los modelos de la plataforma y sus ajustes para esta cuenta. Los ajustes de la sesión tienen prioridad. Desactivarlo no detiene solicitudes en curso ni afecta a tu propia clave API."
  },
  "fr": {
    "gatewayTitle": "Réglages par défaut du compte",
    "gatewayBody": "Gère les modèles de la plateforme et leurs réglages pour ce compte. Les réglages de la session sont prioritaires. La désactivation n’arrête pas les requêtes en cours et n’affecte pas votre propre clé API."
  },
  "de": {
    "gatewayTitle": "Kontovorgaben",
    "gatewayBody": "Verwaltet die Plattformmodelle und ihre Einstellungen für dieses Konto. Sitzungseinstellungen haben Vorrang. Das Ausschalten stoppt keine laufenden Anfragen und hat keinen Einfluss auf Ihren eigenen API-Schlüssel."
  },
  "ru": {
    "gatewayTitle": "Настройки аккаунта по умолчанию",
    "gatewayBody": "Управляет моделями платформы и их настройками для этого аккаунта. Настройки сеанса имеют приоритет. Отключение не останавливает текущие запросы и не влияет на ваш собственный API-ключ."
  },
  "pt": {
    "gatewayTitle": "Predefinições da conta",
    "gatewayBody": "Gere os modelos da plataforma e as respetivas definições para esta conta. As definições da sessão têm prioridade. Desativá-lo não interrompe pedidos em curso nem afeta a sua própria chave API."
  }
} as const;

/** Concise status and scope explanations for the official detail slot. */
export const MANAGEMENT_PANEL_COPY = {
  "en": {
    "officialUnavailableTitle": "Unavailable in this deployment",
    "officialUnavailableBody": "This plugin has not been adapted to this deployment and cannot be installed or enabled here.",
    "workerTitle": "Deployment managed",
    "workerBody": "This service is deployed with the site and can only be changed by updating the deployment.",
    "thinkTitle": "Preset managed",
    "thinkBody": "This feature is provided by the session preset and cannot be switched off separately here.",
    "subagentTitle": "Subagent unavailable",
    "subagentBody": "This deployment does not support delegating tasks to subagents.",
    "requiredTitle": "Required by the app",
    "requiredBody": "Managed as part of the app. It cannot be switched off here.",
    "unbundledTitle": "Not enabled",
    "unbundledBody": "This component remains in the plugin list, but this deployment does not load it.",
    "thinkManagedBody": "Changes become the account default for subsequent requests. Session settings take precedence.",
    "optionalTitle": "Account defaults",
    "optionalBody": "Changes are saved for this account. The interface will tell you if the page needs to be refreshed."
  },
  "zh": {
    "officialUnavailableTitle": "当前部署不可用",
    "officialUnavailableBody": "此插件尚未适配当前部署，暂时无法安装或启用。",
    "workerTitle": "部署管理",
    "workerBody": "此服务随站点一起部署，只能通过更新部署调整。",
    "thinkTitle": "预设管理",
    "thinkBody": "此功能由会话预设提供，不能在这里单独停用。",
    "subagentTitle": "子智能体不可用",
    "subagentBody": "当前部署不支持将任务交给子智能体。",
    "requiredTitle": "应用所需",
    "requiredBody": "此功能由应用统一管理，不能在这里停用。",
    "unbundledTitle": "未启用",
    "unbundledBody": "此组件保留在插件清单中，当前部署不加载它。",
    "thinkManagedBody": "更改会作为本账号的默认设置，在后续请求中生效。会话中的单独设置优先。",
    "optionalTitle": "账号默认设置",
    "optionalBody": "更改会保存到本账号；若需要刷新页面，界面会给出提示。"
  },
  "ja": {
    "officialUnavailableTitle": "このデプロイでは利用不可",
    "officialUnavailableBody": "このプラグインは現在のデプロイに未対応のため、ここではインストールや有効化ができません。",
    "workerTitle": "デプロイで管理",
    "workerBody": "このサービスはサイトと一緒にデプロイされ、変更にはデプロイの更新が必要です。",
    "thinkTitle": "プリセットで管理",
    "thinkBody": "この機能はセッションのプリセットによって提供され、ここでは個別に無効化できません。",
    "subagentTitle": "サブエージェントは利用不可",
    "subagentBody": "このデプロイではサブエージェントへのタスクの委譲に対応していません。",
    "requiredTitle": "システムに必要",
    "requiredBody": "この機能はアプリの一部としてシステムが有効にするため、ここでは無効化できません。",
    "unbundledTitle": "未有効化",
    "unbundledBody": "このコンポーネントはプラグイン一覧に残っていますが、現在のデプロイでは読み込まれません。",
    "thinkManagedBody": "変更は以降のリクエストでアカウントの既定設定として適用されます。セッションごとの設定が優先されます。",
    "optionalTitle": "アカウントの既定設定",
    "optionalBody": "変更はこのアカウントに保存されます。ページの再読み込みが必要な場合は画面に表示されます。"
  },
  "es": {
    "officialUnavailableTitle": "No disponible en este despliegue",
    "officialUnavailableBody": "Este complemento no se ha adaptado a este despliegue y no se puede instalar ni activar aquí.",
    "workerTitle": "Gestionado por el despliegue",
    "workerBody": "Este servicio se despliega con el sitio y solo se puede cambiar actualizando el despliegue.",
    "thinkTitle": "Gestionado por el preajuste",
    "thinkBody": "Esta función la proporciona el preajuste de la sesión y no se puede desactivar por separado aquí.",
    "subagentTitle": "Subagente no disponible",
    "subagentBody": "Este despliegue no permite delegar tareas a subagentes.",
    "requiredTitle": "Necesario para el sistema",
    "requiredBody": "El sistema activa esta función como parte de la aplicación. No se puede desactivar aquí.",
    "unbundledTitle": "No activado",
    "unbundledBody": "Este componente se conserva en la lista de complementos, pero el despliegue no lo carga.",
    "thinkManagedBody": "Los cambios se aplican como valores predeterminados de la cuenta para las siguientes solicitudes. Los ajustes de la sesión tienen prioridad.",
    "optionalTitle": "Valores predeterminados de la cuenta",
    "optionalBody": "Los cambios se guardan para esta cuenta. La interfaz indicará si es necesario recargar la página."
  },
  "fr": {
    "officialUnavailableTitle": "Indisponible dans ce déploiement",
    "officialUnavailableBody": "Ce plugin n’a pas été adapté à ce déploiement et ne peut pas être installé ou activé ici.",
    "workerTitle": "Géré par le déploiement",
    "workerBody": "Ce service est déployé avec le site. Seule une mise à jour du déploiement permet de le modifier.",
    "thinkTitle": "Géré par le préréglage",
    "thinkBody": "Cette fonctionnalité est fournie par le préréglage de la session et ne peut pas être désactivée séparément ici.",
    "subagentTitle": "Sous-agent indisponible",
    "subagentBody": "Ce déploiement ne permet pas de déléguer des tâches à des sous-agents.",
    "requiredTitle": "Nécessaire au système",
    "requiredBody": "Le système active cette fonctionnalité comme partie de l’application. Elle ne peut pas être désactivée ici.",
    "unbundledTitle": "Non activé",
    "unbundledBody": "Ce composant reste dans la liste des plugins, mais ce déploiement ne le charge pas.",
    "thinkManagedBody": "Les changements deviennent les réglages par défaut du compte pour les requêtes suivantes. Les réglages de la session sont prioritaires.",
    "optionalTitle": "Réglages par défaut du compte",
    "optionalBody": "Les changements sont enregistrés pour ce compte. L’interface vous indiquera si la page doit être rechargée."
  },
  "de": {
    "officialUnavailableTitle": "In dieser Bereitstellung nicht verfügbar",
    "officialUnavailableBody": "Dieses Plugin wurde nicht an diese Bereitstellung angepasst und kann hier weder installiert noch aktiviert werden.",
    "workerTitle": "Durch die Bereitstellung verwaltet",
    "workerBody": "Dieser Dienst wird zusammen mit der Website bereitgestellt und lässt sich nur durch eine neue Bereitstellung ändern.",
    "thinkTitle": "Durch die Voreinstellung verwaltet",
    "thinkBody": "Diese Funktion wird durch die Sitzungsvoreinstellung bereitgestellt und kann hier nicht einzeln ausgeschaltet werden.",
    "subagentTitle": "Subagent nicht verfügbar",
    "subagentBody": "Diese Bereitstellung unterstützt keine Aufgabenübergabe an Subagenten.",
    "requiredTitle": "Vom System benötigt",
    "requiredBody": "Das System aktiviert diese Funktion als Teil der Anwendung. Sie kann hier nicht ausgeschaltet werden.",
    "unbundledTitle": "Nicht aktiviert",
    "unbundledBody": "Diese Komponente bleibt in der Plugin-Liste, wird von dieser Bereitstellung aber nicht geladen.",
    "thinkManagedBody": "Änderungen gelten als Kontovorgaben für nachfolgende Anfragen. Sitzungseinstellungen haben Vorrang.",
    "optionalTitle": "Kontovorgaben",
    "optionalBody": "Änderungen werden für dieses Konto gespeichert. Die Oberfläche zeigt an, wenn die Seite neu geladen werden muss."
  },
  "ru": {
    "officialUnavailableTitle": "Недоступно в этом развёртывании",
    "officialUnavailableBody": "Этот плагин не адаптирован к данному развёртыванию и не может быть установлен или включён здесь.",
    "workerTitle": "Управляется развёртыванием",
    "workerBody": "Эта служба развёртывается вместе с сайтом. Изменить её можно только обновлением развёртывания.",
    "thinkTitle": "Управляется предустановкой",
    "thinkBody": "Эта функция предоставляется предустановкой сеанса и не может быть отключена здесь отдельно.",
    "subagentTitle": "Субагент недоступен",
    "subagentBody": "В этом развёртывании нельзя передавать задачи субагентам.",
    "requiredTitle": "Необходимо системе",
    "requiredBody": "Система включает эту функцию как часть приложения. Её нельзя отключить здесь.",
    "unbundledTitle": "Не включено",
    "unbundledBody": "Этот компонент остаётся в списке плагинов, но данное развёртывание его не загружает.",
    "thinkManagedBody": "Изменения станут настройками аккаунта по умолчанию для последующих запросов. Настройки сеанса имеют приоритет.",
    "optionalTitle": "Настройки аккаунта по умолчанию",
    "optionalBody": "Изменения сохраняются для этого аккаунта. Интерфейс сообщит, если потребуется обновить страницу."
  },
  "pt": {
    "officialUnavailableTitle": "Indisponível nesta implantação",
    "officialUnavailableBody": "Este plug-in não foi adaptado a esta implantação e não pode ser instalado nem ativado aqui.",
    "workerTitle": "Gerido pela implantação",
    "workerBody": "Este serviço é implantado com o site e só pode ser alterado através de uma atualização da implantação.",
    "thinkTitle": "Gerido pela predefinição",
    "thinkBody": "Esta funcionalidade é fornecida pela predefinição da sessão e não pode ser desativada separadamente aqui.",
    "subagentTitle": "Subagente indisponível",
    "subagentBody": "Esta implantação não permite delegar tarefas a subagentes.",
    "requiredTitle": "Necessário para o sistema",
    "requiredBody": "O sistema ativa esta funcionalidade como parte da aplicação. Não pode ser desativada aqui.",
    "unbundledTitle": "Não ativado",
    "unbundledBody": "Este componente permanece na lista de plug-ins, mas esta implantação não o carrega.",
    "thinkManagedBody": "As alterações tornam-se as predefinições da conta para pedidos seguintes. As definições da sessão têm prioridade.",
    "optionalTitle": "Predefinições da conta",
    "optionalBody": "As alterações são guardadas para esta conta. A interface indica se é necessário atualizar a página."
  }
} as const;

/** The restored subagent think row is declared unavailable, not a read-only live row. */
export const SUBAGENT_MODULE = "@dsh-base/cloudflare-think-subagent";
export const SUBAGENT_PANEL_KEY = { title: "subagentTitle", body: "subagentBody" } as const satisfies {
  readonly title: ManagementPanelKey;
  readonly body: ManagementPanelKey;
};

/**
 * Pick the panel copy for one plugin detail subject.
 * @param subject - the official plugin page subject.
 * @param isManageableThink - generated L1 Think allowlist predicate.
 * @param isManageableClient - generated L1 client allowlist predicate.
 * @returns the copy keys, or undefined for keyed (non-package) subjects.
 */
export function panelKey(
  subject: PluginsSubject,
  isManageableThink: (name: string) => boolean,
  isManageableClient: (name: string) => boolean,
): { title: ManagementPanelKey; body: ManagementPanelKey } | undefined {
  if (subject.kind === "item") return undefined;
  if (subject.pkg.official && subject.pkg.availability === "missing" && !subject.pkg.enabled) {
    return { title: "officialUnavailableTitle", body: "officialUnavailableBody" };
  }
  const name = subject.pkg.name;
  // The Host distinguishes a visible read-only component from a disabled one.
  // Unknown policy metadata must not relabel an ordinary or writable bundle.
  const hostPolicy = subject.pkg as { readOnlyReason?: unknown; managementPolicy?: unknown };
  if (hostPolicy.readOnlyReason === "unaddressable") {
    if (hostPolicy.managementPolicy === "required") return { title: "requiredTitle", body: "requiredBody" };
    if (hostPolicy.managementPolicy === "deployment") return { title: "workerTitle", body: "workerBody" };
  }
  if (name === GATEWAY_BUNDLE_NAME) return { title: "gatewayTitle", body: "gatewayBody" };
  // Checked before the generic Think branch: this row's reason is an explicit
  // unavailable declaration, not the read-only composition text.
  if (name === SUBAGENT_MODULE) return SUBAGENT_PANEL_KEY;
  if (name.startsWith("@dsh-base/cloudflare-worker-")) return { title: "workerTitle", body: "workerBody" };
  if (isManageableThink(name)) return { title: "optionalTitle", body: "thinkManagedBody" };
  if (name.startsWith("@dsh-base/cloudflare-think-")) return { title: "thinkTitle", body: "thinkBody" };
  if (isManageableClient(name)) return { title: "optionalTitle", body: "optionalBody" };
  if (!subject.pkg.enabled) return { title: "unbundledTitle", body: "unbundledBody" };
  return { title: "requiredTitle", body: "requiredBody" };
}
