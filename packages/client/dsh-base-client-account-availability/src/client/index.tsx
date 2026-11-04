/** Preserve the exported official account section over a Host without billing. */
import type { Context } from "@deepseek-ai/cordis";
import type { SyntheticEvent, KeyboardEvent } from "react";
import type { StoredEntry } from "@deepseek-ai/dsh-client-ui-slots";
import type { AccountSectionProps } from "@deepseek-ai/dsh-client-ui-settings-account/client";
import { AccountSection } from "@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountSection.tsx";
import { z } from "zod";
import { billingUnavailableReason } from "../availability.ts";
import "./availability.css";

export const name = "@dsh-base/client-account-availability";
export const Config = z.object({}).default({});
export const inject = ["slots", "locale"];

/** Native fieldsets disable buttons; anchors also need navigation cancellation. */
export function blockBillingNavigation(event: SyntheticEvent): void {
  if (event.target instanceof Element && event.target.closest("a") !== null) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/** The profile stays real and visible; the original launcher keeps real sign-out. */
export function UnavailableBillingSection(props: AccountSectionProps & { unavailableReason: () => string }) {
  const reason = props.unavailableReason();
  return <fieldset className="dsh-account-billing-unavailable" disabled aria-disabled="true" title={reason}
    onClickCapture={blockBillingNavigation} onAuxClickCapture={blockBillingNavigation} onContextMenuCapture={blockBillingNavigation}
    onKeyDownCapture={(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") blockBillingNavigation(event); }}>
    <AccountSection {...props}
      useAccount={selector => props.useAccount(snapshot => selector({ ...snapshot, details: { ...snapshot.details, balance: { status: "failed" } } }))}
      t={(key, values) => key === "balanceUnavailable" ? reason : props.t(key, values)} />
  </fieldset>;
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    let original: StoredEntry | undefined;
    let dispose: (() => void) | undefined;
    const sync = () => {
      const next = ctx.slots.entries("settings.section").find(entry => entry.component === AccountSection);
      if (next === original) return;
      dispose?.(); dispose = undefined; original = next;
      if (next === undefined) return;
      dispose = ctx.slots.register({
        name: "settings.section", ...next.options, priority: -1, locale: "settings.account",
        inject: (...args: never[]) => ({ ...next.inject?.(...args), unavailableReason: () => billingUnavailableReason(ctx.locale.getSnapshot().active) }),
      } as never, UnavailableBillingSection as never);
    };
    const unsubscribe = ctx.slots.subscribe("settings.section", sync);
    sync();
    return () => { unsubscribe(); dispose?.(); };
  }, "account availability: official billing controls without a billing service");
}
