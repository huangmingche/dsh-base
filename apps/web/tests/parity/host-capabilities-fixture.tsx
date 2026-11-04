/** Official directory/preset surfaces driven by the actual compatibility contracts. */
import React, { useMemo } from "react";
import { Context } from "@deepseek-ai/cordis";
import * as common from "@deepseek-ai/dsh-client-locale/src/locales/index.ts";
import { apply as browseApply } from "@deepseek-ai/dsh-client-ui-directory-picker-browse/client";
import { BrowseDirectoryFlow } from "@deepseek-ai/dsh-client-ui-directory-picker-browse/src/client/flow.ts";
import { AgentPresetSeat } from "@deepseek-ai/dsh-client-ui-agent-preset/src/client/AgentPresetSeat.tsx";
import { AgentPresetSection } from "@deepseek-ai/dsh-client-ui-agent-preset/src/client/AgentPresetSection.tsx";
import { AgentPresetSeat as ForkAgentPresetSeat } from "../../../../packages/client/dsh-base-client-agent-preset/src/client/AgentPresetSeat.tsx";
import { AgentPresetSection as ForkAgentPresetSection } from "../../../../packages/client/dsh-base-client-agent-preset/src/client/AgentPresetSection.tsx";
import * as presetCopy from "@deepseek-ai/dsh-client-ui-agent-preset/src/client/locales.ts";
import { fixedAgentPresetCopy } from "../../../../packages/boot/dsh-base-agent-presets/src/availability.ts";
import { OFFICIAL_PRESET_DECLARATIONS } from "../../../../packages/client/dsh-base-client-session-adapter/src/client/official-preset-declarations.generated.ts";
import { createDirectoryRemote } from "../../../../packages/client/dsh-base-client-session-adapter/src/client/directory-remote.ts";

function prepare(locale: "en" | "zh", mode: "default" | "built-in" | "broken" = "default") {
  const root = new Context();
  const entries: any[] = [];
  const dictionaries: Record<string, any> = {};
  const calls: any[] = [];
  const paths = new Set(["/", "/existing"]);
  let refuseCreate = false;
  const copy = fixedAgentPresetCopy(locale);
  const builtin = mode === "built-in";
  const rows = builtin
    ? [{ id: "standard", isDefault: false }]
    : mode === "broken"
      ? [
          { id: "standard", isDefault: false, broken: "Fixture declaration failed to load." },
          { id: "ptc", isDefault: false, broken: "Fixture declaration failed to load." },
          { id: "minimal", isDefault: false, broken: "Fixture declaration failed to load." },
          { id: "cordis", isDefault: false, broken: "Fixture declaration failed to load." },
          { id: "dsh-base-think", name: copy.thinkName, description: copy.thinkDescription, isDefault: true },
        ]
      : [
          { id: "standard", isDefault: false, unavailable: copy.unavailableReason },
          { id: "ptc", isDefault: false, unavailable: copy.unavailableReason },
          { id: "minimal", isDefault: false, unavailable: copy.unavailableReason },
          { id: "cordis", isDefault: false, unavailable: copy.unavailableReason },
          { id: "dsh-base-think", name: copy.thinkName, description: copy.thinkDescription, isDefault: true },
        ];
  // The official Seat controller filters broken rows; the composer therefore
  // offers only the mode this deployment can actually compose.
  const options = rows.map(({ id, name, description, broken, unavailable }) => ({
    id,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(broken === undefined ? {} : { broken }),
    ...(unavailable === undefined ? {} : { unavailable }),
  }));
  const seatState = { options, current: builtin ? "standard" : "dsh-base-think", busy: false, introduce: false, error: null };
  const sectionState = { status: "ready", error: null, saving: false, rows, view: null as { id: string; title: string; content: string } | null };
  const directory = createDirectoryRemote(() => ({ async call(_channel: string, endpoint: string, payload: any) {
    calls.push({ endpoint, args: payload.args });
    if (endpoint === "directoryPicker/list") {
      const path = payload.args.path ?? "/";
      if (!paths.has(path)) return { ok: false, error: { code: "directory-picker/unreadable", message: "unreadable", details: { path } } };
      const children = [...paths].filter(candidate => candidate !== path && candidate.slice(0, candidate.lastIndexOf("/")) === (path === "/" ? "" : path));
      return { ok: true, value: { path, home: "/", crumbs: [{ name: "/", path: "/", hidden: false }, ...(path === "/" ? [] : [{ name: path.slice(1), path, hidden: false }])], entries: children.map(child => ({ path: child, name: child.split("/").at(-1), hidden: false })), truncated: false } };
    }
    if (endpoint === "directoryPicker/createDirectory") {
      const path = `${payload.args.path === "/" ? "" : payload.args.path}/${payload.args.name}`;
      if (refuseCreate) return { ok: false, error: { code: "directory-picker/exists", message: "fixture duplicate", details: { path } } };
      paths.add(path); return { ok: true, value: path };
    }
    throw new Error(endpoint);
  } }) as never);
  const unwrap = async (pending: Promise<any>) => { const result = await pending; if (!result.ok) throw new Error(result.error.message); return result.value; };
  const fake: any = {
    effect: root.effect.bind(root),
    locale: { getSnapshot: () => ({ active: locale }),
      register(ns: string, language: string, dictionary: any) { (dictionaries[ns] ??= {})[language] = dictionary; return () => {}; },
      bind: (ns: string) => (key: string, values: Record<string, unknown> = {}) => String(dictionaries[ns]?.[locale]?.[key] ?? common[locale][key as keyof typeof common.en] ?? key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? "")),
    },
    uiWorkspace: { listDirectory: (path?: string, signal?: AbortSignal) => unwrap(directory.list(path, signal)), createDirectory: (path: string, name: string) => unwrap(directory.createDirectory(path, name)) },
    slots: {
      inject: (_name: string, callback: () => any) => root.effect(callback),
      register(spec: any, component: any) { const entry = { component, options: spec, spec, inject: spec.inject }; entries.push(entry); return () => { entries.splice(entries.indexOf(entry), 1); }; },
      entries: (slot: string) => entries.filter(entry => entry.spec.name === slot),
      subscribe: () => () => {},
    },
  };
  browseApply(fake);
  const t = (key: keyof typeof presetCopy.en | "unavailableBadge", values: Record<string, unknown> = {}) => String(
    key === "unavailableBadge"
      ? (locale === "zh" ? "不可用" : "Unavailable")
      : presetCopy[locale][key] ?? (common[locale] as any)[key] ?? key,
  ).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? ""));
  return { entries, dictionaries, calls, copy, rows, seatState, sectionState, t,
    setRefuseCreate: (value: boolean) => { refuseCreate = value; },
  };
}

