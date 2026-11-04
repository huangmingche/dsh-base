/** Compatibility seam for the unavailable Host PTY; all terminal UI stays official. */
import type { Context } from "@deepseek-ai/cordis";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import type { TerminalView, TerminalViewState } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { TerminalGuide, type TerminalGuideProps } from "@deepseek-ai/dsh-client-ui-sidebar-terminal/src/client/TerminalGuide.tsx";
import { LazyTerminalBody } from "@deepseek-ai/dsh-client-ui-sidebar-terminal/src/client/LazyTerminalBody.tsx";
import * as officialCopy from "@deepseek-ai/dsh-client-ui-sidebar-terminal/src/client/locales.ts";
import { z } from "zod";
import "./rightbar-extra.css";

export const name = "@dsh-base/client-rightbar-extra";
export const Config = z.object({}).default({});
export const inject = ["slots", "locale", "theme", "shortcuts"];
const ID = "@deepseek-ai/dsh-client-ui-sidebar-terminal";
const NS = "dshBase.terminalAvailability";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dshBase.terminalAvailability": keyof typeof officialCopy.en;
  }
}

const reasons = {
  en: "Terminal is unavailable because this deployment has no process or PTY service.",
  zh: "当前部署没有进程或 PTY 服务，无法使用终端。",
  ja: "この環境にはプロセスまたは PTY サービスがないため、ターミナルを使用できません。",
  es: "El terminal no está disponible porque esta implementación no tiene un servicio de procesos o PTY.",
  fr: "Le terminal est indisponible : ce déploiement ne dispose pas de service de processus ou PTY.",
  de: "Das Terminal ist nicht verfügbar, da diese Bereitstellung keinen Prozess- oder PTY-Dienst hat.",
  ru: "Терминал недоступен: в этом развёртывании нет службы процессов или PTY.",
  pt: "O terminal está indisponível porque esta implantação não tem um serviço de processos ou PTY.",
} as const;

/** Preserve the exported official card while disabling its unsupported commands. */
export function UnavailableTerminalGuide(props: Omit<TerminalGuideProps, "t"> & PropsLocale<typeof NS>) {
  const reason = props.t("unavailable");
  return <fieldset disabled aria-disabled="true" title={reason} className="dsh-terminal-disabled">
    <TerminalGuide {...props} t={(key, params) => props.t(key, params)} description={reason} />
  </fieldset>;
}

/** Keyboard-opened or retained tabs show the official failure surface, read-only. */
export function UnavailableTerminalBody(props: Omit<Parameters<typeof LazyTerminalBody>[0], "t"> & PropsLocale<typeof NS>) {
  return <fieldset disabled aria-disabled="true" title={props.t("unavailable")} className="dsh-terminal-disabled dsh-terminal-disabled-body">
    <LazyTerminalBody {...props} t={(key, params) => props.t(key, params)} />
  </fieldset>;
}

export function apply(ctx: Context): void {
  const copy = (locale: keyof typeof reasons) => ({ ...officialCopy[locale], unavailable: reasons[locale] });
  const dictionaries = { en: copy("en"), zh: copy("zh"), ja: copy("ja"), es: copy("es"), fr: copy("fr"), de: copy("de"), ru: copy("ru"), pt: copy("pt") };
  ctx.effect(() => ctx.locale.register(NS, dictionaries), "terminal availability: localized Host limitation");
  const t = ctx.locale.bind(NS);
  const state = createSnapshotStore<TerminalViewState>({ phase: "failed", writable: false, error: t("unavailable") });
  ctx.on("locale/change", () => state.set({ ...state.getSnapshot(), error: t("unavailable") }));
  const unavailable = (): never => { throw new Error(t("unavailable")); };
  const rejectUnavailable = async (): Promise<never> => unavailable();
  const view = {
    state,
    mount: () => () => {},
    refresh: rejectUnavailable,
    connect: unavailable,
    acknowledge: () => {},
    write: unavailable,
    resize: unavailable,
    rename: rejectUnavailable,
    // No process was allocated: releasing a view or closing its UI is safe.
    close: async () => {},
    dispose: async () => {},
  } as unknown as TerminalView;
  ctx.provide("webTerminals", {
    retainTabs: () => {}, view: () => view,
    launchShells: rejectUnavailable, selectShell: unavailable,
    close: async () => {}, recover: rejectUnavailable,
    closeFailures: createSnapshotStore([]), retryClose: unavailable,
  } as unknown as Context["webTerminals"]);
  ctx.effect(() => ctx.slots.inject("sidebar.right.tab.guide.entry", () => ctx.slots.register({
    name: "sidebar.right.tab.guide.entry", key: ID, priority: -1, locale: NS,
    inject: () => ({ hooks: { shortcuts: ctx.shortcuts.catalog }, loadShells: rejectUnavailable, selectShell: unavailable }),
  }, UnavailableTerminalGuide)), "terminal availability: official disabled guide");
  ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
    name: "sidebar.right.pane.tab", key: ID, priority: -1, locale: NS,
    inject: () => ({
      view: () => view,
      keyedHooks: { terminal: () => state },
      hooks: { theme: { getSnapshot: () => ctx.theme.getTheme(), subscribe: (listener: () => void) => ctx.on("theme/change", listener) } },
    }),
  }, UnavailableTerminalBody)), "terminal availability: official disabled body");
}
