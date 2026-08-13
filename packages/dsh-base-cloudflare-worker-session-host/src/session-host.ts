/** Durable Object session host: DO SQL persistence behind a small JSON method surface. */
import { Context } from "@deepseek-ai/cordis";
import SessionStore from "@deepseek-ai/dsh-session";
import { SqliteSessionPersistence } from "./persistence/index.ts";
import { doSqlite, type DoSqlStorage } from "./sqlite.ts";

/** The subset of DurableObjectState this host owns (storage only). */
export interface SessionHostState {
  readonly storage: DoSqlStorage;
}

export interface SessionHostEnv {
  readonly DEEPSEEK_API_KEY?: string;
  readonly DEEPSEEK_BASE_URL?: string;
  /** Test seam: defaults to the platform fetch. */
  readonly fetch?: typeof fetch;
}

type Params = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

/** Durable Object class; one instance per session id (the caller routes by name). */
export class SessionHostObject {
  private readonly state: SessionHostState;
  private readonly env: SessionHostEnv;
  private ready: Promise<{ persistence: SqliteSessionPersistence; ctx: Context }> | undefined;

  constructor(state: SessionHostState, env: SessionHostEnv) {
    this.state = state;
    this.env = env;
  }

  private boot(): Promise<{ persistence: SqliteSessionPersistence; ctx: Context }> {
    this.ready ??= (async () => {
      const ctx = new Context();
      await (ctx.plugin(SessionStore as never) as unknown as Promise<unknown>);
      const persistence = new SqliteSessionPersistence(ctx, {}, doSqlite(this.state.storage));
      await persistence.ready;
      return { persistence, ctx };
    })();
    return this.ready;
  }

