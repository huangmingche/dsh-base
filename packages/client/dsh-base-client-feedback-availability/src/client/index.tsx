/** Availability seam over the official feedback plugin's existing dialog/controller. */
import type { Context } from "@deepseek-ai/cordis";
import type { FeedbackDialogProps, MessageFeedbackActionProps } from "@deepseek-ai/dsh-client-ui-message-feedback/client";
import type { StoredEntry } from "@deepseek-ai/dsh-client-ui-slots";
import { MessageFeedbackActions } from "@deepseek-ai/dsh-client-ui-message-feedback/src/client/MessageFeedbackActions.tsx";
import { FeedbackDialog } from "@deepseek-ai/dsh-client-ui-message-feedback/src/client/FeedbackDialog.tsx";
import { z } from "zod";
import { feedbackUnavailableReason } from "../availability.ts";

export const name = "@dsh-base/client-feedback-availability";
export const Config = z.object({}).default({});
export const inject = ["slots", "locale", "feedbackUi"];

/** Reuse the component's disabled state for every feedback target. */
export function AvailableFeedbackDialog(props: FeedbackDialogProps & { unavailableReason: () => string }) {
  return <FeedbackDialog {...props}
    useDialog={selector => props.useDialog(state => selector({ ...state, submitting: true }))}
    t={(key, params) => key === "submitting" ? props.unavailableReason() : props.t(key, params)}
  />;
}

/** Fieldset semantics disable both mouse and keyboard without replacing either icon. */
export function UnavailableFeedbackActions(props: MessageFeedbackActionProps & { unavailableReason: () => string }) {
  const reason = props.unavailableReason();
  return <fieldset disabled aria-disabled="true" title={reason} style={{ display: "contents", border: 0, margin: 0, padding: 0, minWidth: 0 }}>
    <MessageFeedbackActions {...props} t={(key, params) => key.startsWith("action.") ? `${props.t(key, params)} · ${reason}` : props.t(key, params)} />
  </fieldset>;
}

export function apply(ctx: Context): void {
  for (const [slot, Component, Adapted] of [
    ["conversation.input.overlay", FeedbackDialog, AvailableFeedbackDialog],
    ["conversation.chat.assistant-actions", MessageFeedbackActions, UnavailableFeedbackActions],
  ] as const) {
    ctx.effect(() => {
      let original: StoredEntry | undefined;
      let dispose: (() => void) | undefined;
      const sync = () => {
        const next = ctx.slots.entries(slot).find(entry => entry.component === Component);
        if (next === original) return;
        dispose?.(); dispose = undefined; original = next;
        if (next === undefined) return;
        // Reuse the official per-session controller and registration through the
        // public registry; the original entry remains present behind the shadow.
        dispose = ctx.slots.register({
          name: slot, ...next.options, priority: -1, locale: "feedback",
          inject: (...args: never[]) => ({ ...next.inject?.(...args),
            unavailableReason: () => feedbackUnavailableReason(ctx.locale.getSnapshot().active),
          }),
        } as never, Adapted as never);
      };
      const unsubscribe = ctx.slots.subscribe(slot, sync);
      sync();
      return () => { unsubscribe(); dispose?.(); };
    }, `feedback availability: official disabled ${slot}`);
  }
}
