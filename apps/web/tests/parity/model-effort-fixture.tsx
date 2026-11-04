/** Compare the pinned selector and its capability-only fork under the same catalog. */
import React, { useMemo } from "react";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { ModelSelect as OfficialModelSelect } from "@deepseek-ai/dsh-client-ui-model-selection/src/client/ModelSelect.tsx";
import { ModelSelect } from "../../../../packages/client/dsh-base-client-model-selection/src/client/ModelSelect.tsx";
import * as copy from "../../../../packages/client/dsh-base-client-model-selection/src/client/locales.ts";

export function ModelEffortFixture({ locale, adapted, state }: { locale: "en" | "zh"; adapted: boolean; state: string }) {
  const setup = useMemo(() => {
    const unavailable = state === "unavailable";
    const reasoning = { efforts: [{ id: "off", name: "Off" }, { id: "low", name: "Low" }, { id: "high", name: "High" }, { id: "max", name: "Max" }],
      ...(unavailable ? { unavailable: true, unavailableReason: copy[locale]["effort.unavailableReason"] } : { defaultEffort: "high" }) };
    const directory = createSnapshotStore<any>({ current: { provider: "fixture", model: "current" }, routable: true,
      groups: [{ id: "fixture", name: "Fixture", models: [{ id: "current", name: "Current model", reasoning }, { id: "next", name: "Next model", reasoning }] }],
      failures: [], status: "ready", pending: null, error: null });
    const calls: unknown[] = [];
    (window as any).__EFFORT_PARITY__ = { calls, directory, copy: copy[locale], withdraw: () => directory.update(snapshot => { snapshot.groups[0].models[0].reasoning.unavailable = true; }) };
    return { directory, calls };
  }, [locale, state]);
  const Component = adapted ? ModelSelect : OfficialModelSelect;
  return <section style={{ paddingTop: 500, margin: "0 auto", width: 640 }}><Component available locked={false}
    directory={setup.directory} load={() => {}}
    t={((key: string, values: Record<string, unknown> = {}) => String((copy[locale] as any)[key]).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? ""))) as never}
    resolveText={(text: any) => typeof text === "string" ? text : text[locale] ?? text.en}
    renderSlot={((_name: unknown, _owner: unknown, options: any) => options?.fallback ?? null) as never}
    select={async selection => { setup.calls.push(selection); setup.directory.update(snapshot => { snapshot.current = selection; }); return { ok: true, value: undefined }; }}
  /></section>;
}
