import { ComposerRuntimeFixture } from './composer-runtime-fixture.tsx';
import { ChatStepFixture } from './chat-step-fixture.tsx';
import { SidebarLifecycleFixture } from "./sidebar-lifecycle-fixture.tsx";
import { SettingsNavigationFixture } from "./settings-navigation-fixture.tsx";
import { UploadFixture } from "./upload-fixture.tsx";
import { ModelEffortFixture } from "./model-effort-fixture.tsx";
import { AccountFixture } from "./account-fixture.tsx";
import { CommandsFixture } from "./commands-fixture.tsx";
/** Render untouched pinned references and actual seam-registered components. */
import React, { useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import * as commonCopy from "@deepseek-ai/dsh-client-locale/src/locales/index.ts";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { ModelSelect } from "../../../../packages/client/dsh-base-client-model-selection/src/client/ModelSelect.tsx";
import * as modelCopy from "../../../../packages/client/dsh-base-client-model-selection/src/client/locales.ts";
import { apply as feedbackApply } from "@deepseek-ai/dsh-client-ui-message-feedback/client";
import { checkModelDirectoryAvailability } from "./model-directory-regression.ts";
import { HostCapabilitiesFixture } from "./host-capabilities-fixture.tsx";
import { ProviderEditorFixture } from "./provider-editor-fixture.tsx";
import { PluginManagerFixture } from "./plugin-manager-fixture.tsx";
import { MessageFeedbackActions } from "@deepseek-ai/dsh-client-ui-message-feedback/src/client/MessageFeedbackActions.tsx";
import { FeedbackDialog } from "@deepseek-ai/dsh-client-ui-message-feedback/src/client/FeedbackDialog.tsx";
import { apply as feedbackAvailabilityApply } from "../../../../packages/client/dsh-base-client-feedback-availability/src/client/index.tsx";
import { feedbackUnavailableReason } from "../../../../packages/client/dsh-base-client-feedback-availability/src/availability.ts";
import { apply as scheduleApply } from "@deepseek-ai/dsh-client-ui-schedule/client";
import { TaskManagerPage } from "@deepseek-ai/dsh-client-ui-schedule/src/client/TaskManagerPage.tsx";
import { PermissionSelect } from "@deepseek-ai/dsh-client-ui-permission-presets/src/client/PermissionSelect.tsx";
import { TerminalGuide } from "@deepseek-ai/dsh-client-ui-sidebar-terminal/src/client/TerminalGuide.tsx";
import { UploadRow } from "@deepseek-ai/dsh-client-ui-settings-session-log/src/client/UploadRow.tsx";
import { apply as terminalApply } from "../../../../packages/client/dsh-base-client-rightbar-extra/src/client/index.tsx";
import { apply as logApply } from "../../../../packages/client/dsh-base-client-settings/src/client/index.tsx";
import { PermissionRow } from "@deepseek-ai/dsh-client-ui-permission-presets/src/client/PermissionRow.tsx";
import { installThemeStyles } from "@deepseek-ai/dsh-client-ui-theme/src/client/styles.ts";
import { installIconSprite } from "@deepseek-ai/dsh-client-ui-theme/src/client/icon-sprite.ts";
import "@deepseek-ai/dsh-client-ui-theme/src/styles/brand-font.css";
import "@deepseek-ai/dsh-client-web/src/base.css";
import { mountAccess } from "@deepseek-ai/dsh-api-remote-access/src/client/mount.ts";
import { createScheduleRemote } from "../../../../packages/client/dsh-base-client-session-adapter/src/client/schedule-remote.ts";
import { createRemoteInvalidations } from "../../../../packages/client/dsh-base-client-session-adapter/src/client/remote-events.ts";
import { apply as permissionApply } from "@deepseek-ai/dsh-client-ui-permission-presets/client";
import { createPermissionCommands } from "../../../../packages/client/dsh-base-client-session-adapter/src/client/permission-command.ts";

const query = new URLSearchParams(location.search);
const locale = query.get("locale") === "zh" ? "zh" : "en";
const state = query.get("state") ?? "empty";
const surface = query.get("surface") ?? "schedule";
const adapted = query.get("side") === "adapted";
document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
const style = document.createElement("style");
style.textContent = "html,body,#root{width:100%;height:100%;margin:0}body{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}*{animation:none!important;transition:none!important;caret-color:transparent!important}.permission-fixture{padding:32px;max-width:720px}.permission-fixture>div+div{margin-top:32px}";
document.head.append(style);
const ctx = new Context();
installThemeStyles(ctx);
installIconSprite(ctx);
// Surface fixture only: run the unchanged official service over its documented
// injected owner baseline. The authenticated carrier/$mount lifecycle is tested
// separately by session-adapter/tests/remote-access.test.mjs and the real shell.
ctx.provide('remote', { $mount: async () => async () => {} } as never);
ctx.provide('slots', { provideRoot: () => () => {} } as never);
await mountAccess(ctx, { package: '@deepseek-ai/dsh-api-remote-access', descriptors: [] }, { type: 'baseline', owner: true });
const registrations: Array<{ spec: any; component: React.ComponentType<any>; options: any; inject: any }> = [];
const slotListeners = new Map<string, Set<() => void>>();
const dictionaries = new Map<string, any>();
const translate = (namespace: string) => (key: string, values: Record<string, unknown> = {}) => {
  const dictionary = { ...commonCopy[locale], ...dictionaries.get(namespace)?.[locale] };
  return String(dictionary[key] ?? key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? ""));
};
const emptySessions = { ids: [], byId: {}, phase: "ready", projectionsBySession: {} };
const workspaces = { items: [{ id: "workspace", title: "Workspace", path: "/workspace", sessionIds: [] }], archivedSessionIds: [], pinnedSessionIds: [] };
const snapshot = (value: any) => ({ getSnapshot: () => value, subscribe: () => () => {} });
const calls: Array<{ endpoint: string; args: any }> = [];
let records: any[] = state === "list" ? [{
  id: "task-1", title: locale === "zh" ? "每日阅读摘要" : "Daily reading digest", prompt: "Summarize the reading list with source links.",
  kind: "daily", time: "09:00:00.000", timeZone: "Asia/Shanghai", status: "active",
  scheduledAt: "2026-11-11T01:00:00.000Z", createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z",
  target: { kind: "new", create: { cwd: "/workspace" } }, involvedSessionIds: [],
}] : [];
const invalidations = createRemoteInvalidations();
const permissionOptions = [{ value: "workspace-write", name: "workspace-write" }, { value: "read-only", name: "read-only" }, { value: "danger-full-access", name: "danger-full-access" }];
const permissionCatalog = { options: permissionOptions, defaultOptions: permissionOptions, defaultPreset: "workspace-write" };
const permissionProjection = createSnapshotStore({ currentValue: "workspace-write" });
const permissionDescription = createSnapshotStore<any>({ error: null, view: { writable: true, namespaces: [{ ns: "permission", revision: 1, value: { defaultPreset: "workspace-write" } }] } });
const permissionDescribe = { ...permissionDescription, ensure: async () => {}, acceptView: (value: any) => permissionDescription.set({ error: null, view: { writable: true, namespaces: [value] } }) };
const permissionConnection = { generation: createSnapshotStore({ id: 1 }) };

