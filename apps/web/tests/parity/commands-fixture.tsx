/** Pinned command popup, with actual /model options and unavailable Host capabilities. */
import React, { useMemo } from "react";
import { PopupSelectView as OfficialView } from "@deepseek-ai/dsh-client-ui-commands/src/client/PopupSelectView.tsx";
import { PopupSelectController as OfficialController } from "@deepseek-ai/dsh-client-ui-commands/client";
import * as commandCopy from "@deepseek-ai/dsh-client-ui-commands/src/client/locales.ts";
import { PopupSelectView as AdaptedView } from "../../../../packages/client/dsh-base-client-commands/src/client/PopupSelectView.tsx";
import { PopupSelectController as AdaptedController } from "../../../../packages/client/dsh-base-client-commands/src/client/popup.ts";
import { optionsOf } from "../../../../packages/client/dsh-base-client-model-selection/src/client/index.ts";
import * as modelCopy from "../../../../packages/client/dsh-base-client-model-selection/src/client/locales.ts";
const translate = (copy: Record<string, string>) => (key: string, values: Record<string, unknown> = {}) => String(copy[key]).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? ""));
export function CommandsFixture({ locale, adapted, state }: { locale: "en" | "zh"; adapted: boolean; state: string }) {
  const setup = useMemo(() => {
    const unavailable = state === "disabled";
    const reason = locale === "zh" ? "此模型在当前部署不可用" : "This model is unavailable in this deployment";
    const options = optionsOf({ current: { provider: "fixture", model: "current" }, routable: true, retainedEffort: undefined, status: "ready", pending: null, error: null, failures: [], groups: [{ id: "fixture", name: "Fixture", models: [
      { id: "current", name: "Current model" },
      { id: "blocked", name: "Blocked model", ...(unavailable ? { unavailable: true, unavailableReason: reason } : {}) },
      { id: "enabled", name: "Enabled model" },
    ] }] }, translate(modelCopy[locale]) as never);
    const calls: any[] = [];
    const counters = { consumed: 0, focused: 0 };
    const Controller = adapted ? AdaptedController : OfficialController;
    const popup = new Controller({ consume: () => { counters.consumed++; return true; }, focusComposer: () => { counters.focused++; } });
    popup.open("model", { options: async () => options, onSelect: async option => { calls.push(option.id); } }, {}, { via: "enter", token: "/model" });
    (window as any).__COMMAND_PARITY__ = { popup, calls, counters, options, reason };
    return { popup };
  }, [locale, adapted, state]);
  const View = adapted ? AdaptedView : OfficialView;
  return <section style={{ position: "absolute", left: 120, top: 600, width: 640, height: 1 }}><View popup={setup.popup as never} t={translate(commandCopy[locale]) as never} /></section>;
}
