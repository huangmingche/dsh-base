/** Compatibility seam: keep the official unavailable Session-log preference visible. */
import type { Context } from "@deepseek-ai/cordis";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { UploadRow, type UploadInjected } from "@deepseek-ai/dsh-client-ui-settings-session-log/src/client/UploadRow.tsx";
import * as officialCopy from "@deepseek-ai/dsh-client-ui-settings-session-log/src/client/locales.ts";
import { z } from "zod";

export const name = "@dsh-base/client-settings";
export const Config = z.object({}).default({});
export const inject = ["slots", "locale"];
const NS = "dshBase.sessionLogAvailability";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dshBase.sessionLogAvailability": keyof typeof officialCopy.en;
  }
}

const reasons = {
  en: "Session-log uploads are unavailable because this deployment has no upload service.",
  zh: "当前部署没有日志上传服务，无法上传会话日志。",
  ja: "この環境にはアップロードサービスがないため、セッションログを送信できません。",
  es: "Esta implementación no tiene un servicio para cargar registros de sesión.",
  fr: "Ce déploiement ne dispose pas de service d’envoi des journaux de session.",
  de: "Diese Bereitstellung hat keinen Dienst zum Hochladen von Sitzungsprotokollen.",
  ru: "В этом развёртывании нет службы загрузки журналов сеансов.",
  pt: "Esta implantação não tem um serviço para enviar registros de sessão.",
} as const;

function UnavailableUploadRow(props: Omit<Parameters<typeof UploadRow>[0], "t"> & PropsLocale<typeof NS>) {
  return <UploadRow {...props} t={(key, params) => props.t(key, params)} />;
}

export function apply(ctx: Context): void {
  const copy = (locale: keyof typeof reasons) => ({ ...officialCopy[locale], description: reasons[locale] });
  const dictionaries = { en: copy("en"), zh: copy("zh"), ja: copy("ja"), es: copy("es"), fr: copy("fr"), de: copy("de"), ru: copy("ru"), pt: copy("pt") };
  ctx.effect(() => ctx.locale.register(NS, dictionaries), "settings availability: localized Host limitation");
  const t = ctx.locale.bind(NS);
  const upload = createSnapshotStore({ status: "unavailable" as const, value: undefined, base: undefined, user: undefined, revision: undefined, writable: false });
  const mutation = createSnapshotStore({ busy: false, notice: null, sequence: 0 });
  const face = (): UploadInjected => ({
    hooks: { upload, mutation },
    setEnabled: async () => { throw new Error(t("description")); },
    dismiss: () => {},
  });
  // The official plugin's whileServed hides absent namespaces. The documented
  // slot priority keeps the same exported row visible, read-only, and localized.
  ctx.effect(() => ctx.slots.inject("settings.general.item", () => ctx.slots.register({
    name: "settings.general.item", id: "session-log-deepseek", order: 90,
    priority: -1, locale: NS, inject: face,
  }, UnavailableUploadRow)), "settings availability: official disabled upload row");
}
