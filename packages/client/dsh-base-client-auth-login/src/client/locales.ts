/**
 * Login-surface dictionaries for the eight official DSH locales.
 *
 * Locale ids follow the official `@deepseek-ai/dsh-client-locale` dictionaries
 * (`src/locales/{zh,en,ja,es,fr,de,pt,ru}.ts`); the official `LOCALE_IDS` export
 * only lists the baseline pair, so the full set is declared here explicitly.
 *
 * Incoming values come from `document.documentElement.lang`, which the official
 * locale runtime sets to `zh-CN` for `zh` and to the bare id otherwise; the
 * resolver therefore normalizes by primary language subtag before matching.
 *
 * All eight tables are FINAL: approved by the CEO on 2026-11-13 with no changes
 * (see docs/dsh-base-登录页8语言文案表.md). The only officially reused string is
 * the sign-in button (`signIn`); everything else is product-authored copy.
 */
const en = {
  createTitle: "Create your DeepSeek Harness Base account", signInTitle: "Sign in to DeepSeek Harness Base",
  createIntro: "Your account keeps Workspaces and Sessions private.", signInIntro: "Use your DeepSeek Harness Base account.",
  username: "Username", identifier: "Username or email", email: "Email", password: "Password",
  usernameHint: "3–30 characters: letters, numbers, underscore, dot, or hyphen.", passwordHint: "8–128 characters.",
  wait: "Please wait…", create: "Create account", signIn: "Sign in", haveAccount: "I already have an account", createSwitch: "Create an account",
  alreadyRegistered: "That username or email is already registered.", invalidCredentials: "The username/email or password is incorrect.",
  requestFailed: "The account request could not be completed.", connectionFailed: "The account request could not reach the server.",
  checkingPolicy: "Checking registration availability…", registrationClosed: "Public registration is disabled. Contact the deployment administrator for an account.",
  policyUnavailable: "Registration availability could not be checked. Sign-in remains available; reload to retry.",
};
const zh: typeof en = {
  createTitle: "创建 DeepSeek Harness Base 账户", signInTitle: "登录 DeepSeek Harness Base",
  createIntro: "你的账户用于保存私有工作区和会话。", signInIntro: "使用你的 DeepSeek Harness Base 账户登录。",
  username: "用户名", identifier: "用户名或邮箱", email: "邮箱", password: "密码",
  usernameHint: "3–30 个字符，可使用字母、数字、下划线、点或连字符。", passwordHint: "8–128 个字符。",
  wait: "请稍候…", create: "创建账户", signIn: "登录", haveAccount: "已有账户，去登录", createSwitch: "创建账户",
  alreadyRegistered: "该用户名或邮箱已注册。", invalidCredentials: "用户名、邮箱或密码不正确。",
  requestFailed: "无法完成账户请求。", connectionFailed: "账户请求无法连接服务器。",
  checkingPolicy: "正在检查注册是否可用…", registrationClosed: "此部署未开放公开注册。请联系部署管理员获取账户。",
  policyUnavailable: "暂时无法检查注册状态。仍可登录已有账户；刷新页面可重试。",
};
const ja: typeof en = {
  createTitle: "DeepSeek Harness Base アカウントを作成", signInTitle: "DeepSeek Harness Base にログイン",
  createIntro: "アカウントでワークスペースとセッションを非公開に保ちます。", signInIntro: "DeepSeek Harness Base アカウントを使用します。",
  username: "ユーザー名", identifier: "ユーザー名またはメールアドレス", email: "メールアドレス", password: "パスワード",
  usernameHint: "3～30 文字。英字、数字、アンダースコア、ピリオド、ハイフンが使用できます。", passwordHint: "8～128 文字。",
  wait: "お待ちください…", create: "アカウントを作成", signIn: "ログイン", haveAccount: "すでにアカウントを持っています", createSwitch: "アカウントを作成する",
  alreadyRegistered: "そのユーザー名またはメールアドレスはすでに登録されています。", invalidCredentials: "ユーザー名・メールアドレスまたはパスワードが正しくありません。",
  requestFailed: "アカウントのリクエストを完了できませんでした。", connectionFailed: "アカウントのリクエストがサーバーに到達できませんでした。",
  checkingPolicy: "登録の可否を確認しています…", registrationClosed: "公開登録は無効です。アカウントについてはデプロイ管理者に連絡してください。",
  policyUnavailable: "登録の可否を確認できませんでした。ログインは引き続き可能です。再読み込みして再試行してください。",
};
const es: typeof en = {
  createTitle: "Crea tu cuenta de DeepSeek Harness Base", signInTitle: "Inicia sesión en DeepSeek Harness Base",
  createIntro: "Tu cuenta mantiene privados los espacios de trabajo y las sesiones.", signInIntro: "Usa tu cuenta de DeepSeek Harness Base.",
  username: "Nombre de usuario", identifier: "Nombre de usuario o correo electrónico", email: "Correo electrónico", password: "Contraseña",
  usernameHint: "De 3 a 30 caracteres: letras, números, guion bajo, punto o guion.", passwordHint: "De 8 a 128 caracteres.",
  wait: "Espera un momento…", create: "Crear cuenta", signIn: "Iniciar sesión", haveAccount: "Ya tengo una cuenta", createSwitch: "Crear una cuenta",
  alreadyRegistered: "Ese nombre de usuario o correo ya está registrado.", invalidCredentials: "El nombre de usuario o correo y la contraseña no son correctos.",
  requestFailed: "No se pudo completar la solicitud de cuenta.", connectionFailed: "La solicitud de cuenta no pudo llegar al servidor.",
  checkingPolicy: "Comprobando la disponibilidad del registro…", registrationClosed: "El registro público está deshabilitado. Contacta al administrador del despliegue para obtener una cuenta.",
  policyUnavailable: "No se pudo comprobar la disponibilidad del registro. El inicio de sesión sigue disponible; recarga para reintentar.",
};
const fr: typeof en = {
  createTitle: "Créez votre compte DeepSeek Harness Base", signInTitle: "Se connecter à DeepSeek Harness Base",
  createIntro: "Votre compte garde vos espaces de travail et sessions privés.", signInIntro: "Utilisez votre compte DeepSeek Harness Base.",
  username: "Nom d'utilisateur", identifier: "Nom d'utilisateur ou e-mail", email: "E-mail", password: "Mot de passe",
  usernameHint: "3 à 30 caractères : lettres, chiffres, tiret bas, point ou trait d'union.", passwordHint: "8 à 128 caractères.",
  wait: "Veuillez patienter…", create: "Créer un compte", signIn: "Connectez-vous", haveAccount: "J'ai déjà un compte", createSwitch: "Créer un compte",
  alreadyRegistered: "Ce nom d'utilisateur ou e-mail est déjà enregistré.", invalidCredentials: "Le nom d'utilisateur ou l'e-mail ou le mot de passe est incorrect.",
  requestFailed: "La demande de compte n'a pas pu être terminée.", connectionFailed: "La demande de compte n'a pas pu joindre le serveur.",
  checkingPolicy: "Vérification de la disponibilité de l'inscription…", registrationClosed: "L'inscription publique est désactivée. Contactez l'administrateur du déploiement pour un compte.",
  policyUnavailable: "La disponibilité de l'inscription n'a pas pu être vérifiée. La connexion reste possible ; rechargez pour réessayer.",
};
const de: typeof en = {
  createTitle: "Erstellen Sie Ihr DeepSeek Harness Base-Konto", signInTitle: "Bei DeepSeek Harness Base anmelden",
  createIntro: "Ihr Konto hält Arbeitsbereiche und Sitzungen privat.", signInIntro: "Verwenden Sie Ihr DeepSeek Harness Base-Konto.",
  username: "Benutzername", identifier: "Benutzername oder E-Mail", email: "E-Mail", password: "Passwort",
  usernameHint: "3–30 Zeichen: Buchstaben, Zahlen, Unterstrich, Punkt oder Bindestrich.", passwordHint: "8–128 Zeichen.",
  wait: "Bitte warten…", create: "Konto erstellen", signIn: "Melden Sie sich an", haveAccount: "Ich habe bereits ein Konto", createSwitch: "Konto erstellen",
  alreadyRegistered: "Dieser Benutzername oder diese E-Mail ist bereits registriert.", invalidCredentials: "Benutzername/E-Mail oder Passwort ist falsch.",
  requestFailed: "Die Kontoanfrage konnte nicht abgeschlossen werden.", connectionFailed: "Die Kontoanfrage konnte den Server nicht erreichen.",
  checkingPolicy: "Registrierungsverfügbarkeit wird geprüft…", registrationClosed: "Die öffentliche Registrierung ist deaktiviert. Wenden Sie sich für ein Konto an den Administrator der Bereitstellung.",
  policyUnavailable: "Die Registrierungsverfügbarkeit konnte nicht geprüft werden. Die Anmeldung bleibt verfügbar; laden Sie neu, um es erneut zu versuchen.",
};
const pt: typeof en = {
  createTitle: "Crie sua conta do DeepSeek Harness Base", signInTitle: "Entrar no DeepSeek Harness Base",
  createIntro: "Sua conta mantém espaços de trabalho e sessões privados.", signInIntro: "Use sua conta do DeepSeek Harness Base.",
  username: "Nome de usuário", identifier: "Nome de usuário ou e-mail", email: "E-mail", password: "Senha",
  usernameHint: "3 a 30 caracteres: letras, números, sublinhado, ponto ou hífen.", passwordHint: "8 a 128 caracteres.",
  wait: "Aguarde…", create: "Criar conta", signIn: "Faça login", haveAccount: "Já tenho uma conta", createSwitch: "Criar uma conta",
  alreadyRegistered: "Esse nome de usuário ou e-mail já está registrado.", invalidCredentials: "O nome de usuário ou e-mail ou a senha está incorreto.",
  requestFailed: "Não foi possível concluir a solicitação da conta.", connectionFailed: "A solicitação da conta não conseguiu chegar ao servidor.",
  checkingPolicy: "Verificando a disponibilidade do registro…", registrationClosed: "O registro público está desativado. Contate o administrador da implantação para obter uma conta.",
  policyUnavailable: "Não foi possível verificar a disponibilidade do registro. O acesso continua disponível; recarregue para tentar novamente.",
};
const ru: typeof en = {
  createTitle: "Создайте учётную запись DeepSeek Harness Base", signInTitle: "Вход в DeepSeek Harness Base",
  createIntro: "Аккаунт сохраняет конфиденциальность рабочих областей и сеансов.", signInIntro: "Используйте свою учётную запись DeepSeek Harness Base.",
  username: "Имя пользователя", identifier: "Имя пользователя или эл. почта", email: "Эл. почта", password: "Пароль",
  usernameHint: "От 3 до 30 символов: буквы, цифры, подчёркивание, точка или дефис.", passwordHint: "От 8 до 128 символов.",
  wait: "Подождите…", create: "Создать учётную запись", signIn: "Войти", haveAccount: "У меня уже есть учётная запись", createSwitch: "Создать учётную запись",
  alreadyRegistered: "Это имя пользователя или эл. почта уже зарегистрированы.", invalidCredentials: "Имя пользователя или эл. почта либо пароль неверны.",
  requestFailed: "Не удалось выполнить запрос учётной записи.", connectionFailed: "Запрос учётной записи не смог связаться с сервером.",
  checkingPolicy: "Проверка доступности регистрации…", registrationClosed: "Публичная регистрация отключена. Обратитесь к администратору развёртывания для получения учётной записи.",
  policyUnavailable: "Не удалось проверить доступность регистрации. Вход остаётся доступным; перезагрузите страницу, чтобы повторить.",
};

