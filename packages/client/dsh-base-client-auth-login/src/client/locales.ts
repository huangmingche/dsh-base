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
export function loginCopy(locale: string | null | undefined): typeof en { return locale?.toLowerCase().startsWith("zh") ? zh : en; }
