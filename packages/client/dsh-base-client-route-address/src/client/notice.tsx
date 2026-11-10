/** Invalid deep-link notice rendered through the official shell overlay. */
import type { ReactNode } from "react";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { IconWarningOutlineRegular, Toast } from "@deepseek-ai/dsh-client-ui-primitives";
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { NS, type CopyKey } from "./locales.ts";

/** One notice presentation sequence. */
interface NoticeState { readonly seq: number }

/** Store and dismiss function shared by the address plugin and its overlay entry. */
export interface RouteNoticeSource {
  readonly hooks: { readonly toast: HostObservable<NoticeState | null> };
  readonly dismiss: () => void;
}

/** Create the one notice store the overlay entry shows. */
export function createRouteNotice(): RouteNoticeSource & { readonly report: () => void } {
  const store = createSnapshotStore<NoticeState | null>(null);
  let seq = 0;
  return {
    hooks: { toast: store },
    dismiss: () => { store.set(null); },
    report: () => { seq += 1; store.set({ seq }); },
  };
}

/** Overlay entry props: the notice store, dismissal, and localized copy. */
export type RouteNoticeProps = PropsRuntime<"shell.overlay">
  & PropsLocale<typeof NS>
  & InjectFace<RouteNoticeSource>;

/**
 * Render the invalid-address banner, if one is queued.
 * @param props - notice hook, dismissal, and locale seat.
 * @returns the banner or null.
 */
export function RouteNotice({ useToast, dismiss, t }: RouteNoticeProps): ReactNode {
  const notice = useToast(current => current);
  if (notice === null) return null;
  return <Toast key={`route-address-${String(notice.seq)}`} text={t("invalidAddress" as CopyKey)} icon={<IconWarningOutlineRegular />} onDone={dismiss} />;
}
