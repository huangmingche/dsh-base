/** Capability facts displayed beside the unchanged official configuration summaries. */
export type BuiltinId = 'subagent' | 'web-search' | 'agent-loop' | 'shell'
type Copy = { unavailable: string } & Record<BuiltinId, string>
const COPY: Record<string, Copy> = {
  en: { unavailable: 'Unavailable', subagent: 'This deployment does not provide subagent delegation.', 'web-search': 'This deployment does not provide the official web search and fetch providers.', 'agent-loop': 'The official parallel tool-call setting is not supported by this Cloudflare Think runtime.', shell: 'Cloudflare Workers does not provide a native shell executor.' },
  zh: { unavailable: '不可用', subagent: '本部署未提供子智能体委派能力。', 'web-search': '本部署未提供官方网页搜索与抓取服务。', 'agent-loop': '当前 Cloudflare Think 运行时不支持官方的并行工具调用设置。', shell: 'Cloudflare Workers 不提供原生 Shell 执行器。' },
  ja: { unavailable: '利用不可', subagent: 'このデプロイではサブエージェントへの委譲を提供していません。', 'web-search': 'このデプロイでは公式のウェブ検索・取得プロバイダーを提供していません。', 'agent-loop': 'この Cloudflare Think ランタイムは公式の並列ツール呼び出し設定に対応していません。', shell: 'Cloudflare Workers はネイティブシェル実行環境を提供していません。' },
  es: { unavailable: 'No disponible', subagent: 'Este despliegue no ofrece delegación a subagentes.', 'web-search': 'Este despliegue no ofrece los proveedores oficiales de búsqueda y lectura web.', 'agent-loop': 'Este entorno Cloudflare Think no admite el ajuste oficial de llamadas de herramientas en paralelo.', shell: 'Cloudflare Workers no ofrece un ejecutor de shell nativo.' },
  fr: { unavailable: 'Indisponible', subagent: 'Ce déploiement ne propose pas de délégation aux sous-agents.', 'web-search': 'Ce déploiement ne propose pas les fournisseurs officiels de recherche et de récupération web.', 'agent-loop': 'Ce runtime Cloudflare Think ne prend pas en charge le réglage officiel des appels d’outils parallèles.', shell: 'Cloudflare Workers ne fournit pas d’exécuteur de shell natif.' },
  de: { unavailable: 'Nicht verfügbar', subagent: 'Diese Bereitstellung bietet keine Delegation an Subagenten.', 'web-search': 'Diese Bereitstellung bietet die offiziellen Anbieter für Websuche und Webabruf nicht an.', 'agent-loop': 'Diese Cloudflare-Think-Laufzeit unterstützt die offizielle Einstellung für parallele Werkzeugaufrufe nicht.', shell: 'Cloudflare Workers bietet keine native Shell-Ausführung.' },
  ru: { unavailable: 'Недоступно', subagent: 'Это развёртывание не предоставляет делегирование субагентам.', 'web-search': 'Это развёртывание не предоставляет официальные службы поиска и получения веб-страниц.', 'agent-loop': 'Эта среда Cloudflare Think не поддерживает официальную настройку параллельных вызовов инструментов.', shell: 'Cloudflare Workers не предоставляет исполнение команд в системной оболочке.' },
  pt: { unavailable: 'Indisponível', subagent: 'Esta implantação não oferece delegação a subagentes.', 'web-search': 'Esta implantação não oferece os provedores oficiais de pesquisa e leitura da web.', 'agent-loop': 'Este runtime Cloudflare Think não suporta a configuração oficial de chamadas paralelas de ferramentas.', shell: 'O Cloudflare Workers não oferece um executor de shell nativo.' },
}

export function builtinAvailability(id: BuiltinId, locale: string) {
  const copy = COPY[locale.split(/[-_]/u)[0] ?? 'en'] ?? COPY.en!
  return { label: copy.unavailable, reason: copy[id] }
}

export const BUILTIN_ITEMS = [
  { id: 'subagent', order: 10, namespaces: ['subagent', 'subagent-model-selection-settings'], locale: 'settings.subagent', title: 'subagentTitle' },
  { id: 'web-search', order: 20, namespaces: ['web-search-deepseek'], locale: 'settings.webSearch', title: 'title' },
  { id: 'agent-loop', order: 30, namespaces: ['agent-loop'], locale: 'settings.agentLoop', title: 'title' },
  { id: 'shell', order: 40, namespaces: ['bash-sandbox', 'pwsh-sandbox'], locale: 'settings.shell', title: 'title' },
] as const
