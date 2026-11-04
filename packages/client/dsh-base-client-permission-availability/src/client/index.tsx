/** Reuse the official permission controls with an honest unavailable Host state. */
import type { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
import { PermissionSelect, type PermissionSelectProps } from "@deepseek-ai/dsh-client-ui-permission-presets/src/client/PermissionSelect.tsx";
import { PermissionRow, type PermissionRowProps } from "@deepseek-ai/dsh-client-ui-permission-presets/src/client/PermissionRow.tsx";
import * as officialLocales from "@deepseek-ai/dsh-client-ui-permission-presets/src/client/locales.ts";
import { permissionAvailability } from "../availability.ts";

export const name = "@dsh-base/client-permission-availability";
export const inject = ["slots", "locale"];
export const Config = z.object({}).default({});

interface AvailabilityProps {
  readonly availability: () => { readonly label: string; readonly reason: string };
}

/** The official component owns markup, icons, menu and disabled styling. */
function UnavailablePermissionSelect(props: Omit<PermissionSelectProps, "select" | "usePermissionCatalog"> & AvailabilityProps) {
  const { label, reason } = props.availability();
  const catalog = {
    options: [{ value: "unavailable", name: label, description: reason }],
    defaultOptions: [],
    defaultPreset: "unavailable",
  };
  return <PermissionSelect {...props} locked
    useProjection={() => ({ currentValue: "unavailable" })}
    usePermissionCatalog={(select) => select({ value: catalog })}
    select={async () => false} />;
}

/** Keep the official settings row visible; its read-only state explains why. */
function UnavailablePermissionRow(props: Omit<PermissionRowProps, "load" | "select" | "usePermission"> & AvailabilityProps) {
  return <PermissionRow {...props}
    usePermission={(select) => select({
      status: "ready", writable: false, currentValue: "", options: [],
      revision: 0, error: props.availability().reason,
    })}
    load={async () => {}}
    select={async () => { throw new Error(props.availability().reason); }} />;
}

export function apply(ctx: Context): void {
  const settings = {
    en: officialLocales.en, zh: officialLocales.zh, ja: officialLocales.ja, es: officialLocales.es,
    fr: officialLocales.fr, de: officialLocales.de, ru: officialLocales.ru, pt: officialLocales.pt,
  };
  const access = {
    en: officialLocales.accessEn, zh: officialLocales.accessZh, ja: officialLocales.accessJa, es: officialLocales.accessEs,
    fr: officialLocales.accessFr, de: officialLocales.accessDe, ru: officialLocales.accessRu, pt: officialLocales.accessPt,
  };
  ctx.effect(() => ctx.locale.register("settings.permission", settings));
  ctx.effect(() => ctx.locale.register("permission.access", access));
  ctx.effect(() => ctx.locale.register("dshBase.permissionAvailability", permissionAvailability));
  const t = ctx.locale.bind("dshBase.permissionAvailability");
  const availability = () => ({ label: t("label"), reason: t("reason") });
  ctx.slots.inject("conversation.input.permission", () => ctx.slots.register({
    name: "conversation.input.permission", locale: "permission.access",
    inject: () => ({ availability }),
  }, UnavailablePermissionSelect));
  ctx.slots.inject("settings.general.item", () => ctx.slots.register({
    name: "settings.general.item", id: "permission", order: -20, locale: "settings.permission",
    inject: () => ({ availability }),
  }, UnavailablePermissionRow));
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "permission.access": keyof typeof officialLocales.accessEn;
    "dshBase.permissionAvailability": "label" | "reason";
  }
}
