/** Real unchanged official composer, Lexical facade and selector bridge. */
import React, { useEffect, useMemo } from "react";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { bindSnapshotSelector } from "@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts";
import { SessionInputShell } from "@deepseek-ai/dsh-client-ui-conversation/src/client/input/facade.ts";
import { InputBar } from "@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/InputBar.tsx";
import * as conversationCopy from "@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts";
import * as commonCopy from "@deepseek-ai/dsh-client-locale/src/locales/index.ts";

export function ComposerRuntimeFixture({ locale }: { locale: "en" | "zh" }) {
  const setup = useMemo(() => {
    const ctx = new Context();
    const submitted: string[] = [];
    const input = new SessionInputShell({
      actx: ctx,
      defaultSink: async text => { submitted.push(text); return { kind: "success" }; },
      commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: () => "Unsupported attachment" },
    });
    let publications = 0;
    const unsubscribe = input.state.subscribe(() => { publications += 1; });
    const constant = <T,>(value: T) => bindSnapshotSelector(createSnapshotStore(value));
    const hooks = {
      useInput: bindSnapshotSelector(input.state), useNotices: bindSnapshotSelector(input.notices),
      useSession: constant({ promptError: null, running: false, subagent: null, removed: false }),
      useBusyEnter: constant("queue"), useFileUploads: constant({}), useMenuLauncher: constant(null),
      useStopShortcut: constant([]), useLexicon: bindSnapshotSelector(input.lexicon),
    };
    (window as any).__COMPOSER_RUNTIME__ = { input, submitted, publications: () => publications, reactVersion: React.version };
    return { ctx, input, hooks, unsubscribe };
  }, []);
  useEffect(() => () => { setup.unsubscribe(); setup.input.dispose(); void setup.ctx.fiber.dispose(); }, [setup]);
  const dictionary = { ...commonCopy[locale], ...conversationCopy[locale] };
  const t = (key: string, values: Record<string, unknown> = {}) => String((dictionary as any)[key] ?? key).replace(/\{([^}]+)\}/g, (_, key) => String(values[key] ?? ""));
  return <section style={{ width: 760, margin: "120px auto" }}><InputBar {...{
    ...setup.hooks, t, sessionId: "composer-runtime", variant: "session", keyboard: setup.input,
    inputActions: setup.input.actions, useAccess: () => true, resolveDraftAttachments: () => [],
    useProjection: (_key: string, select?: (value: undefined) => unknown) => select ? select(undefined) : undefined,
    renderSlot: () => null, toggleCommandMenu: () => {},
  } as any} /></section>;
}