let failCreate = false;
const rpc = { call: async (_channel: string, endpoint: string, payload: any) => {
  calls.push({ endpoint, args: payload.args });
  if (endpoint === "commands/list") return { ok: true, value: [{ name: "permission", description: "Change permissions" }] };
  if (endpoint === "commands/execute") {
    permissionProjection.set({ currentValue: payload.args.line.split(" ")[1] });
    return { ok: true, value: { commandId: "fixture-command", result: { kind: "success" } } };
  }
  if (endpoint === "schedule/catalog") {
    if (state === "loading") return await new Promise(() => {});
    if (state === "error") return { ok: false, error: { code: "schedule/rejected", message: "fixture failure", details: {} } };
    return { ok: true, value: [...records] };
  }
  if (endpoint === "schedule/deliveryLimits") return { ok: true, value: { newSessionIntervalSeconds: 60 } };
  if (endpoint === "schedule/create") {
    if (failCreate) return { ok: false, error: { code: "schedule/input-invalid", message: "fixture refusal", details: { code: "invalid_rule" } } };
    const request = payload.args.request;
    const task = { ...request, id: "created-task", kind: "daily", time: "09:00:00.000", timeZone: "Asia/Shanghai", status: "active", scheduledAt: "2026-11-11T01:00:00.000Z", createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", involvedSessionIds: [] };
    records = [...records, task];
    return { ok: true, value: task };
  }
  if (endpoint === "schedule/history") return { ok: true, value: { items: [], hasMore: false } };
  if (endpoint === "schedule/deleteInactive") return { ok: true, value: { deleted: 0 } };
  if (endpoint === "schedule/edit") { records = records.filter(task => task.id !== payload.args.request.id); return { ok: true, value: { deleted: true, id: payload.args.request.id } }; }
  throw new Error(`unexpected fixture endpoint ${endpoint}`);
} };
const permissionCommands = createPermissionCommands(() => rpc as never, () => "Feedback unavailable");
const schedule = createScheduleRemote({ rpc: () => rpc as never, changed: () => invalidations.emit("schedule/changed") });
const refuseFeedback = async () => ({ ok: false, error: { code: "feedback/unavailable", message: feedbackUnavailableReason(locale) } });
const feedbackRemote = { list: refuseFeedback, put: refuseFeedback, delete: refuseFeedback };
const fake = {
  effect: ctx.effect.bind(ctx),
  get: (name: string) => name === "connection" ? permissionConnection : name === "commandUi" ? { decorate: () => () => {}, dismiss: () => {} } : ctx.get(name as never),
  configForms: { describe: () => permissionDescribe },
  on: () => () => {},
  inject: () => () => {},
  provide: (name: string, value: unknown) => { (fake as any)[name] = value; },
  theme: { getTheme: () => ({ id: "light", colorScheme: "light" }) },
  shortcuts: { catalog: snapshot([]) },
  remoteAccess: ctx.get("remoteAccess"),
  locale: { getSnapshot: () => ({ active: locale }), register(namespace: string, dict: any) { dictionaries.set(namespace, dict); return () => dictionaries.delete(namespace); }, bind: translate },
  slots: {
    inject(_name: string, callback: () => any) { return ctx.effect(callback); },
    entries(name: string) { return registrations.filter(entry => entry.spec.name === name); },
    subscribe(name: string, listener: () => void) { const listeners = slotListeners.get(name) ?? new Set(); listeners.add(listener); slotListeners.set(name, listeners); return () => listeners.delete(listener); },
    register(spec: any, component: any) {
      const entry = { spec, component, options: spec, inject: spec.inject }; registrations.push(entry);
      const changed = () => queueMicrotask(() => slotListeners.get(spec.name)?.forEach(listener => listener())); changed();
      return () => { const at = registrations.indexOf(entry); if (at !== -1) registrations.splice(at, 1); changed(); };
    },
  },
  remote: { schedule, permissionPresets: { catalog: async () => ({ ok: true, value: permissionCatalog }) }, settings: { mutate: async (_ns: string, ops: any[], revision: number) => ({ ok: true, value: { ns: "permission", revision: revision + 1, value: { defaultPreset: ops[0].value } } }) }, $on: invalidations.on, messageFeedback: feedbackRemote, sessionFeedback: {
    record: async () => { calls.push({ endpoint: "sessionFeedback/record", args: {} }); return { ok: false, error: { code: "unavailable", message: feedbackUnavailableReason(locale) } }; },
  } },
  uiConversation: { events: { register: () => {} } },
  uiWorkspace: { startSession: (_: unknown, input: unknown) => calls.push({ endpoint: "startSession", args: input }), openSession: () => {} },
  sessions: { list: snapshot(emptySessions), binding: () => ({ session: { command: async (line: string) => { const result = await permissionCommands.execute("permission-session", line); return result.ok ? { ok: true, value: { matched: result.value !== undefined } } : result; }, projections: { faceOf: () => permissionProjection } } }) },
  workspaces: { list: snapshot(workspaces) },
  sidebarRightTabs: { register: () => () => {} },
  sidebarRight: { tabsIn: () => [], openTab: () => {} },
};
scheduleApply(fake as never);
permissionApply(fake as never);
terminalApply(fake as never);
logApply(fake as never);
feedbackApply(fake as never);
feedbackAvailabilityApply(fake as never);
const feedbackEntry = registrations.find(entry => entry.spec.name === "conversation.input.overlay" && entry.spec.id === "feedback-dialog" && entry.component !== FeedbackDialog)!;
const feedbackInjection = feedbackEntry.spec.inject("feedback-session");
if (surface === "feedback" && state !== "actions") {
  if (state === "message") registrations.find(entry => entry.spec.name === "conversation.chat.assistant-actions" && entry.spec.id === "feedback")!.spec.inject("feedback-session").openDialog("message-1", "positive");
  else (fake as any).feedbackUi.openSession("feedback-session");
}
const scheduleEntry = registrations.find(entry => entry.spec.name === "main" && entry.spec.key === "schedules")!;
if (scheduleEntry === undefined || !registrations.some(entry => entry.spec.name === "sidebar.panellist" && entry.spec.id === "schedules")) throw new Error("official Schedule page and sidebar must both register through the seam");
const scheduleInjection = scheduleEntry.spec.inject();
const source = scheduleInjection.hooks.catalog;
const permissionEntry = registrations.find(entry => entry.spec.name === "conversation.input.permission")!;
const permissionRowEntry = registrations.find(entry => entry.spec.name === "settings.general.item" && entry.spec.id === "permission")!;
const permissionInjection = permissionEntry.spec.inject("permission-session");
const permissionRowInjection = permissionRowEntry.spec.inject();
function PermissionFixture() {
  const current = useSyncExternalStore(permissionProjection.subscribe, permissionProjection.getSnapshot);
  const catalog = useSyncExternalStore(permissionInjection.hooks.permissionCatalog.subscribe, permissionInjection.hooks.permissionCatalog.getSnapshot);
  const row = useSyncExternalStore(permissionRowInjection.hooks.permission.subscribe, permissionRowInjection.hooks.permission.getSnapshot);
  const Select = adapted ? permissionEntry.component : PermissionSelect;
  const Row = adapted ? permissionRowEntry.component : PermissionRow;
  return <section className="permission-fixture"><div><Select t={translate("permission.access") as any} locked={false} useProjection={() => current} usePermissionCatalog={(selector: any) => selector(catalog)} select={permissionInjection.select} /></div><div><Row {...permissionRowInjection} t={translate("settings.permission")} usePermission={(selector: any) => selector(row)} /></div></section>;
}


const modelDirectory = createSnapshotStore<any>({
  current: { provider: "fixture", model: "current" }, routable: true,
  groups: [{ id: "fixture", name: "Fixture", models: [
    { id: "current", name: "Current model" },
    { id: "blocked", name: "Blocked model", unavailable: true, unavailableReason: "Unavailable in this deployment" },
    { id: "enabled", name: "Enabled model" },
    { id: "other-1", name: "Other one" }, { id: "other-2", name: "Other two" },
  ] }], failures: [], status: "ready", pending: null, error: null,
});

function ModelKeyboardFixture() {
  const dictionary = modelCopy[locale];
  return <section className="permission-fixture" style={{ paddingTop: 500 }}><ModelSelect
    locked={false} available directory={modelDirectory} load={() => {}}
    t={((key: keyof typeof dictionary, values: Record<string, unknown> = {}) => String(dictionary[key]).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? ""))) as any}
    resolveText={(text: any) => typeof text === "string" ? text : text[locale] ?? text.en}
    renderSlot={(_name: any, _owner: any, options: any) => options?.fallback ?? null}
    select={async selection => {
      calls.push({ endpoint: "model/select", args: selection });
      modelDirectory.update((snapshot: any) => { snapshot.current = selection; });
      return { ok: true, value: undefined };
    }}
  /></section>;
}