/**
 * Officially reused vocabulary — words, never code. Source comments are
 * machine-checkable: `package@<pin short sha> / file:line / key / value`.
 * Re-diff this block on every pin upgrade; the official package may change a word.
 * Source: .submodules/deepseek-harness/packages/client/ui-settings-account/src/client/locales.ts
 * Pin: 9c2670d3bce5275e0d1610272958121af87787bb
 */
export const REUSED_SIGN_IN_SOURCES = {
  en: "ui-settings-account@9c2670d3 / locales.ts:19 / signIn / Sign in",
  zh: "ui-settings-account@9c2670d3 / locales.ts:54 / signIn / 登录",
  ja: "ui-settings-account@9c2670d3 / locales.ts:102 / signIn / ログイン",
  es: "ui-settings-account@9c2670d3 / locales.ts:147 / signIn / Iniciar sesión",
  fr: "ui-settings-account@9c2670d3 / locales.ts:181 / signIn / Connectez-vous",
  de: "ui-settings-account@9c2670d3 / locales.ts:215 / signIn / Melden Sie sich an",
  pt: "ui-settings-account@9c2670d3 / locales.ts:283 / signIn / Faça login",
  ru: "ui-settings-account@9c2670d3 / locales.ts:249 / signIn / Войти",
} as const;

