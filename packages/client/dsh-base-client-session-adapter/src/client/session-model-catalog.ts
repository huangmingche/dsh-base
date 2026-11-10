/** Host data seam for the effective provider selection of one Session. */
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client';
import { buildFallbackModelCatalog, type FallbackModelAccess } from './model-catalog-fallback.ts';

const REASONS: Record<string, { gateway: string; deepseek: string }> = {
  en: { gateway: 'Cloudflare AI Gateway is disabled for this deployment, account or Session.', deepseek: 'The owner DeepSeek API key is not configured or could not be read.' },
  zh: { gateway: 'Cloudflare AI Gateway 已在当前部署、账号或会话中禁用。', deepseek: '账号的 DeepSeek API 密钥未配置或无法读取。' },
  ja: { gateway: 'Cloudflare AI Gateway はこのデプロイ、アカウント、またはセッションで無効です。', deepseek: 'アカウントの DeepSeek API キーが未設定か、読み取れません。' },
  es: { gateway: 'Cloudflare AI Gateway está desactivado para este despliegue, cuenta o sesión.', deepseek: 'La clave API de DeepSeek de la cuenta no está configurada o no se pudo leer.' },
  fr: { gateway: 'Cloudflare AI Gateway est désactivé pour ce déploiement, ce compte ou cette session.', deepseek: 'La clé API DeepSeek du compte est absente ou illisible.' },
  de: { gateway: 'Cloudflare AI Gateway ist für diese Bereitstellung, dieses Konto oder diese Sitzung deaktiviert.', deepseek: 'Der DeepSeek-API-Schlüssel des Kontos fehlt oder konnte nicht gelesen werden.' },
  ru: { gateway: 'Cloudflare AI Gateway отключён для этого развёртывания, аккаунта или сеанса.', deepseek: 'Ключ API DeepSeek аккаунта не настроен или недоступен для чтения.' },
  pt: { gateway: 'O Cloudflare AI Gateway está desativado para esta implantação, conta ou sessão.', deepseek: 'A chave de API DeepSeek da conta não está configurada ou não pôde ser lida.' },
};

export interface SessionModelCatalog {
  load(sessionId: string): Promise<ModelCatalog>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionModelCatalog: SessionModelCatalog;
  }
}

/** Keep Session overrides out of the official, account-scoped zero-argument RPC. */
export function createSessionModelCatalog(options: {
  readonly account: () => Promise<unknown | null>;
  readonly access: (sessionId: string) => Promise<FallbackModelAccess>;
  readonly locale?: () => string;
}): SessionModelCatalog {
  return {
    async load(sessionId) {
      if (sessionId.length === 0) throw new Error('session/model-catalog: Session identity is required');
      if (await options.account() == null) throw new Error('auth/required: Sign in to read the Session model catalog');
      // A failed selection read must remain an error, never an owner-catalog
      // fallback that could re-enable a Session-disabled provider.
      const access = await options.access(sessionId);
      const language = options.locale?.().split(/[-_]/u)[0];
      return buildFallbackModelCatalog(access, REASONS[language ?? 'en'] ?? REASONS.en);
    },
  };
}
