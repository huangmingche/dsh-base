/** Address restoration joins the official latest-navigation-wins contract. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@dsh-base/client-session-adapter/navigation-access";
import { mirroredAddress, parseAddress, sessionPath, type Address } from "./routes.ts";

interface Observable { subscribe(listener: () => void): () => void }
interface Navigation {
  readonly cancel: AbortController;
  phase: "waiting" | "resolving" | "opening";
  /** Set by the official Workspace beforeOpen callback, before its selection commits. */
  expectedSession?: string;
}

/** Retention updates can briefly contain both references; read after the synchronous handoff. */
function selected(ctx: Context): string | undefined {
  return Object.values(ctx.sessions.list.getSnapshot().byId)
    .find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id;
}

/** Wait on the real stores; cancellation releases subscriptions and the timeout immediately. */
function waitFor(sources: readonly Observable[], predicate: () => boolean, signal: AbortSignal, timeout: number, onReady?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const stops: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (error?: unknown): void => {
      if (done) return;
      done = true;
      stops.forEach(stop => stop());
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      if (error === undefined) resolve(); else reject(error);
    };
    const aborted = (): void => finish(signal.reason);
    const check = (): void => {
      if (done || !predicate()) return;
      finish();
      onReady?.();
    };
    if (signal.aborted) { finish(signal.reason); return; }
    signal.addEventListener("abort", aborted, { once: true });
    for (const source of sources) stops.push(source.subscribe(check));
    timer = setTimeout(() => finish(new Error("address target did not become ready")), timeout);
    check();
  });
}

