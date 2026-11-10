/** Counts use the page's official categories and preserve the bundle/component distinction. */
export const NS = 'pluginCounts'
export const COUNT_LOCALES = {
  en: {
    configurationOne: '{count} configuration entry', configurationMany: '{count} configuration entries',
    pluginOne: '{count} plugin', pluginMany: '{count} plugins',
    bundleOne: '{count} bundle', bundleMany: '{count} bundles',
    componentOne: '{count} component', componentMany: '{count} components',
    installed: '{bundles} · {components}',
  },
  zh: {
    configurationOne: '{count} 项配置', configurationMany: '{count} 项配置',
    pluginOne: '{count} 个插件', pluginMany: '{count} 个插件',
    bundleOne: '{count} 个插件包', bundleMany: '{count} 个插件包',
    componentOne: '{count} 个组件', componentMany: '{count} 个组件',
    installed: '{bundles} · {components}',
  },
  ja: {
    configurationOne: '設定項目 {count} 件', configurationMany: '設定項目 {count} 件',
    pluginOne: 'プラグイン {count} 個', pluginMany: 'プラグイン {count} 個',
    bundleOne: 'バンドル {count} 個', bundleMany: 'バンドル {count} 個',
    componentOne: 'コンポーネント {count} 個', componentMany: 'コンポーネント {count} 個',
    installed: '{bundles} · {components}',
  },
  es: {
    configurationOne: '{count} opción de configuración', configurationMany: '{count} opciones de configuración',
    pluginOne: '{count} plugin', pluginMany: '{count} plugins',
    bundleOne: '{count} paquete', bundleMany: '{count} paquetes',
    componentOne: '{count} componente', componentMany: '{count} componentes',
    installed: '{bundles} · {components}',
  },
  fr: {
    configurationOne: '{count} entrée de configuration', configurationMany: '{count} entrées de configuration',
    pluginOne: '{count} plugin', pluginMany: '{count} plugins',
    bundleOne: '{count} paquet', bundleMany: '{count} paquets',
    componentOne: '{count} composant', componentMany: '{count} composants',
    installed: '{bundles} · {components}',
  },
  de: {
    configurationOne: '{count} Konfigurationseintrag', configurationMany: '{count} Konfigurationseinträge',
    pluginOne: '{count} Plugin', pluginMany: '{count} Plugins',
    bundleOne: '{count} Paket', bundleMany: '{count} Pakete',
    componentOne: '{count} Komponente', componentMany: '{count} Komponenten',
    installed: '{bundles} · {components}',
  },
  ru: {
    configurationOne: 'Настройки: {count}', configurationMany: 'Настройки: {count}',
    pluginOne: 'Плагины: {count}', pluginMany: 'Плагины: {count}',
    bundleOne: 'Пакеты: {count}', bundleMany: 'Пакеты: {count}',
    componentOne: 'Компоненты: {count}', componentMany: 'Компоненты: {count}',
    installed: '{bundles} · {components}',
  },
  pt: {
    configurationOne: '{count} opção de configuração', configurationMany: '{count} opções de configuração',
    pluginOne: '{count} plugin', pluginMany: '{count} plugins',
    bundleOne: '{count} pacote', bundleMany: '{count} pacotes',
    componentOne: '{count} componente', componentMany: '{count} componentes',
    installed: '{bundles} · {components}',
  },
} as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'pluginCounts': keyof typeof COUNT_LOCALES.en
  }
}
