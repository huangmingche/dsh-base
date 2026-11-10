/** Launcher-only copy: the disabled reason and a defensive trigger-label fallback. */

/** Disabled reason for every locale the official account dictionary ships. */
export const UNAVAILABLE_REASONS = {
  en: 'Available after sign-in.',
  zh: '登录后可用。',
  ja: 'サインイン後に利用できます。',
  es: 'Disponible después de iniciar sesión.',
  fr: 'Disponible après connexion.',
  de: 'Nach der Anmeldung verfügbar.',
  ru: 'Доступно после входа.',
  pt: 'Disponível após iniciar sessão.',
} as const

/** Official locales the composition ships; used by the binding check. */
export const SUPPORTED_LOCALES = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const

export type LauncherLocale = keyof typeof UNAVAILABLE_REASONS

/** Normalize any BCP 47 id (`zh-CN`, `pt_BR`, …) to a dictionary key. */
function baseLocale(locale: string): string {
  const base = locale.toLowerCase().replaceAll('_', '-').split('-')[0]
  return base === undefined || base === '' ? 'en' : base
}

/**
 * Localized "available after sign-in" reason.
 * @param locale - active locale id.
 * @returns the reason for the base language, falling back to English.
 */
export function unavailableReason(locale: string): string {
  const base = baseLocale(locale) as LauncherLocale
  return UNAVAILABLE_REASONS[base] ?? UNAVAILABLE_REASONS.en
}

/**
 * Fail explicitly when an official dictionary is not bound.
 * Silent raw keys would ship a half-translated launcher or panel.
 * @param t - bound official translate function.
 * @param keys - labels that will be rendered.
 * @param surface - diagnostic name of the official namespace.
 * @throws when any label resolves to its raw key or empty.
 */
export function assertBoundLabels(t: (key: string) => string, keys: readonly string[], surface: string): void {
  for (const key of keys) {
    const value = t(key)
    if (typeof value !== 'string' || value === '' || value === key) {
      throw new Error(`account launcher: official ${surface} label "${key}" is not bound (got "${value}")`)
    }
  }
}

/**
 * Fail explicitly when the official `settings.account` menu namespace is not bound.
 * @param t - bound official translate function.
 * @throws when any menu label resolves to its raw key or empty.
 */
export function assertOfficialLabels(t: (key: string) => string): void {
  assertBoundLabels(t, ['menu', 'more', 'settings', 'contactUs', 'signIn'], 'settings.account')
}

/** Local account addition; it does not represent DeepSeek Platform authentication. */
export interface AccountSignInCopy {
  readonly title: string
  readonly description: string
  readonly signIn: string
  readonly platformUnavailable: string
}

export const ACCOUNT_SIGN_IN_COPY: Readonly<Record<LauncherLocale, AccountSignInCopy>> = {
  en: {
    title: 'Dsh-base account',
    description: 'Sign in to save conversations and manage your workspaces.',
    signIn: 'Sign in to Dsh-base',
    platformUnavailable: 'DeepSeek Platform sign-in is not available on this site.',
  },
  zh: {
    title: 'Dsh-base 账号',
    description: '登录后保存对话，并管理你的工作区。',
    signIn: '登录 Dsh-base',
    platformUnavailable: '本站暂不支持 DeepSeek 平台登录。',
  },
  ja: {
    title: 'Dsh-base アカウント',
    description: 'サインインして会話を保存し、ワークスペースを管理します。',
    signIn: 'Dsh-base にサインイン',
    platformUnavailable: 'このサイトでは DeepSeek Platform へのサインインは利用できません。',
  },
  es: {
    title: 'Cuenta de Dsh-base',
    description: 'Inicia sesión para guardar conversaciones y gestionar tus espacios de trabajo.',
    signIn: 'Iniciar sesión en Dsh-base',
    platformUnavailable: 'El inicio de sesión en DeepSeek Platform no está disponible en este sitio.',
  },
  fr: {
    title: 'Compte Dsh-base',
    description: 'Connectez-vous pour enregistrer vos conversations et gérer vos espaces de travail.',
    signIn: 'Se connecter à Dsh-base',
    platformUnavailable: 'La connexion à DeepSeek Platform n’est pas disponible sur ce site.',
  },
  de: {
    title: 'Dsh-base-Konto',
    description: 'Melden Sie sich an, um Gespräche zu speichern und Ihre Arbeitsbereiche zu verwalten.',
    signIn: 'Bei Dsh-base anmelden',
    platformUnavailable: 'Die Anmeldung bei DeepSeek Platform ist auf dieser Website nicht verfügbar.',
  },
  ru: {
    title: 'Аккаунт Dsh-base',
    description: 'Войдите, чтобы сохранять разговоры и управлять рабочими пространствами.',
    signIn: 'Войти в Dsh-base',
    platformUnavailable: 'Вход в DeepSeek Platform недоступен на этом сайте.',
  },
  pt: {
    title: 'Conta Dsh-base',
    description: 'Inicie sessão para guardar conversas e gerir os seus espaços de trabalho.',
    signIn: 'Iniciar sessão no Dsh-base',
    platformUnavailable: 'O início de sessão no DeepSeek Platform não está disponível neste site.',
  },
} as const

export function accountSignInCopy(locale: string): AccountSignInCopy {
  const base = baseLocale(locale) as LauncherLocale
  return ACCOUNT_SIGN_IN_COPY[base] ?? ACCOUNT_SIGN_IN_COPY.en
}

/** Anonymous access copy; provider configuration is unknown before sign-in. */
export interface ModelsCopy {
  readonly signInRequired: string
  readonly signIn: string
}
export const MODELS_COPY: Readonly<Record<LauncherLocale, ModelsCopy>> = {
  en: { signInRequired: "Sign in to manage model providers.", signIn: ACCOUNT_SIGN_IN_COPY.en.signIn },
  zh: { signInRequired: "登录后管理模型提供商。", signIn: ACCOUNT_SIGN_IN_COPY.zh.signIn },
  ja: { signInRequired: "サインインしてモデルプロバイダーを管理します。", signIn: ACCOUNT_SIGN_IN_COPY.ja.signIn },
  es: { signInRequired: "Inicia sesión para gestionar los proveedores de modelos.", signIn: ACCOUNT_SIGN_IN_COPY.es.signIn },
  fr: { signInRequired: "Connectez-vous pour gérer les fournisseurs de modèles.", signIn: ACCOUNT_SIGN_IN_COPY.fr.signIn },
  de: { signInRequired: "Melden Sie sich an, um Modellanbieter zu verwalten.", signIn: ACCOUNT_SIGN_IN_COPY.de.signIn },
  ru: { signInRequired: "Войдите, чтобы управлять провайдерами моделей.", signIn: ACCOUNT_SIGN_IN_COPY.ru.signIn },
  pt: { signInRequired: "Entre para gerir os fornecedores de modelos.", signIn: ACCOUNT_SIGN_IN_COPY.pt.signIn },
}

export function modelsCopy(locale: string): ModelsCopy {
  const base = baseLocale(locale) as LauncherLocale
  return MODELS_COPY[base] ?? MODELS_COPY.en
}
