/** Preserve the official native-open header utility when its Host capability is absent. */
import type { Context } from "@deepseek-ai/cordis";
import type { PropsRuntime, StoredEntry } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { OpenInAppAction, type OpenInAppActionProps } from "@deepseek-ai/dsh-client-ui-open-in-app/src/client/OpenInAppAction.tsx";
import { OpenTargetButton } from "@deepseek-ai/dsh-client-ui-open-in-app/src/client/OpenTargetButton.tsx";
import { z } from "zod";
import { canOpenDirectory, openInAppUnavailableReason } from "../availability.ts";

export const name = "@dsh-base/client-open-in-app-availability";
export const Config = z.object({}).default({});
export const inject = ["slots", "locale"];

export type AvailabilityOpenInAppProps = PropsRuntime<"conversation.session.header.utilities">
  & Omit<OpenInAppActionProps, "absolutePath">
  & { readonly unavailableReason: () => string };

/** Keep the pinned control's dimensions and icon; fieldset disables pointer and keyboard activation. */
export function AvailabilityOpenInAppAction(props: AvailabilityOpenInAppProps) {
  const directory = props.useSessions(state => state.byId[props.sessionId]?.cwd);
  const applications = props.useOpenInAppApps(value => value);
  if (canOpenDirectory(directory, applications)) return <OpenInAppAction {...props} absolutePath={directory!} />;
  const reason = props.unavailableReason();
  return <fieldset disabled aria-disabled="true" title={reason} data-open-in-app-unavailable=""
    style={{ display: "inline-flex", border: 0, margin: 0, padding: 0, minWidth: 0, opacity: 0.4 }}>
    <OpenTargetButton kind="directory" applications={[]} defaultId={undefined} failed={false}
      t={(key, values) => key === "path.reveal" ? `${props.t("open.tooltip")} · ${reason}` : props.t(key, values)}
      execute={async () => ({ kind: "skipped" })} report={() => {}} />
  </fieldset>;
}

/** Shadow only the official utility, retain its controller, and follow late mount/unload/reload. */
export function installOpenInAppAvailability(ctx: Context): () => void {
  const slot = "conversation.session.header.utilities";
  let original: StoredEntry | undefined;
  let dispose: (() => void) | undefined;
  const sync = () => {
    const next = ctx.slots.entries(slot).find(entry => entry.options.id === "open-in-app"
      && entry.component !== AvailabilityOpenInAppAction);
    if (next === original) return;
    dispose?.(); dispose = undefined; original = next;
    if (next === undefined) return;
    dispose = ctx.slots.register({
      name: slot, ...next.options, priority: -1, locale: "open-in-app",
      inject: (...args: never[]) => ({ ...next.inject?.(...args),
        unavailableReason: () => openInAppUnavailableReason(ctx.locale.getSnapshot().active),
      }),
    } as never, AvailabilityOpenInAppAction as never);
  };
  const unsubscribe = ctx.slots.subscribe(slot, sync);
  sync();
  return () => { unsubscribe(); dispose?.(); };
}

export function apply(ctx: Context): void {
  ctx.effect(() => installOpenInAppAvailability(ctx), "open-in-app: preserve unavailable official header utility");
}
