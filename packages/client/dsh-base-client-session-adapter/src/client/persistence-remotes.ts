/** Durable Host outcomes for official credential and message-feedback clients. */
import { deleteMessageFeedback, listMessageFeedback, putMessageFeedback, type FeedbackTransport } from "./chat-feedback.ts";

type Failure = { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: unknown } };
const unavailable = (domain: string): Failure => ({ ok: false, error: {
  code: `${domain}/unavailable`, message: "The Host transport is unavailable.", details: {},
} });

function rejected(domain: string, error: unknown): Failure {
  const failure = error as { code?: unknown; message?: unknown; details?: unknown } | undefined;
  return { ok: false, error: {
    code: typeof failure?.code === "string" ? failure.code : `${domain}/rejected`,
    message: typeof failure?.message === "string" ? failure.message : "The Host request failed.",
    details: failure?.details ?? {},
  } };
}

/** Secrets remain Host-owned; an absent or failed carrier never reports success. */
export function createCredentialsRemote(transport?: FeedbackTransport) {
  return {
    describe: async (refs: readonly string[] = []) => {
      if (transport === undefined) return unavailable("credential");
      try {
        const value = await transport.request("credentialsDescribe", { refs }) as {
          entries: Record<string, { configured: boolean; writable: boolean; source?: string }>;
        };
        if (value.entries === undefined) throw new Error("The Host returned an invalid credential description.");
        return { ok: true as const, value: value.entries };
      } catch (error) { return rejected("credential", error); }
    },
    set: async (ref: string, value: string) => {
      if (transport === undefined) return unavailable("credential");
      try {
        await transport.request("credentialsSet", { ref, value });
        return { ok: true as const, value: { configured: true, writable: true } };
      } catch (error) { return rejected("credential", error); }
    },
    unset: async (ref: string) => {
      if (transport === undefined) return unavailable("credential");
      try {
        await transport.request("credentialsUnset", { ref });
        return { ok: true as const, value: undefined };
      } catch (error) { return rejected("credential", error); }
    },
  };
}

/** The official feedback controller receives durable writes and honest failures. */
export function createMessageFeedbackRemote(transport?: FeedbackTransport) {
  return {
    list: async ({ sessionId }: { sessionId: string }) => {
      if (transport === undefined) return unavailable("message-feedback");
      try { return { ok: true as const, value: { ok: true as const, value: { items: await listMessageFeedback(transport, sessionId) } } }; }
      catch (error) { return rejected("message-feedback", error); }
    },
    put: async (input: Parameters<typeof putMessageFeedback>[1]) => {
      if (transport === undefined) return unavailable("message-feedback");
      try { return { ok: true as const, value: await putMessageFeedback(transport, input) }; }
      catch (error) { return rejected("message-feedback", error); }
    },
    delete: async (input: Parameters<typeof deleteMessageFeedback>[1]) => {
      if (transport === undefined) return unavailable("message-feedback");
      try { return { ok: true as const, value: await deleteMessageFeedback(transport, input) }; }
      catch (error) { return rejected("message-feedback", error); }
    },
  };
}
