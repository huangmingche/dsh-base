/** Real pinned export-plugin registrations and browser controllers; no private Host data. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { apply as menuApply } from '@deepseek-ai/dsh-client-ui-context-menu/client';
import { ContextMenuButton } from '@deepseek-ai/dsh-client-ui-context-menu/src/client/Button.tsx';
import { MenuOverlay } from '@deepseek-ai/dsh-client-ui-context-menu/src/client/View.tsx';
import * as conversationCopy from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts';
import css from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css';
import { apply as exportApply } from '@deepseek-ai/dsh-session-log-export/client';
import { SessionMarkdownCopyToast } from '@deepseek-ai/dsh-session-log-export/src/client/CopyToast.tsx';
import { SessionLogDownloadDialog } from '@deepseek-ai/dsh-session-log-export/src/client/Dialog.tsx';
import { registerSessionOpenWith } from '@deepseek-ai/dsh-client-ui-open-in-app/src/client/session-open-with.ts';
import { OpenInAppAction } from '@deepseek-ai/dsh-client-ui-open-in-app/src/client/OpenInAppAction.tsx';
import { ContextMenuApplicationIcon } from '@deepseek-ai/dsh-client-ui-open-in-app/src/client/context-menus.tsx';
import { OpenInAppController } from '@deepseek-ai/dsh-client-ui-open-in-app/src/client/controller.ts';
import { FilesBody } from '@deepseek-ai/dsh-client-ui-sidebar-files/src/client/FilesBody.tsx';
import * as filesCopy from '@deepseek-ai/dsh-client-ui-sidebar-files/src/client/locales.ts';
import * as openCopy from '@deepseek-ai/dsh-client-ui-open-in-app/src/client/locales.ts';
import { installOpenInAppAvailability } from '../../../../packages/client/dsh-base-client-open-in-app-availability/src/client/index.tsx';

const sessionId = 'session-menu-中文';
function observe(store: any) {
  return (select: (value: any) => unknown) => select(useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot));
}

export function SessionMenuFixture({ locale, adapted }: { locale: 'en' | 'zh'; adapted: boolean }) {
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
    const sessions = createSnapshotStore({ byId: { [sessionId]: { cwd: '/workspace' as string | undefined } } });
    const controller = new OpenInAppController(async (_input, init) => {
      launches.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    });
    controller.apps.set([]);
    const localeState = createSnapshotStore({ active: locale });
    const bind = (namespace: string) => (key: string, values: Record<string, string> = {}) =>
      (dictionaries.get(namespace)[locale][key] ?? key).replace(/\{([^}]+)\}/g, (_: string, name: string) => values[name] ?? '');
    const register = (options: any, component: any) => {
      const entry = { options, component };
      entries.push(entry);
      return () => { const at = entries.indexOf(entry); if (at !== -1) entries.splice(at, 1); };
    };
    const context: any = {
      effect(effect: () => any) { const dispose = effect(); if (typeof dispose === 'function') disposers.push(dispose); return dispose; },
      provide(name: string, value: unknown) { services.set(name, value); context[name] = value; },
      get(name: string) { return services.get(name); },
      inject(_names: string[], callback: (scope: unknown) => unknown) { return callback(context); },
      on(name: string, callback: (...args: any[]) => void) { listeners.set(name, callback); return () => listeners.delete(name); },
      locale: { ...localeState, bind, register(namespace: string, values: unknown) { dictionaries.set(namespace, values); return () => dictionaries.delete(namespace); } },
      shortcuts: { catalog: createSnapshotStore([]) }, sessions: { list: sessions },
      slots: { register, registerFactory: register,
        entries: (slot: string) => entries.filter(entry => entry.options.name === slot).map(entry => ({ ...entry, inject: entry.options.inject })),
        subscribe: () => () => {}, provideRoot() {}, inject(_name: string, callback: () => any) {
        const result = callback();
        if (result?.[Symbol.iterator]) for (const dispose of result) disposers.push(dispose);
        return result;
      } },
    };
    menuApply(context);
    exportApply(context);
    dictionaries.set('open-in-app', openCopy);
    register({ name: 'contextMenu.icon', key: 'open-in-app.application' }, ContextMenuApplicationIcon);
    registerSessionOpenWith(context, controller, bind('open-in-app'), () => {});
    register({ name: 'sidebar.right.tab.files.actions', id: 'open-in-app', locale: 'open-in-app', inject: () => ({
      hooks: { openInAppApps: controller.apps, openInAppChoice: controller.choice, openInAppLaunch: controller.operation, shortcuts: context.shortcuts.catalog },
      choose: (id: string) => controller.choose(id), launch: (id: string, path: string) => controller.launch(id, path),
      iconUrl: () => 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', report: () => {},
    }) }, OpenInAppAction);
    if (adapted) disposers.push(installOpenInAppAvailability(context));
    const header = entries.find(entry => entry.options.name === 'contextMenu.button');
    const overlay = (id: string) => entries.find(entry => entry.options.name === 'shell.overlay' && entry.options.id === id);
    const menu = overlay('context-menu'), dialog = overlay('session-log-download'), toast = overlay('session-log-download.copy-toast');
    if (header?.component !== ContextMenuButton || menu?.component !== MenuOverlay
      || toast?.component !== SessionMarkdownCopyToast || dialog?.component !== SessionLogDownloadDialog) {
      throw new Error('Missing official Session menu or export overlay registration');
    }
    const toastInjected = toast.options.inject(), dialogInjected = dialog.options.inject();
    const setNativeState = (state: string) => {
      sessions.set({ byId: { [sessionId]: { cwd: state === 'missing-directory' ? undefined : '/workspace' } } });
      controller.apps.set(state === 'loading' ? null : state === 'unavailable' ? [] : ['vscode']);
    };
    (window as any).__SESSION_MENU__ = {
      copies, downloads, feedback, launches, sessionId, setNativeState, originalHeader: true,
      copy: { ...dictionaries.get('session-log-download')[locale], 'header.more': conversationCopy[locale]['header.more'], openIn: openCopy[locale]['menu.openIn'] },
      clear: () => { copies.length = 0; downloads.length = 0; feedback.length = 0; toastInjected.dismiss(); },
      failClipboard: (value: boolean) => { failClipboard = value; },
      copyState: () => toastInjected.hooks.sessionMarkdownCopy.getSnapshot(),
      downloadState: () => dialogInjected.hooks.sessionLogDownload.getSnapshot(),
      command: (kind = 'success') => listeners.get('command/executed')?.(sessionId, 'export', { kind }),
    };
    const renderSlot = (name: string, props: any, options: any) => {
      const Icon = entries.find(entry => entry.options.name === name && entry.options.key === options.entryKey)?.component;
      return Icon ? <Icon {...props} /> : null;
    };
    const filesProps = {
      sessionId, useSessions: observe(sessions), useStore: (select: any) => select({ byPane: {} }),
      useTabInfo: () => ({ panel: { id: 'files' }, tab: { id: 'files', actions: { bindCommands: () => () => {} } } }),
      useContextMenu: () => ({ getTriggerProps: () => ({}) }), placeBeside: () => {}, renderFactorySlot: () => null,
      t: (key: string) => filesCopy[locale][key as keyof typeof filesCopy.en],
      renderSlot: (name: string, owner: object) => entries.filter(e => e.options.name === name).map(({ component: Action, options }) => {
        const { hooks, ...methods } = options.inject();
        const bindings = Object.fromEntries(Object.entries(hooks).map(([key, store]) => [
          'use' + key[0].toUpperCase() + key.slice(1), observe(store),
        ]));
        return <Action key={options.id} {...owner} {...methods} {...bindings} t={bind(options.locale)} />;
      }),
    };
    return { header, menu, dialog, toast, filesProps, headerFace: header.options.inject(), menuFace: menu.options.inject(),
      menuStore: menu.options.store.create(), toastInjected, dialogInjected, bind, renderSlot, dispose: () => {
        for (const dispose of disposers.reverse()) void dispose();
        HTMLAnchorElement.prototype.click = originalClick;
        if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
        else delete (navigator as any).clipboard;
      } };
  }, [locale, adapted]);
  useEffect(() => setup.dispose, [setup]);
  if (new URLSearchParams(location.search).has('files')) return <FilesBody {...setup.filesProps as any} />;
  const Header = adapted ? setup.header.component : ContextMenuButton;
  const Menu = adapted ? setup.menu.component : MenuOverlay;
  const Toast = adapted ? setup.toast.component : SessionMarkdownCopyToast;
  const Dialog = adapted ? setup.dialog.component : SessionLogDownloadDialog;
  return <>
    <header data-session-menu-fixture style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end' }}>
      <Header target={{ kind: 'sessionHeader', value: { sessionId } }} label={conversationCopy[locale]['header.more']}
        size="sm" className={css.headerMenuButton} toggle={setup.headerFace.toggle}
        useRegisteredKinds={observe(setup.headerFace.hooks.registeredKinds)} useOpener={observe(setup.headerFace.hooks.opener)} />
    </header>
    <Menu {...setup.menuFace} useStore={observe(setup.menuStore)} actions={setup.menuStore.actions}
      useCatalog={observe(setup.menuFace.hooks.catalog)} renderSlot={setup.renderSlot} t={setup.bind('contextMenu')} />
    <Toast {...setup.toastInjected} t={setup.bind('session-log-download')} useSessionMarkdownCopy={observe(setup.toastInjected.hooks.sessionMarkdownCopy)} />
    <Dialog {...setup.dialogInjected} t={setup.bind('session-log-download')} useSessionLogDownload={observe(setup.dialogInjected.hooks.sessionLogDownload)} />
  </>;
}
