import { Context } from '@deepseek-ai/cordis';
import { StrictMode, useSyncExternalStore, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import '@deepseek-ai/dsh-client-web/src/base.css';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { installThemeStyles } from '@deepseek-ai/dsh-client-ui-theme/src/client/styles.ts';
import { ThemePresenter } from '@deepseek-ai/dsh-client-ui-layout/src/client/theme-presenter.ts';
import { DEFAULT_FONT_SIZES, DEFAULT_PREFERENCE } from '@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts';
import { apply as applyLogin } from '../../../dsh-base-client-auth-login/src/client/index.tsx';
import { createPublicPluginConfigurations } from '../../../dsh-base-client-public-navigation/src/client/public-configurations.ts';
import { apply as applyPayment } from '../../src/client/index.ts';
import { type PaymentFace, type PaymentProps } from '../../src/client/PaymentPanel.tsx';
import { locales } from '../../src/client/locales.ts';

const locale = location.pathname === '/zh-CN' ? 'zh' : 'en';
document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
const ctx = new Context();
applyLogin(ctx);
installThemeStyles(ctx);
const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
new ThemePresenter().apply({
  preference: DEFAULT_PREFERENCE, fontSizes: DEFAULT_FONT_SIZES, fontFamilies: { text: '', code: '', terminal: '' },
  active: { id: theme, colorScheme: theme, tokens: {} }, themes: [], revision: 0,
});

function renderPaymentPanel(Panel: ComponentType<PaymentProps>, { hooks, ...actions }: PaymentFace) {
  const usePayment: PaymentProps['usePayment'] = select =>
    select(useSyncExternalStore(hooks.payment.subscribe, hooks.payment.getSnapshot));
  const t = (key: keyof typeof locales.en) => locales[locale][key];
  const props = { ...actions, view: 'page', t, usePayment } as PaymentProps;
  createRoot(document.querySelector('#root')!).render(<StrictMode>
    <main><Panel {...props} /></main>
    <aside id="reference"><Button size="sm" variant="primary">{t('signIn')}</Button></aside>
  </StrictMode>);
}

// The fixture supplies the workbench slot. The product plugin owns its store,
// consent snapshot, login handoff, and the payment callbacks exercised here.
applyPayment({
  effect: (setup: () => unknown) => setup(),
  locale: { register: () => () => {}, getSnapshot: () => ({ active: locale }) },
  publicPluginConfigurations: createPublicPluginConfigurations(),
  slots: {
    inject: (_slot: string, setup: () => unknown) => setup(),
    register: (options: { key: string; inject(): PaymentFace }, Panel: ComponentType<PaymentProps>) => {
      if (options.key !== 'dsh-base:waffo') throw new Error('Unexpected payment slot');
      renderPaymentPanel(Panel, options.inject());
      return () => {};
    },
  },
} as unknown as Context);