function FeedbackFixture() {
  const observed = useSyncExternalStore(feedbackInjection.hooks.dialog.subscribe, feedbackInjection.hooks.dialog.getSnapshot);
  const unavailable = true;
  const t = translate("feedback");
  const props = { ...feedbackInjection, t, useDialog: (selector: any) => selector(observed) };
  if (state === "actions") {
    const entry = registrations.find(entry => entry.spec.name === "conversation.chat.assistant-actions" && entry.component !== MessageFeedbackActions)!;
    const injection = entry.spec.inject("feedback-session");
    const reason = feedbackUnavailableReason(locale);
    const actionProps = { ...injection, messageId: "message-1", useAccess: () => true,
      useFeedback: (selector: any) => selector(injection.hooks.feedback.getSnapshot()), t,
    };
    const Actions = entry.component;
    return <section className="permission-fixture">{adapted ? <Actions {...actionProps} /> : <fieldset disabled aria-disabled="true" title={reason} style={{ display: "contents", border: 0, margin: 0, padding: 0, minWidth: 0 }}><MessageFeedbackActions {...actionProps as any} t={((key: string, params: any) => key.startsWith("action.") ? `${t(key, params)} · ${reason}` : t(key, params)) as any} /></fieldset>}</section>;
  }
  const Page = adapted ? feedbackEntry.component : FeedbackDialog;
  const reference = adapted ? {} : {
    useDialog: (selector: any) => selector(unavailable ? { ...observed, submitting: true } : observed),
    t: (key: string, values: any) => unavailable && key === "submitting" ? feedbackUnavailableReason(locale) : t(key, values),
  };
  return <section className="permission-fixture"><Page {...props} {...reference} /></section>;
}

