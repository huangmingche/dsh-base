/** Unchanged official intake components and background uploader over a controlled Host. */
import React, { useEffect, useMemo, useState } from "react";
import { Context } from "@deepseek-ai/cordis";
import { apply as fileUploadApply } from "@deepseek-ai/dsh-client-file-upload/client";
import { createWebConnectionRpc } from "@deepseek-ai/dsh-client-connection/src/client/rpc.ts";
import { InputBar } from "@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/InputBar.tsx";
import { ComposerAttachments } from "@deepseek-ai/dsh-client-ui-attachment/src/client/ComposerAttachments.tsx";
import * as conversationCopy from "@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts";
import * as commonCopy from "@deepseek-ai/dsh-client-locale/src/locales/index.ts";
import { createAttachmentRemotes } from "../../../../packages/client/dsh-base-client-session-adapter/src/client/attachment-remote.ts";

export function UploadFixture({ locale }: { locale: "en" | "zh" }) {
  const [ready, setReady] = useState(false);
  const setup = useMemo(() => {
    const ctx = new Context();
    const remote = createAttachmentRemotes(() => createWebConnectionRpc());
    ctx.provide("remote", { fileUploads: remote.fileUploads } as never);
    const fiber = ctx.plugin({ apply: fileUploadApply });
    const calls: string[] = [], outcomes: unknown[] = [];
    const keyboard = { editor: null, bindFilePicker: () => () => {}, caretSpan: () => ({ start: 0, end: 0 }), submit: () => {} };
    const fixtures = {
      calls, outcomes, remote,
      raw: async (name = "raw.txt") => ctx.get("fileUpload")!.upload("session-one" as never, new File(["file contents"], name, { type: "text/plain" }), name),
      bytes: async () => ctx.get("fileUpload")!.upload("session-one" as never, new Uint8Array([97, 98, 99]), "encoded.txt"),
      image: async () => ctx.get("fileUpload")!.uploadImage("session-one" as never, new Blob(["image"], { type: "image/png" }), "image/png", "image.png"),
      abort: async () => {
        const controller = new AbortController();
        const result = ctx.get("fileUpload")!.upload("session-one" as never, new Blob(["slow"], { type: "text/plain" }), "slow.txt", controller.signal);
        setTimeout(() => controller.abort(), 40);
        try { await result; return "unexpected success"; } catch (error) { return (error as Error).name; }
      },
      addFiles: (files: readonly File[]) => {
        calls.push(...files.map(file => file.name));
        for (const file of files) void ctx.get("fileUpload")!.upload("session-one" as never, file, file.name).then(value => outcomes.push(value));
        return null;
      },
      expectedImageMessage: conversationCopy[locale]["image.tooMany"].replace("{count}", "0"),
    };
    (window as any).__UPLOAD_PARITY__ = fixtures;
    return { ctx, fiber, fixtures, keyboard };
  }, [locale]);
  useEffect(() => { void setup.fiber.await().then(() => setReady(true)); return () => { void setup.fiber.dispose(); }; }, [setup]);
  if (!ready) return null;
  const input = { phase: "plain", draft: "", attachmentIds: [], queue: [] };
  const dictionary = { ...commonCopy[locale], ...conversationCopy[locale] };
  const t = (key: string, values: Record<string, unknown> = {}) => String((dictionary as any)[key] ?? key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? ""));
  const limits = { maxImageBytes: 0, maxMessageImageBytes: 0, maxImagesPerMessage: 0, maxImagePixels: 0, maxImageDimension: 0, mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] };
  const props: any = {
    sessionId: "session-one", variant: "hero", t, keyboard: setup.keyboard,
    useInput: (select: any) => select(input), inputActions: { pruneAttachments: () => {} },
    useSession: (select: any) => select({ promptError: null, running: false, subagent: null, removed: false }),
    useAccess: () => true, useBusyEnter: (select: any) => select("queue"),
    useFileUploads: (select: any) => select({}), useNotices: (select: any) => select(null),
    useLexicon: () => undefined, useMenuLauncher: (select: any) => select(null), useStopShortcut: (select: any) => select([]),
    useProjection: (key: string, select?: any) => { const value = key === "imageLimits" ? limits : undefined; return select ? select(value) : value; },
    addFiles: setup.fixtures.addFiles, resolveDraftAttachments: () => [], toggleCommandMenu: () => {},
    renderSlot: (slot: string, owner: any) => slot === "conversation.input.attachments"
      ? <ComposerAttachments {...owner} t={t as never} readFileDrag={() => undefined} /> : null,
  };
  return <section style={{ width: 760, margin: "120px auto" }}><InputBar {...props} /></section>;
}
