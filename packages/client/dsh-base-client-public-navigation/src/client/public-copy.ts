/** Account-boundary copy; the official pages retain their own layout and controls. */
export const PUBLIC_COPY = {
  en: { configure: 'Sign in to configure this plugin.', plugins: 'Browse deployed plugins. Sign in to manage your settings.', tasks: 'Sign in to view your automation tasks', signIn: 'Sign in', declared: 'Deployment default' },
  zh: { configure: '登录后配置此插件。', plugins: '查看部署提供的插件。登录后管理自己的设置。', tasks: '登录后查看你的自动化任务', signIn: '登录', declared: '部署默认值' },
  ja: { configure: 'このプラグインの設定にはサインインしてください。', plugins: 'デプロイ済みのプラグインを表示します。設定の管理にはサインインしてください。', tasks: 'サインインして自動化タスクを表示', signIn: 'サインイン', declared: 'デプロイの既定値' },
  es: { configure: 'Inicia sesión para configurar este complemento.', plugins: 'Explora los complementos disponibles. Inicia sesión para gestionar tus ajustes.', tasks: 'Inicia sesión para ver tus tareas de automatización', signIn: 'Iniciar sesión', declared: 'Valor predeterminado' },
  fr: { configure: 'Connectez-vous pour configurer ce plugin.', plugins: 'Consultez les plugins déployés. Connectez-vous pour gérer vos réglages.', tasks: 'Connectez-vous pour voir vos tâches automatisées', signIn: 'Se connecter', declared: 'Valeur du déploiement' },
  de: { configure: 'Zum Konfigurieren dieses Plugins anmelden.', plugins: 'Bereitgestellte Plugins ansehen. Zum Verwalten deiner Einstellungen anmelden.', tasks: 'Anmelden, um deine Automatisierungsaufgaben zu sehen', signIn: 'Anmelden', declared: 'Deployment-Standard' },
  ru: { configure: 'Войдите, чтобы настроить этот плагин.', plugins: 'Просматривайте доступные плагины. Войдите, чтобы управлять настройками.', tasks: 'Войдите, чтобы увидеть свои задачи автоматизации', signIn: 'Войти', declared: 'По умолчанию' },
  pt: { configure: 'Inicie sessão para configurar este plugin.', plugins: 'Veja os plugins disponíveis. Inicie sessão para gerir as suas definições.', tasks: 'Inicie sessão para ver as suas tarefas de automação', signIn: 'Iniciar sessão', declared: 'Predefinição da implantação' },
} as const
export function publicCopy(locale: string) {
  return PUBLIC_COPY[locale.toLowerCase().split('-')[0] as keyof typeof PUBLIC_COPY] ?? PUBLIC_COPY.en
}