/** Install one browser history owner; no private reads occur before checked authentication. */
export function installAddressNavigation(ctx: Context, report: () => void): () => void {
  if (typeof window === "undefined" || typeof location === "undefined") return () => {};
  const allowed = (): boolean => ctx.navigationAccess.getSnapshot() === "authenticated";
  const ready = (): boolean => ctx.sessions.list.getSnapshot().phase === "ready"
    && ctx.workspaces.list.getSnapshot().phase === "ready";
  const panelOpen = (): boolean => ctx.layout.panelInfo.getSnapshot().activePanelId !== null;
  let disposed = false;
  let booted = panelOpen();
  let active: Navigation | undefined;
  let lastSession = selected(ctx);
  let queued = false;

  const write = (path: string, mode: "push" | "replace"): void => {
    const next = mirroredAddress(path, location.pathname, location.search, location.hash);
    if (`${location.pathname}${location.search}${location.hash}` === next) return;
    try { history[mode === "push" ? "pushState" : "replaceState"]({ dshAddress: true }, "", next); }
    catch { /* Sandboxed history restrictions do not disable official in-memory navigation. */ }
  };
  const mirror = (mode: "push" | "replace"): void => {
    if (disposed || !allowed() || !booted || active !== undefined || panelOpen()) return;
    const id = selected(ctx);
    if (id !== undefined) write(sessionPath(id), mode);
  };
  const cancel = (): void => {
    const previous = active;
    active = undefined;
    previous?.cancel.abort();
  };
  const current = (operation: Navigation): boolean => !disposed && allowed()
    && active === operation && !operation.cancel.signal.aborted;
  const finish = (operation: Navigation, mirrorSelection: boolean): void => {
    if (active !== operation) return;
    active = undefined;
    booted = true;
    lastSession = selected(ctx);
    if (mirrorSelection) mirror("replace");
  };

  const navigate = async (address: Address, initial: boolean): Promise<void> => {
    cancel();
    if (!allowed() || disposed) return;
    // Home supplies no navigation target. The official shell alone owns its
    // saved/default Workspace restoration, including an acquisition already in flight.
    if (initial && address.kind === "home") {
      booted = true;
      mirror("replace");
      return;
    }
    const operation: Navigation = { cancel: new AbortController(), phase: "waiting" };
    active = operation;
    let navigation: AbortSignal | undefined;
    const superseded = (): void => {
      if (active !== operation || operation.phase === "opening") return;
      // The official startup subscriber can reserve a blank acquisition in the
      // same synchronous catalog notification that makes both stores ready. Our
      // ready callback takes over immediately below, before another user event.
      if (operation.phase === "waiting" && ready()) return;
      cancel();
      booted = true;
      queueMicrotask(() => mirror("push"));
    };
    const open = async (): Promise<void> => {
      if (!current(operation) || navigation === undefined || navigation.aborted || (initial && panelOpen())) return;
      const signal = AbortSignal.any([operation.cancel.signal, navigation]);
      if (address.kind === "session") {
        const known = (): boolean => Object.hasOwn(ctx.sessions.list.getSnapshot().byId, address.id);
        if (!known()) {
          void ctx.sessions.refresh().catch(() => undefined);
          await waitFor([ctx.sessions.list], known, signal, 8_000);
        }
        if (!current(operation) || signal.aborted) return;
        // openSession is a synchronous official navigation. Its own selectPanel(null)
        // aborts our reservation; that is the successful handoff, not a reason to retry.
        operation.phase = "opening";
        operation.expectedSession = address.id;
        ctx.uiWorkspace.openSession(address.id as never);
        finish(operation, true);
      } else if (address.kind === "workspace") {
        const known = ctx.workspaces.list.getSnapshot().items.some(row => row.workspaceId === address.id);
        if (!known) throw new Error("workspace address is not in the host list");
        operation.phase = "opening";
        // The official method owns cancellation once dispatched. beforeOpen runs only
        // for the winning navigation; a cancelled acquisition must never be retried.
        await ctx.uiWorkspace.openWorkspace(address.id as never, id => {
          operation.cancel.signal.throwIfAborted();
          operation.expectedSession = id;
        });
        if (current(operation)) finish(operation, operation.expectedSession !== undefined);
      } else {
        // The official New Session action owns its asynchronous Workspace selection.
        // Address mirroring resumes immediately; no delayed URL replay can reopen it.
        finish(operation, false);
        ctx.uiWorkspace.startSession();
      }
    };
    try {
      // Reserve while waiting too: a user can choose a Workspace as soon as its
      // catalog is ready even if the Session catalog is still loading.
      navigation = ctx.layout.beginNavigation();
      navigation.addEventListener("abort", superseded, { once: true });
      let opening: Promise<void> | undefined;
      await waitFor([ctx.sessions.list, ctx.workspaces.list], ready, operation.cancel.signal, 20_000, () => {
        if (!current(operation) || (initial && panelOpen())) return;
        // Reserve synchronously so a newer user navigation can cancel us. Only the
        // actual Session retain is deferred: ready may be notified reentrantly from
        // the official saved-Session retain/release handoff, which must finish first.
        navigation?.removeEventListener("abort", superseded);
        navigation = ctx.layout.beginNavigation();
        operation.phase = "resolving";
        navigation.addEventListener("abort", superseded, { once: true });
        opening = Promise.resolve().then(open);
      });
      await opening;
    } catch {
      // Superseded requests (including late Host failures) are intentionally silent.
      if (current(operation) && navigation?.aborted !== true) {
        report();
        write("/", "replace");
      }
    } finally {
      navigation?.removeEventListener("abort", superseded);
      finish(operation, false);
    }
  };

  const onSessions = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
      const id = selected(ctx);
      if (id === lastSession) return;
      lastSession = id;
      if (active?.phase === "opening" && id !== active.expectedSession) {
        cancel();
        booted = true;
      }
      mirror("push");
    });
  };
  const onPanel = (): void => {
    if (!panelOpen()) return;
    cancel();
    booted = true;
  };
  const boot = (): void => {
    if (!booted && active === undefined && allowed()) void navigate(parseAddress(location.pathname), true);
  };
  const onPopState = (): void => {
    // A history traversal is itself a newer intent, including while signed out.
    cancel();
    if (allowed()) void navigate(parseAddress(location.pathname), false);
    else booted = false;
  };
  const stopSessions = ctx.sessions.list.subscribe(onSessions);
  const stopPanel = ctx.layout.panelInfo.subscribe(onPanel);
  const stopAccess = ctx.navigationAccess.subscribe(() => {
    if (!allowed()) { cancel(); booted = false; }
    else boot();
  });
  window.addEventListener("popstate", onPopState);
  boot();
  return () => {
    disposed = true;
    cancel();
    stopSessions(); stopPanel(); stopAccess();
    window.removeEventListener("popstate", onPopState);
  };
}