export function HostCapabilitiesFixture({ locale, adapted, surface, state }: { locale: "en" | "zh"; adapted: boolean; surface: "directory" | "agent-preset"; state?: string }) {
  const mode = state === "built-in" ? "built-in" : state === "broken" ? "broken" : "default";
  const fixture = useMemo(() => prepare(locale, mode), [locale, mode]);
  const [view, setView] = React.useState<{ id: string; title: string; content: string } | null>(null);
  (window as any).__CAPABILITIES__ = fixture;
  if (surface === "directory") {
    const entry = fixture.entries.find(entry => entry.spec.name === "sidebar.workspaces.directoryFlow");
    const Flow = adapted ? entry.component : BrowseDirectoryFlow;
    return <section><Flow {...entry.inject()} open busy={false} onCancel={() => {}} onError={() => {}} onPicked={(path: string) => fixture.calls.push({ endpoint: "workspace/picked", args: { path } })} /></section>;
  }
  const commonProps = { t: fixture.t, load: async () => {}, useDeveloperTools: (selector: any) => selector(true) };
  const seatProps: any = { ...commonProps, sessionId: undefined, useSessionRetainInfo: (selector: any) => selector(undefined),
    useAgentPresetSeat: (selector: any) => selector(fixture.seatState),
    select: async () => { fixture.calls.push({ endpoint: "agentPresets/select" }); }, dismissRefusal: () => {}, introduced: () => {},
  };
  const sectionState = { ...fixture.sectionState, view };
  const viewDocument = async (id: string) => {
    fixture.calls.push({ endpoint: "agentPresets/read", args: { id } });
    const document = OFFICIAL_PRESET_DECLARATIONS[id as keyof typeof OFFICIAL_PRESET_DECLARATIONS];
    if (document === undefined) throw new Error(`no official declaration for ${id}`);
    const row = fixture.rows.find(candidate => candidate.id === id) as { name?: string } | undefined;
    setView({ id, title: row?.name ?? id, content: document.content });
  };
  const sectionProps: any = { ...commonProps, close: () => {},
    startCreatorDraft: () => { fixture.calls.push({ endpoint: "creator/start" }); },
    useAgentPresetSection: (selector: any) => selector(sectionState),
    view: viewDocument, makeDefault: async () => { fixture.calls.push({ endpoint: "agentPresets/makeDefault" }); }, closeView: () => { setView(null); },
  };
  const forkSectionProps = {
    ...sectionProps,
    viewUnavailableReason: (id: string) => id === "dsh-base-think" ? fixture.copy.readUnavailable : undefined,
    creatorUnavailableReason: fixture.copy.creatorUnavailable,
  };
  return <section style={{ padding: 32, maxWidth: 760 }}>
    {adapted ? <ForkAgentPresetSeat {...seatProps} /> : <AgentPresetSeat {...seatProps} />}
    <div style={{ marginTop: 40 }}>{adapted ? <ForkAgentPresetSection {...forkSectionProps} /> : <AgentPresetSection {...sectionProps} />}</div>
  </section>;
}
