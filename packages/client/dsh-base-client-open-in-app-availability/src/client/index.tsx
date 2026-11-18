/** Keep native-open actions visible when the Workers Host has no desktop. */
import type { Context } from "@deepseek-ai/cordis";
import type { OpenInAppActionInjected, OpenInAppActionProps } from "@deepseek-ai/dsh-client-ui-open-in-app/client";
import type {} from "@deepseek-ai/dsh-client-ui-context-menu/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { StoredEntry } from "@deepseek-ai/dsh-client-ui-slots";
import { OpenInAppAction } from "@deepseek-ai/dsh-client-ui-open-in-app/src/client/OpenInAppAction.tsx";
import { OpenTargetButton } from "@deepseek-ai/dsh-client-ui-open-in-app/src/client/OpenTargetButton.tsx";
import { z } from "zod";
import { canOpenDirectory, openInAppUnavailableReason } from "../availability.ts";
import "./availability.css";

export const name = "@dsh-base/client-open-in-app-availability";
export const Config = z.object({}).default({});
export const inject = ["contextMenus", "sessions", "slots", "locale"];

/** The Files page owns the directory path and the original action owns all live targets. */
function UnavailableDirectoryAction(props: Pick<OpenInAppActionProps, "absolutePath" | "useOpenInAppApps" | "t"> & { reason: () => string }) {
  const apps = props.useOpenInAppApps(value => value);
  if (!props.absolutePath || apps === null || canOpenDirectory(props.absolutePath, apps)) return null;
  const label = `${props.t("open.tooltip")} · ${props.reason()}`;
  return <fieldset disabled title={label} className="dsh-open-directory-unavailable">
    <OpenTargetButton kind="directory" applications={[]} defaultId={undefined} failed={false}
      t={(key, params) => key === "path.reveal" ? label : props.t(key, params)}
      execute={async () => ({ kind: "skipped" })} report={() => {}} />
  </fieldset>;
}

/** Both official menus and the Files action share a single Host application catalog. */
export function installOpenInAppAvailability(ctx: Context): () => void {
  const slot = "sidebar.right.tab.files.actions";
  const t = ctx.locale.bind("open-in-app");
  let owner: StoredEntry | undefined;
  let disposers: Array<() => void> = [];
  function sync() {
    const next = ctx.slots.entries(slot).find(entry => entry.options.id === "open-in-app" && entry.component === OpenInAppAction);
    if (next === owner) return;
    for (const dispose of disposers) dispose();
    disposers = [];
    owner = next;
    // The directory action exposes its own controller's observable catalog. Reuse
    // it so that preparation, refresh and plugin reload never issue another read.
    const face = next?.inject?.() as OpenInAppActionInjected | undefined;
    if (!face) return;
    const apps = face.hooks.openInAppApps;
    disposers.push(ctx.slots.register({
      name: slot, id: "dsh-base.open-in-app.unavailable", locale: "open-in-app",
      inject: () => ({ hooks: { openInAppApps: apps }, reason: () => openInAppUnavailableReason(ctx.locale.getSnapshot().active) }),
    }, UnavailableDirectoryAction));
    for (const target of ["session", "sessionHeader"] as const) {
      disposers.push(ctx.contextMenus.register({
        id: "dsh-base.open-in-app.unavailable", target, order: 500,
        observe: () => [ctx.sessions.list, apps, ctx.locale],
        resolve: ({ sessionId }) => {
          if (canOpenDirectory(ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd, apps.getSnapshot())) return [];
          return [{
            id: "unavailable", label: `${t("menu.openIn")} · ${openInAppUnavailableReason(ctx.locale.getSnapshot().active)}`,
            icon: { key: "open-in-app.application" }, disabled: true, separatorBefore: target === "sessionHeader",
          }];
        },
      }));
    }
  }
  const unsubscribe = ctx.slots.subscribe(slot, sync);
  sync();
  return () => { unsubscribe(); for (const dispose of disposers) dispose(); };
}

export function apply(ctx: Context): void {
  ctx.effect(() => installOpenInAppAvailability(ctx), "open-in-app: preserve unavailable Session and Files actions");
}
