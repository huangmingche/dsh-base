/** Real pinned Session references exercise the fork's ownership cancellation. */
import React from "react";
import { Context } from "@deepseek-ai/cordis";
import { RemoteStream, type RemoteStreamOptions } from "@deepseek-ai/dsh-api-gateway/client";
import { SessionId, SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session/types";
import { ClientSessions } from "@deepseek-ai/dsh-api-session-controller/src/client/sessions/service.ts";
import { SidebarSessionView as OfficialView } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/session-view.ts";
import { SidebarSessionView as AdaptedView } from "../../../../packages/client/dsh-base-client-sidebar-right/src/client/session-view.ts";
import { SidebarSessionViews } from "../../../../packages/client/dsh-base-client-sidebar-right/src/client/session-views.ts";

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function bench() {
  const ctx = new Context();
  const gates = new Map<string, { resolve: () => void; reject: (reason: unknown) => void }>();
  const ids = [SessionId("first"), SessionId("second")];
  const remote = { $stream: <T,>(options: RemoteStreamOptions<T>) => new RemoteStream<T>({ generation: { getSnapshot: () => undefined, subscribe: () => () => {} } }, options), session: {
    list: async () => ({ ok: true, value: { items: ids.map(sessionId => ({ sessionId, updatedAt: 1, running: false, blank: true, agentAvailable: true })) } }),
    follow: async function* (request: { address: { sessionId: string } }, signal: AbortSignal) {
      const id = request.address.sessionId;
      await new Promise<void>((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        signal.addEventListener("abort", aborted, { once: true });
        gates.set(id, { resolve: () => { signal.removeEventListener("abort", aborted); resolve(); }, reject: error => { signal.removeEventListener("abort", aborted); reject(error); } });
        if (signal.aborted) aborted();
      });
      yield { type: "snapshot", header: { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false }, cursor: -1, records: [], hasMore: false, projections: { asOfSeq: -1, values: {} }, assistantStream: { revision: 0 } };
      await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
    },
  } } as unknown as ConstructorParameters<typeof ClientSessions>[1];
  const sessions = new ClientSessions(ctx, remote);
  await sessions.refresh();
  const entered = async (id: string) => { for (let i = 0; i < 50 && !gates.has(id); i++) await pause();check(gates.has(id), "real Session follow did not open");return gates.get(id)!; };
  return { ctx, sessions, ids, gates, entered };
}
async function verify() {
  const messages: string[] = [], previous = console.error;
  console.error = (...args) => { messages.push(args.map(String).join(" ")); };
  const cases = [];
  try {
    for (const [label, View, expected] of [["official-pending-cancellation", OfficialView, 1], ["adapted-pending-cancellation", AdaptedView, 0]] as const) {
      const b = await bench();const start = messages.length;
      const view = new View(b.ids[0], b.sessions, () => {}, () => {});
      await b.entered(b.ids[0]);view.dispose();view.dispose();
      let rejected = false;try { await view.reference.ready; } catch { rejected = true; }
      await pause();check(rejected, "cancellation must reject the actual reference, not simulate readiness");
      check(messages.slice(start).filter(text => text.startsWith("Sidebar Session opening failed:")).length === expected, `${label}: unexpected opening diagnostics`);
      check(b.sessions.retainInfo(b.ids[0]).getSnapshot().referenceCount === 0, "disposed view leaked a reference");
      await b.ctx.fiber.dispose();cases.push({ label, referenceRejected: true, openingErrors: expected, retained: 0 });
    }
    {
      const b = await bench(), start = messages.length;
      const views = new SidebarSessionViews(b.sessions);views.select(b.ids[0]);await b.entered(b.ids[0]);views.select(b.ids[1]);
      (await b.entered(b.ids[1])).resolve();await views.source.getSnapshot()[0]!.reference.ready;
      await pause();check(messages.length === start, "switching away from a pending view reported cancellation as failure");
      check(b.sessions.retainInfo(b.ids[0]).getSnapshot().referenceCount === 0, "old view reference survived selection");
      check(b.sessions.retainInfo(b.ids[1]).getSnapshot().referenceCount === 1, "selected view lost its actual reference");
      views.dispose();await b.ctx.fiber.dispose();cases.push({ label: "pending-to-ready-switch", openingErrors: 0, nextReferenceOpened: true });
    }
    {
      const b = await bench(), start = messages.length;
      const view = new AdaptedView(b.ids[0], b.sessions, () => {}, () => {});
      (await b.entered(b.ids[0])).reject(new Error("genuine Host opening failure"));
      // The official controller resolves a binding for a typed Host refusal;
      // its error state must remain observable rather than inventing readiness.
      const binding = await view.reference.ready;
      check(binding.session.getSnapshot().openState === "error", "real Host failure lost the official Session error state");
      check(String(binding.session.getSnapshot().openError?.message).includes("genuine Host opening failure"), "Host failure detail was lost");
      view.dispose();await b.ctx.fiber.dispose();cases.push({ label: "active-host-failure", officialErrorStatePreserved: true });
    }
    {
      const b = await bench(), start = messages.length;
      const view = new AdaptedView(b.ids[0], b.sessions, () => {}, () => {});
      await b.entered(b.ids[0]);view.reference.release();
      let rejected = false;try { await view.reference.ready; } catch { rejected = true; }
      await pause();check(rejected, "unexpected live reference failure must reject ready");
      check(messages.slice(start).some(text => text.startsWith("Sidebar Session opening failed:") && text.includes("is released")), "active reference failure was hidden");
      view.dispose();await b.ctx.fiber.dispose();cases.push({ label: "active-reference-failure", referenceRejected: true, openingErrorPreserved: true });
    }
    return { ok: true, cases };
  } finally { console.error = previous; }
}
export function SidebarLifecycleFixture() {
  React.useEffect(() => { void verify().then(result => { (window as any).__SIDEBAR_LIFECYCLE__ = result; }, error => { (window as any).__SIDEBAR_LIFECYCLE__ = { ok: false, error: String(error?.stack ?? error) }; }); }, []);
  return <p>Official Session reference lifecycle regression</p>;
}
