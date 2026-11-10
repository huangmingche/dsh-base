/** Real pinned export-plugin registrations and browser controllers; no private Host data. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { apply as exportApply } from '@deepseek-ai/dsh-session-log-export/client';
import { SessionLogDownloadHeaderAction } from '@deepseek-ai/dsh-session-log-export/src/client/HeaderAction.tsx';
import { SessionMarkdownCopyToast } from '@deepseek-ai/dsh-session-log-export/src/client/CopyToast.tsx';
import { OpenInAppAction } from '@deepseek-ai/dsh-client-ui-open-in-app/src/client/OpenInAppAction.tsx';
import { OpenTargetButton } from '@deepseek-ai/dsh-client-ui-open-in-app/src/client/OpenTargetButton.tsx';
import * as openCopy from '@deepseek-ai/dsh-client-ui-open-in-app/src/client/locales.ts';
import { AvailabilityOpenInAppAction } from '../../../../packages/client/dsh-base-client-open-in-app-availability/src/client/index.tsx';
import { openInAppUnavailableReason } from '../../../../packages/client/dsh-base-client-open-in-app-availability/src/availability.ts';

const sessionId = 'session-menu-中文';
function observe(store: any) {
  return (select: (value: any) => unknown) => select(useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot));
}

export function SessionMenuFixture({ locale, adapted }: { locale: 'en' | 'zh'; adapted: boolean }) {
  const [nativeState, setNativeState] = useState('unavailable');
  const setup = useMemo(() => {
    const entries: any[] = [], disposers: Array<() => unknown> = [], dictionaries = new Map<string, any>();
    const copies: string[] = [], downloads: Array<{ url: string; filename: string }> = [], feedback: string[] = [], launches: unknown[] = [];
    const listeners = new Map<string, (...args: any[]) => void>();
    let failClipboard = false;
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const originalClick = HTMLAnchorElement.prototype.click;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async write(items: ClipboardItem[]) {
        // The real controller must preserve activation by starting the deferred
        // clipboard write before the HTTP promise settles.
        for (const item of items) {
          const blob = await item.getType('text/plain');
          if (failClipboard) throw new DOMException('Fixture clipboard denied', 'NotAllowedError');
          copies.push(await blob.text());
        }
      },
      async writeText(value: string) {
        if (failClipboard) throw new DOMException('Fixture clipboard denied', 'NotAllowedError');
        copies.push(value);
      },
    } });
    HTMLAnchorElement.prototype.click = function () { downloads.push({ url: this.href, filename: this.download }); };
    const feedbackUi = { openSession: (id: string) => { feedback.push(id); } };
    const services = new Map<string, unknown>([['feedbackUi', feedbackUi]]);
    const context: any = {
      effect(effect: () => any) { const dispose = effect(); if (typeof dispose === 'function') disposers.push(dispose); return dispose; },
      provide(name: string, value: unknown) { services.set(name, value); },
      get(name: string) { return services.get(name); },
      inject(_names: string[], callback: (scope: unknown) => unknown) { return callback(context); },
      on(name: string, callback: (...args: any[]) => void) { listeners.set(name, callback); return () => listeners.delete(name); },
      locale: { register(namespace: string, values: unknown) { dictionaries.set(namespace, values); return () => dictionaries.delete(namespace); } },
      slots: {
        inject(_name: string, callback: () => unknown) { return callback(); },
        register(options: any, component: any) {
          const entry = { options, component }; entries.push(entry);
          return () => { const at = entries.indexOf(entry); if (at !== -1) entries.splice(at, 1); };
        },
      },
    };
    exportApply(context);
    const header = entries.find(entry => entry.options.name === 'conversation.session.header.utilities' && entry.options.id === 'session-log-download');
    const toast = entries.find(entry => entry.options.name === 'shell.overlay' && entry.options.id === 'session-log-download.copy-toast');
    if (header?.component !== SessionLogDownloadHeaderAction || toast?.component !== SessionMarkdownCopyToast) throw new Error('Official export plugin did not register its original header and toast');
    const injected = header.options.inject(), toastInjected = toast.options.inject();
    const copy = dictionaries.get(header.options.locale)[locale];
    const t = (key: string) => copy[key] ?? key;
    const api = {
      copies, downloads, feedback, launches, copy, sessionId, setNativeState,
      headerId: header.options.id, originalHeader: header.component === SessionLogDownloadHeaderAction,
      clear: () => { copies.length = 0; downloads.length = 0; feedback.length = 0; toastInjected.dismiss(); },
      failClipboard: (value: boolean) => { failClipboard = value; },
      copyState: () => injected.hooks.sessionMarkdownCopy.getSnapshot(),
      downloadState: () => injected.hooks.sessionLogDownload.getSnapshot(),
      dismiss: () => { injected.dismiss(sessionId); toastInjected.dismiss(); },
      command: (kind = 'success') => listeners.get('command/executed')?.(sessionId, 'export', { kind }),
    };
    (window as any).__SESSION_MENU__ = api;
    return { header, toast, injected, toastInjected, t, dispose: () => {
      for (const dispose of disposers.reverse()) void dispose();
      HTMLAnchorElement.prototype.click = originalClick;
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete (navigator as any).clipboard;
    } };
  }, [locale]);
  useEffect(() => setup.dispose, [setup]);
  const Header = adapted ? setup.header.component : SessionLogDownloadHeaderAction;
  const Toast = adapted ? setup.toast.component : SessionMarkdownCopyToast;
  const props = { ...setup.injected, sessionId, t: setup.t,
    useSessionLogDownload: observe(setup.injected.hooks.sessionLogDownload),
    useSessionMarkdownCopy: observe(setup.injected.hooks.sessionMarkdownCopy),
    useFeedbackAvailable: observe(setup.injected.hooks.feedbackAvailable),
  };
  const openT = (key: string, values: Record<string, unknown> = {}) => String((openCopy[locale] as any)[key] ?? key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? ''));
  const reason = openInAppUnavailableReason(locale);
  const nativeProps: any = {
    sessionId, useSessions: (select: any) => select({ byId: { [sessionId]: { cwd: nativeState === 'missing-directory' ? undefined : '/workspace' } } }),
    useOpenInAppApps: (select: any) => select(nativeState === 'available' ? ['vscode'] : []),
    useOpenInAppChoice: (select: any) => select('vscode'), useOpenInAppLaunch: (select: any) => select({ phase: 'idle' }),
    useShortcuts: (select: any) => select([]), t: openT, unavailableReason: () => reason,
    iconUrl: () => 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="14" height="14"/%3E',
    launch: async (id: string, path: string) => { (window as any).__SESSION_MENU__.launches.push({ id, path }); return { kind: 'opened' }; },
    choose: () => {}, report: () => {},
  };
  // The deployment's unavailable state is an explicit capability adaptation.
  // Its reference preserves the exported official button; it does not pretend
  // upstream rc.1 renders a fallback where its native catalog is empty.
  const nativeReference = nativeState === 'available' ? <OpenInAppAction {...nativeProps} absolutePath="/workspace" />
    : <fieldset disabled aria-disabled="true" title={reason} data-open-in-app-unavailable=""
      style={{ display: 'inline-flex', border: 0, margin: 0, padding: 0, minWidth: 0, opacity: 0.4 }}>
      <OpenTargetButton kind="directory" applications={[]} defaultId={undefined} failed={false}
        t={((key: string, values: any) => key === 'path.reveal' ? `${openT('open.tooltip')} · ${reason}` : openT(key, values)) as any}
        execute={async () => ({ kind: 'skipped' })} report={() => {}} />
    </fieldset>;
  return <>
    <header data-session-menu-fixture style={{ padding: '16px 24px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderBottom: '1px solid var(--dsw-alias-border-main)' }}>
      <span data-native-open-fixture>{adapted ? <AvailabilityOpenInAppAction {...nativeProps} /> : nativeReference}</span>
      <Header {...props as any} />
    </header>
    <Toast {...setup.toastInjected} t={setup.t as any} useSessionMarkdownCopy={props.useSessionMarkdownCopy as any} />
  </>;
}