function Fixture() {
  if (surface === "composer-runtime") return <ComposerRuntimeFixture locale={locale} />;
  if (surface === "chat-step") return <ChatStepFixture locale={locale} adapted={adapted} />;
  if (surface === "sidebar-lifecycle") return <SidebarLifecycleFixture />;
  if (surface === "model-effort") return <ModelEffortFixture locale={locale} adapted={adapted} state={state} />;
  if (surface === "upload") return <UploadFixture locale={locale} />;
  const [editor, setEditor] = useState({ drafts: {} as Record<string, unknown> });
  const actions = useMemo(() => ({
    setDraft: (key: string, draft: unknown) => setEditor(current => ({ drafts: { ...current.drafts, [key]: draft } })),
    clearDraft: (key: string) => setEditor(current => ({ drafts: Object.fromEntries(Object.entries(current.drafts).filter(([id]) => id !== key)) })),
  }), []);
  const observed = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const base = {
    ...scheduleInjection,
    t: translate("schedule.manager"),
    useCatalog: (selector: (value: unknown) => unknown) => selector(observed),
    useStore: (selector: (value: unknown) => unknown) => selector(editor), actions,
    useSessions: (selector: (value: unknown) => unknown) => selector(emptySessions),
    useWorkspaces: (selector: (value: unknown) => unknown) => selector(workspaces),
  };
  if (surface === "settings-navigation") return <SettingsNavigationFixture locale={locale} adapted={adapted} />;
  if (surface === "account") return <AccountFixture locale={locale} adapted={adapted} state={state} />;
  if (surface === "commands") return <CommandsFixture locale={locale} adapted={adapted} state={state} />;
  if (surface === "directory" || surface === "agent-preset") return <HostCapabilitiesFixture locale={locale} adapted={adapted} surface={surface} state={state} />;
  if (surface === "plugin-manager") return <PluginManagerFixture locale={locale} adapted={adapted} state={state} />;
  if (surface === "feedback") return <FeedbackFixture />;
  if (surface === "model-keyboard") return <ModelKeyboardFixture />;
  if (surface === "provider-editor") return <ProviderEditorFixture locale={locale} />;
  if (surface === "schedule") {
    const Page = adapted ? scheduleEntry.component : TaskManagerPage;
    return <Page {...base as any} />;
  }
  if (surface === "terminal") {
    const entry = registrations.find(entry => entry.spec.name === "sidebar.right.tab.guide.entry" && entry.spec.key === "@deepseek-ai/dsh-client-ui-sidebar-terminal")!;
    const injected = entry.spec.inject();
    const t = translate(entry.spec.locale);
    const props = { ...injected, title: t("title"), description: t("unavailable"), kind: "terminal", t,
      useShortcuts: (selector: any) => selector([]), useTabInfo: () => ({ tab: { actions: { openTab: () => calls.push({ endpoint: "terminal/open", args: {} }) } } }),
    };
    const Guide = entry.component;
    return <section className="permission-fixture">{adapted ? <Guide {...props} /> : <fieldset disabled aria-disabled="true" title={t("unavailable")} className="dsh-terminal-disabled"><TerminalGuide {...props as any} /></fieldset>}</section>;
  }
  if (surface === "session-log") {
    const entry = registrations.find(entry => entry.spec.name === "settings.general.item" && entry.spec.id === "session-log-deepseek")!;
    const injected = entry.spec.inject();
    const props = { ...injected, t: translate(entry.spec.locale),
      useUpload: (selector: any) => selector(injected.hooks.upload.getSnapshot()),
      useMutation: (selector: any) => selector(injected.hooks.mutation.getSnapshot()),
    };
    const Row = adapted ? entry.component : UploadRow;
    return <section className="permission-fixture"><Row {...props} /></section>;
  }
  return <PermissionFixture />;
}
(window as any).__PARITY__ = { checkModelDirectoryAvailability, calls, feedbackCopy: { ...commonCopy[locale], ...dictionaries.get("feedback")[locale] }, feedbackSource: feedbackInjection.hooks.dialog, copy: dictionaries.get("schedule.manager")[locale], registrations: registrations.map(({ spec }) => ({ name: spec.name, key: spec.key, id: spec.id })), setCreateFailure: (value: boolean) => { failCreate = value; }, source };
createRoot(document.getElementById("root")!).render(<Fixture />);
