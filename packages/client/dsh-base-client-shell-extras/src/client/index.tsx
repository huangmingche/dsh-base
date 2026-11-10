/** Product facts appended to the official sidebar More menu. */
import { useSyncExternalStore } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
import { MenuItemButton } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SiteConfigService } from "@dsh-base/client-site-config";
import { MORE_NS, moreCopy } from "./more-copy.ts";

export const name = "@dsh-base/client-shell-extras";
export const Config = z.object({}).default({});
export const inject = ["slots", "locale", "siteConfig"];

export { MORE_NS, moreCopy } from "./more-copy.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dshBase.sidebarMore": keyof typeof moreCopy.en;
  }
}

interface MoreMenuInjected {
  readonly t: (key: keyof typeof moreCopy.en) => string;
  readonly site: SiteConfigService;
}

/** Read the site-config snapshot and re-render when the runtime facts land. */
function useSiteConfig(service: SiteConfigService) {
  return useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
}

/** The three product rows appended to the official More menu. */
function SidebarMoreMenu({ t, site }: MoreMenuInjected) {
  const siteConfig = useSiteConfig(site);
  const { docs, supportEmail } = siteConfig.config.links;
  const environmentLabel = siteConfig.environmentLabel;
  return <>
    {docs === undefined ? undefined : (
      <MenuItemButton separatorBefore onSelect={() => window.open(docs, "_blank", "noopener,noreferrer")}>
        {`${t("about")} ${siteConfig.config.brand.name}`}
      </MenuItemButton>
    )}
    {supportEmail === undefined ? (
      <MenuItemButton disabled disabledReason={t("supportUnavailable")} onSelect={() => {}}>
        {t("support")}
      </MenuItemButton>
    ) : (
      <MenuItemButton onSelect={() => { window.location.href = `mailto:${supportEmail}`; }}>
        {t("support")}
      </MenuItemButton>
    )}
    <MenuItemButton
      disabled
      disabledReason={environmentLabel === undefined ? t("environmentUnavailable") : t("environmentHint")}
      onSelect={() => {}}
    >
      {environmentLabel === undefined ? t("environmentMissing") : `${t("environment")}: ${environmentLabel}`}
    </MenuItemButton>
  </>;
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(MORE_NS, moreCopy), "dsh-base: sidebar More dictionaries");
  const t = ctx.locale.bind(MORE_NS) as (key: keyof typeof moreCopy.en) => string;
  ctx.slots.inject("sidebar.panellist.actions", () =>
    ctx.slots.register({
      name: "sidebar.panellist.actions",
      id: "dsh-base-more",
      // Official entry-customization registers at the default order 0; product
      // facts stay after the official Browse/Create rows.
      order: 1,
      inject: () => ({
        t,
        site: (ctx as unknown as { siteConfig: SiteConfigService }).siteConfig,
      }),
    }, SidebarMoreMenu));
}
