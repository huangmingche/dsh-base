import { FIXED_AGENT_PRESET_ID } from "../../../boot/dsh-base-agent-presets/src/index.ts";

const locales = ["en", "zh", "ja", "es", "fr", "de", "ru", "pt"] as const;
type Locale = typeof locales[number];

/** Localized copy around the fixed Think composition and official declarations. */
export interface FixedAgentPresetCopy {
  /** Name of the actual fixed composition. */
  readonly thinkName: string;
  /** One sentence describing the fixed composition. */
  readonly thinkDescription: string;
  /** Why an official mode cannot compose a Session here. */
  /** Neutral reason the official mode is unavailable in this deployment. */
  readonly unavailableReason: string;
  /** Neutral badge label for unavailable official modes. */
  readonly unavailableBadge: string;
  /** Why the fixed composition has no readable official document. */
  readonly readUnavailable: string;
  /** Why preset selection is unavailable. */
  readonly selectUnavailable: string;
  /** Why Creator mode cannot start here. */
  readonly creatorUnavailable: string;
}

const copy: Record<Locale, FixedAgentPresetCopy> = {
  en: {
    thinkName: "Cloudflare Think",
    thinkDescription: "The fixed agent composition this deployment actually runs; it is not an official preset.",
    unavailableReason: "Unavailable in this deployment: This official mode needs Host-side Node, filesystem, terminal, or Cordis runtime capabilities that this Workers-native deployment cannot start.",
    unavailableBadge: "Unavailable",
    readUnavailable: "The Cloudflare Think composition has no official Cordis declaration to read.",
    selectUnavailable: "This deployment runs one fixed Cloudflare Think composition, so agent presets cannot be switched.",
    creatorUnavailable: "Creator mode needs the Cordis Host runner, which this Workers-native deployment cannot start.",
  },
  zh: {
    thinkName: "Cloudflare Think 模式",
    thinkDescription: "当前部署实际运行的固定智能体组合，不是官方预设。",
    unavailableReason: "当前部署不可用：该官方模式需要 Host 侧的 Node、文件系统、终端或 Cordis 运行时能力，当前 Workers 原生部署无法启动。",
    unavailableBadge: "不可用",
    readUnavailable: "当前 Cloudflare Think 模式组合没有可读取的官方 Cordis 声明。",
    selectUnavailable: "当前部署只运行固定的 Cloudflare Think 模式组合，无法切换 Agent 预设。",
    creatorUnavailable: "创造模式需要 Cordis Host runner，当前 Workers 原生部署无法启动。",
  },
  ja: {
    thinkName: "Cloudflare Think モード",
    thinkDescription: "この環境が実際に実行する固定エージェント構成です。公式プリセットではありません。",
    unavailableReason: "この環境では利用できません：この公式モードは Host 側の Node・ファイルシステム・ターミナル・Cordis ランタイムを必要とし、Workers ネイティブ環境では起動できません。",
    unavailableBadge: "利用不可",
    readUnavailable: "Cloudflare Think モード構成には読める公式 Cordis 宣言がありません。",
    selectUnavailable: "この環境はCloudflare Think モード構成のみを実行するため、エージェントプリセットを切り替えられません。",
    creatorUnavailable: "創造モードには Cordis Host runner が必要で、Workers ネイティブ環境では起動できません。",
  },
  es: {
    thinkName: "Modo Cloudflare Think",
    thinkDescription: "La composición de agente fija que ejecuta esta implementación; no es un preajuste oficial.",
    unavailableReason: "No disponible en esta implementación: Este modo oficial necesita capacidades de Node, archivos, terminal o Cordis del Host que esta implementación nativa de Workers no puede iniciar.",
    unavailableBadge: "No disponible",
    readUnavailable: "Esta composición del modo Cloudflare Think no tiene una declaración oficial de Cordis que leer.",
    selectUnavailable: "Esta implementación ejecuta una única composición del modo Cloudflare Think; no se pueden cambiar los preajustes.",
    creatorUnavailable: "El modo Creador necesita el ejecutor Cordis del Host, que esta implementación nativa de Workers no puede iniciar.",
  },
  fr: {
    thinkName: "Mode Cloudflare Think",
    thinkDescription: "La composition d'agent fixe réellement exécutée par ce déploiement ; ce n'est pas un préréglage officiel.",
    unavailableReason: "Indisponible dans ce déploiement : Ce mode officiel nécessite les capacités Node, fichiers, terminal ou Cordis du Host, que ce déploiement natif Workers ne peut pas démarrer.",
    unavailableBadge: "Indisponible",
    readUnavailable: "Cette composition du mode Cloudflare Think n'a aucune déclaration Cordis officielle à lire.",
    selectUnavailable: "Ce déploiement exécute une seule composition du mode Cloudflare Think ; les préréglages ne peuvent pas être changés.",
    creatorUnavailable: "Le mode Créateur nécessite le runner Cordis du Host, que ce déploiement natif Workers ne peut pas démarrer.",
  },
  de: {
    thinkName: "Cloudflare Think-Modus",
    thinkDescription: "Die feste Agentenzusammenstellung, die diese Bereitstellung tatsächlich ausführt; kein offizielles Preset.",
    unavailableReason: "In dieser Bereitstellung nicht verfügbar: Dieser offizielle Modus benötigt Node-, Dateisystem-, Terminal- oder Cordis-Laufzeitfähigkeiten auf dem Host, die diese Workers-native Bereitstellung nicht starten kann.",
    unavailableBadge: "Nicht verfügbar",
    readUnavailable: "Diese Cloudflare Think-Modus-Zusammenstellung besitzt keine offizielle Cordis-Deklaration zum Lesen.",
    selectUnavailable: "Diese Bereitstellung führt nur eine Cloudflare Think-Modus-Zusammenstellung aus; Presets können nicht gewechselt werden.",
    creatorUnavailable: "Der Creator-Modus benötigt den Cordis-Host-Runner, den diese Workers-native Bereitstellung nicht starten kann.",
  },
  ru: {
    thinkName: "Режим Cloudflare Think",
    thinkDescription: "Фиксированный состав агента, который фактически выполняет это развёртывание; это не официальная предустановка.",
    unavailableReason: "Недоступно в этом развёртывании: Этому официальному режиму нужны возможности Node, файловой системы, терминала или среды Cordis на Host, которые это Workers-развёртывание не может запустить.",
    unavailableBadge: "Недоступно",
    readUnavailable: "У состава режима Cloudflare Think нет официального объявления Cordis для чтения.",
    selectUnavailable: "Это развёртывание выполняет единый фиксированный состав режима Cloudflare Think; переключение предустановок недоступно.",
    creatorUnavailable: "Режиму создания нужен Cordis Host runner, который это Workers-развёртывание не может запустить.",
  },
  pt: {
    thinkName: "Modo Cloudflare Think",
    thinkDescription: "A composição de agente fixa que esta implantação realmente executa; não é uma predefinição oficial.",
    unavailableReason: "Indisponível nesta implantação: Este modo oficial exige recursos de Node, sistema de arquivos, terminal ou runtime Cordis no Host, que esta implantação nativa de Workers não consegue iniciar.",
    unavailableBadge: "Indisponível",
    readUnavailable: "Esta composição do modo Cloudflare Think não tem uma declaração oficial do Cordis para ler.",
    selectUnavailable: "Esta implantação executa uma única composição do modo Cloudflare Think; não é possível alternar predefinições.",
    creatorUnavailable: "O modo Criador exige o Cordis Host runner, que esta implantação nativa de Workers não consegue iniciar.",
  },
};

/** Normalize one locale tag to a supported dictionary key. */
function normalized(locale: string): Locale {
  const primary = locale.toLowerCase().split("-")[0] as Locale;
  return locales.includes(primary) ? primary : "en";
}

/** Localized copy for the fixed composition and unavailable official modes. */
export function fixedAgentPresetCopy(locale = "en"): FixedAgentPresetCopy {
  return copy[normalized(locale)];
}

/** Generic reason attached to direct preset RPC refusals. */
export function agentPresetUnavailableReason(locale = "en"): string {
  return fixedAgentPresetCopy(locale).selectUnavailable;
}

/** Localized display name of the fixed composition. */
export function fixedAgentLabel(locale = "en"): string {
  return fixedAgentPresetCopy(locale).thinkName;
}

/** Canonical fixed composition id, re-exported for client callers. */
export { FIXED_AGENT_PRESET_ID };
