/** Product name in the official sidebar name slot; mark, layout and interaction stay official. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dsh-base/client-site-config/client";
import { z } from "zod";
import { ProductBrandName } from "./Brand.tsx";

export const name = "@dsh-base/client-brand";
export const inject = ["slots", "siteConfig"];

export const Config = z.object({}).default({});

export function apply(ctx: Context): void {
  // The official brand plugin is a no-op outside the official build profile, so
  // the sidebar renders its SidebarRoot fallbacks. Occupying only the name slot
  // replaces the display text; the official mark fallback stays in place.
  ctx.slots.inject("sidebar.brand.name", () =>
    ctx.slots.register({ name: "sidebar.brand.name", inject: () => ({ hooks: { siteConfig: ctx.siteConfig } }) }, ProductBrandName));
}
