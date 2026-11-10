import { z } from "zod";
/**
 * URL address seam for Session and Workspace ids.
 *
 * The official DSH client does not own browser history; this plugin mirrors
 * the official selection into `/app/session/:sessionId` and `/app/workspace/:workspaceId`
 * and restores it through the official uiWorkspace navigation services. It does
 * not render navigation UI and never alters official layout.
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@dsh-base/client-session-adapter/navigation-access";
import { copy, NS } from "./locales.ts";
import { createRouteNotice, RouteNotice } from "./notice.tsx";
import { installAddressNavigation } from "./navigation.ts";

export const name = "@dsh-base/client-route-address";
export const inject = ["sessions", "workspaces", "uiWorkspace", "slots", "locale", "navigationAccess", "layout"];
export const Config = z.object({}).default({});

export function apply(ctx: Context): void {
  const notice = createRouteNotice();
  ctx.effect(() => ctx.locale.register(NS, copy), "dsh-base: route-address dictionaries");
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "route-address.notice",
    locale: NS,
    inject: () => ({ hooks: notice.hooks, dismiss: notice.dismiss }),
  }, RouteNotice));
  ctx.effect(() => installAddressNavigation(ctx, notice.report), "dsh-base: route-address lifetime");
}