/** Every locale the deployment publishes, matching the official DSH dictionaries. */
export const LOGIN_LOCALE_IDS = ["zh", "en", "ja", "es", "fr", "de", "pt", "ru"] as const;
export type LoginLocale = typeof LOGIN_LOCALE_IDS[number];
export type LoginCopy = typeof en;

/** Locales whose complete approved copy table has landed. */
const TRANSLATED: ReadonlySet<LoginLocale> = new Set<LoginLocale>(["zh", "en", "ja", "es", "fr", "de", "pt", "ru"]);

const COPY: Record<LoginLocale, LoginCopy> = { zh, en, ja, es, fr, de, pt, ru };

/** Locales still waiting for the approved, reviewed translation table. */
export const PENDING_LOGIN_LOCALES: readonly LoginLocale[] = LOGIN_LOCALE_IDS.filter(id => !TRANSLATED.has(id));

/**
 * Normalize a BCP 47-style tag to one of the eight login locales.
 * `zh-CN`/`zh-Hans` resolve to `zh`, `ja-JP` to `ja`, and anything unknown to English.
 */
export function resolveLoginLocale(locale: string | null | undefined): LoginLocale {
  if (typeof locale !== "string") return "en";
  const primary = locale.trim().toLowerCase().split("-")[0] ?? "";
  return (LOGIN_LOCALE_IDS as readonly string[]).includes(primary) ? primary as LoginLocale : "en";
}

/** Copy for the requested locale; unknown locales fall back to English. */
export function loginCopy(locale: string | null | undefined): LoginCopy {
  return COPY[resolveLoginLocale(locale)];
}
