/** Checked SaaS account availability, independent of the official RemoteAccess grants. */
import type { accountSession } from './account-session.ts';

export type NavigationAccessState = 'checking' | 'anonymous' | 'authenticated' | 'error';
export interface NavigationAccess {
  getSnapshot(): NavigationAccessState;
  subscribe(listener: () => void): () => void;
}
export interface NavigationAvailability {
  readonly state: NavigationAccessState;
  readonly allowed: boolean;
  readonly reason: string;
  readonly emptyLabel: string;
  readonly signInLabel: string;
}
declare module '@deepseek-ai/cordis' {
  interface Context { navigationAccess: NavigationAccess }
}

/** No private read or fabricated permission is needed to describe public navigation. */
export function createNavigationAccess(account: Pick<typeof accountSession, 'status' | 'subscribe'>): NavigationAccess {
  return { getSnapshot: account.status, subscribe: account.subscribe };
}

const copy = {
  en: ['Available after sign-in.', 'Checking sign-in status…', 'Unable to check sign-in status. Reload to try again.', 'Sign in to view workspaces and sessions.', 'Sign in'],
  zh: ['登录后可用。', '正在检查登录状态…', '无法检查登录状态，请刷新重试。', '登录后查看工作区和会话。', '登录'],
  ja: ['サインイン後に利用できます。', 'サインイン状態を確認中…', 'サインイン状態を確認できません。再読み込みしてください。', 'サインインしてワークスペースとセッションを表示します。', 'サインイン'],
  es: ['Disponible después de iniciar sesión.', 'Comprobando el inicio de sesión…', 'No se pudo comprobar el inicio de sesión. Vuelve a cargar la página.', 'Inicia sesión para ver espacios de trabajo y sesiones.', 'Iniciar sesión'],
  fr: ['Disponible après connexion.', 'Vérification de la connexion…', 'Impossible de vérifier la connexion. Rechargez la page.', 'Connectez-vous pour voir les espaces de travail et les sessions.', 'Se connecter'],
  de: ['Nach der Anmeldung verfügbar.', 'Anmeldestatus wird geprüft…', 'Der Anmeldestatus konnte nicht geprüft werden. Bitte neu laden.', 'Melde dich an, um Arbeitsbereiche und Sitzungen anzuzeigen.', 'Anmelden'],
  ru: ['Доступно после входа.', 'Проверка входа…', 'Не удалось проверить вход. Обновите страницу.', 'Войдите, чтобы увидеть рабочие пространства и сеансы.', 'Войти'],
  pt: ['Disponível após iniciar sessão.', 'A verificar o início de sessão…', 'Não foi possível verificar o início de sessão. Recarregue a página.', 'Inicie sessão para ver espaços de trabalho e sessões.', 'Iniciar sessão'],
} as const;

/** Authentication alone never grants an operation absent from real Host capabilities. */
export function navigationUnavailableReason(locale: string): string {
  const unavailable = {
    en: 'Currently unavailable.', zh: '当前不可用。', ja: '現在利用できません。', es: 'No disponible actualmente.',
    fr: 'Actuellement indisponible.', de: 'Derzeit nicht verfügbar.', ru: 'Сейчас недоступно.', pt: 'Indisponível de momento.',
  };
  const language = locale.toLowerCase().replaceAll('_', '-').split('-')[0] as keyof typeof unavailable;
  return unavailable[language] ?? unavailable.en;
}

interface NavigationLocale {
  getSnapshot(): { readonly active: string };
  subscribe(listener: () => void): () => void;
}

/** Each UI consumer keeps a stable snapshot and reacts to both account and language changes. */
export function createNavigationView(access: NavigationAccess, locale: NavigationLocale) {
  let previousKey: string | undefined;
  let previous: NavigationAvailability;
  return {
    getSnapshot(): NavigationAvailability {
      const state = access.getSnapshot();
      const language = locale.getSnapshot().active.toLowerCase().replaceAll('_', '-').split('-')[0] as keyof typeof copy;
      const key = `${state}:${language}`;
      if (key !== previousKey) {
        const words = copy[language] ?? copy.en;
        const reason = state === 'authenticated' ? '' : state === 'anonymous' ? words[0] : state === 'checking' ? words[1] : words[2];
        previous = { state, allowed: state === 'authenticated', reason, emptyLabel: state === 'anonymous' ? words[3] : reason, signInLabel: words[4] };
        previousKey = key;
      }
      return previous;
    },
    subscribe(listener: () => void): () => void {
      const releaseAccess = access.subscribe(listener);
      const releaseLocale = locale.subscribe(listener);
      return () => { releaseAccess(); releaseLocale(); };
    },
  };
}

/** Return to the same local route after the existing login document succeeds. */
export function navigationLoginHref(target: { readonly pathname: string; readonly search: string; readonly hash: string }, locale: string): string {
  const next = encodeURIComponent(`${target.pathname || '/'}${target.search}${target.hash}`);
  return `/login?next=${next}&locale=${encodeURIComponent(locale)}`;
}