  async fetch(request: Request): Promise<Response> {
    const { persistence } = await this.boot();
    if (request.method !== "POST") return json({ error: { code: "method_not_allowed" } }, 405);
    let body: { method?: unknown; params?: unknown };
    try {
      body = await request.json() as { method?: unknown; params?: unknown };
    } catch {
      return json({ error: { code: "bad_request", message: "body must be JSON" } }, 400);
    }
    const method = text(body.method);
    const params = (typeof body.params === "object" && body.params !== null ? body.params : {}) as Params;
    try {
      switch (method) {
        case "create": {
          const sessionId = text(params.sessionId);
          if (sessionId === undefined) return json({ error: { code: "bad_request", message: "sessionId is required" } }, 400);
          await persistence.create({ version: 0, id: sessionId as never, createdAt: Date.now(), ...(text(params.cwd) !== undefined ? { cwd: text(params.cwd) } : {}) });
          return json({ result: { sessionId } });
        }
        case "append": {
          const sessionId = text(params.sessionId);
          if (sessionId === undefined) return json({ error: { code: "bad_request", message: "sessionId is required" } }, 400);
          const events = params.events;
          if (!Array.isArray(events) || events.length === 0) return json({ error: { code: "bad_request", message: "events is required" } }, 400);
          await persistence.append(sessionId as never, events as never);
          return json({ result: { sessionId, appended: events.length } });
        }
        case "list": {
          const sessions = await persistence.list();
          return json({ result: { sessions: sessions.map((row) => ({ sessionId: row.id, createdAt: row.createdAt, ...(row.cwd !== undefined ? { cwd: row.cwd } : {}) })) } });
        }
        case "state": {
          const sessionId = text(params.sessionId);
          if (sessionId === undefined) return json({ error: { code: "bad_request", message: "sessionId is required" } }, 400);
          const inspected = await persistence.inspect(sessionId as never);
          return json({ result: { sessionId, createdAt: inspected.meta.createdAt, events: inspected.events.length, lastSeq: inspected.events.at(-1)?.seq ?? -1 } });
        }
        case "page": {
          const sessionId = text(params.sessionId);
          if (sessionId === undefined) return json({ error: { code: "bad_request", message: "sessionId is required" } }, 400);
          const fromSeq = typeof params.fromSeq === "number" && Number.isSafeInteger(params.fromSeq) ? params.fromSeq : 0;
          const limit = typeof params.limit === "number" && Number.isSafeInteger(params.limit) ? Math.min(Math.max(params.limit, 1), 200) : 50;
          const read = await persistence.readFrom(sessionId as never, fromSeq);
          return json({ result: { sessionId, events: read.events.slice(0, limit), nextSeq: read.events.length > limit ? read.events[limit].seq : null } });
        }
        case "prompt": {
          const sessionId = text(params.sessionId);
          const prompt = text(params.text);
          if (sessionId === undefined || prompt === undefined) {
            return json({ error: { code: "bad_request", message: "sessionId and text are required" } }, 400);
          }
          const apiKey = text(this.env.DEEPSEEK_API_KEY);
          if (apiKey === undefined) {
            return json({ error: { code: "model_not_configured", message: "DEEPSEEK_API_KEY is not set on this deployment" } }, 501);
          }
          const inspected = await persistence.inspect(sessionId as never);
          const messages = promptMessages(inspected.events, prompt);
          const requestId = crypto.randomUUID();
          const turn = nextTurn(inspected.events);
          const user = userEvent(inspected.events, prompt);
          await persistence.append(sessionId as never, [
            { type: "turn/start", seq: user.seq, time: Date.now(), data: { turn } },
            user.event,
          ] as never);
          const transport = this.env.fetch ?? fetch;
          let answer: { text: string; model: string };
          try {
            answer = await callModel(transport, this.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com", apiKey, messages);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const seq = user.seq + 2;
            await persistence.append(sessionId as never, [
              { type: "turn/end", seq, time: Date.now(), data: { turn, reason: { kind: "error", error: { code: "model_error", message } } } },
            ] as never);
            return json({ error: { code: "model_error", message } }, 502);
          }
          const baseSeq = user.seq + 2;
          const now = Date.now();
          const assistant = {
            type: "assistant/message",
            seq: baseSeq + 1,
            time: now,
            data: {
              turn,
              step: 1,
              message: { id: `${requestId}-assistant`, role: "assistant", content: [{ type: "text", text: answer.text }], source: { kind: "model", provider: "deepseek", model: answer.model } },
            },
            surfaceOp: "append",
          };
          await persistence.append(sessionId as never, [
            { type: "step/start", seq: baseSeq, time: now, data: { turn, step: 1 } },
            assistant,
            { type: "step/end", seq: baseSeq + 2, time: now, data: { turn, step: 1 } },
            { type: "turn/end", seq: baseSeq + 3, time: now, data: { turn, reason: { kind: "completed" } } },
          ] as never);
          return json({ result: { sessionId, requestId, turn, text: answer.text, model: answer.model } });
        }
        default:
          return json({ error: { code: "method_not_found", message: `unknown method: ${String(body.method)}` } }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: { code: "session_host_error", message } }, 400);
    }
  }
}

/** Next turn number for the session. */
function nextTurn(events: readonly { type: string; data: unknown }[]): number {
  let turn = 0;
  for (const event of events) {
    if (event.type !== "turn/start") continue;
    const data = event.data as { turn?: unknown };
    if (typeof data.turn === "number") turn = Math.max(turn, data.turn);
  }
  return turn + 1;
}

/** Append one user message event with the next contiguous seq. */
function userEvent(events: readonly { type: string; seq: number }[], prompt: string): { seq: number; event: unknown } {
  const seq = (events.at(-1)?.seq ?? -1) + 1;
  return {
    seq,
    event: {
      type: "user/message",
      seq: seq + 1,
      time: Date.now(),
      data: { id: crypto.randomUUID(), role: "user", content: [{ type: "text", text: prompt }], source: { kind: "user" } },
      surfaceOp: "append",
    },
  };
}

/** Project the stored user messages into the provider's chat shape. */
function promptMessages(events: readonly { type: string; data: unknown }[], prompt: string): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [];
  for (const event of events) {
    if (event.type !== "user/message") continue;
    const data = event.data as { content?: { type: string; text?: string }[] };
    const text = data.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";
    if (text.length > 0) messages.push({ role: "user", content: text });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

/** One real provider call through the deployment's API key. */
async function callModel(
  transport: typeof fetch,
  baseUrl: string,
  apiKey: string,
  messages: { role: string; content: string }[],
): Promise<{ text: string; model: string }> {
  const response = await transport(`${baseUrl.replace(/\/$/u, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "deepseek-chat", messages, stream: false }),
  });
  if (!response.ok) throw new Error(`provider returned HTTP ${response.status}`);
  const body = await response.json() as { model?: unknown; choices?: { message?: { content?: unknown } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) throw new Error("provider returned no assistant text");
  return { text, model: typeof body.model === "string" && body.model.length > 0 ? body.model : "deepseek-chat" };
}
