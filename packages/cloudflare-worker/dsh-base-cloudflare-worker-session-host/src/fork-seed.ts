/** Exact official fork seeds; only the durable Think transcript is adapted. */
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork';
import { SessionSeq } from '@deepseek-ai/dsh-session/types';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import { assistantStepMessageSource, buildSessionHistory } from '@dsh-base/session-wire';
import type { SessionForkSeed, SessionWireRecord } from '@dsh-base/session-wire';
import type { SessionMessageRecord, SessionTurnState } from './storage.ts';
import { SessionRpcFault } from './remote-contract.ts';

const object = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null;

/** Preserve actual SDK values, replacing only results outside the inherited prefix. */
function inheritedMessages(source: readonly SessionMessageRecord[], seed: readonly SessionWireRecord[]): SessionMessageRecord[] {
  const users = new Set<string>();
  const steps = new Map<string, Set<number>>();
  const results = new Map<string, Record<string, any>>();
  for (const { event } of seed) {
    if (!object(event.data)) continue;
    if (event.type === 'user/message') users.add(String(event.data.id));
    if (event.type === 'assistant/message') {
      const identity = assistantStepMessageSource(String(event.data.message?.id));
      if (identity) {
        const included = steps.get(identity.messageId) ?? new Set<number>();
        included.add(identity.assistantStep);
        steps.set(identity.messageId, included);
      }
    }
    if (event.type === 'tool/result' && object(event.data.message)) results.set(String(event.data.message.toolCallId), event.data.message);
  }
  return source.flatMap(message => {
    if (message.role === 'user') return users.has(message.id) ? [message] : [];
    const included = steps.get(message.id);
    if (message.role !== 'assistant' || !included) return [];
    const groups: unknown[][] = [];
    let group: unknown[] = [];
    for (const part of message.parts) {
      if (object(part) && part.type === 'step-start') {
        if (group.length) groups.push(group);
        group = [];
      } else group.push(part);
    }
    if (group.length || groups.length === 0) groups.push(group);
    const complete = groups.every((_, index) => included.has(index));
    let changed = !complete;
    const mapPart = (part: unknown): unknown => {
      if (!object(part) || typeof part.toolCallId !== 'string' || typeof part.type !== 'string' || !(part.type.startsWith('tool-') || part.type === 'dynamic-tool')) return part;
      const result = results.get(part.toolCallId);
      if (!result) throw new SessionRpcFault('session/fork-unavailable', 'Fork seed has an unclosed tool call', {});
      // The official closer is evidence of a missing result, never permission
      // to replay an effect or inherit a later success from the source.
      if (String(result.id).startsWith('forked-tool-result-')) {
        changed = true;
        const { output: _output, approval: _approval, errorText: _error, ...call } = part;
        return { ...call, state: 'output-error', errorText: result.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n') };
      }
      return part;
    };
    const parts = groups.flatMap((parts, index) => included.has(index) ? [{ type: 'step-start' }, ...parts.map(mapPart)] : []);
    if (!changed) return [message];
    const provenance = message.parts.filter(part => object(part) && part.type === 'data-dsh-model-source');
    return [{ ...message, parts: [...parts.filter(part => !object(part) || part.type !== 'data-dsh-model-source'), ...provenance] }];
  });
}

/** Create a seed from an existing dense wire cursor, using the pinned official closer algorithm unchanged. */
export function prepareFork(input: {
  records: readonly SessionMessageRecord[];
  turns: readonly SessionTurnState[];
  forkSeed?: SessionForkSeed;
  atSeq?: number;
  messageId?: string;
  assistantStep?: number;
}): { seed: SessionForkSeed; messages: SessionMessageRecord[]; turns: SessionTurnState[] } {
  const journal = buildSessionHistory(input.records, undefined, input.turns, input.forkSeed);
  let boundary = input.atSeq;
  if (boundary === undefined && input.messageId !== undefined) {
    if (input.assistantStep !== undefined && (!Number.isSafeInteger(input.assistantStep) || input.assistantStep < 0)) throw new Error('invalid_assistant_step');
    const matches = journal.filter(({ event }) => {
      if (!object(event.data)) return false;
      if (event.type === 'user/message') return input.assistantStep === undefined && event.data.id === input.messageId;
      if (event.type !== 'assistant/message') return false;
      const identity = assistantStepMessageSource(String(event.data.message?.id));
      return identity !== undefined && identity.messageId === input.messageId && (input.assistantStep === undefined || identity.assistantStep === input.assistantStep);
    });
    const last = matches.at(-1);
    if (!last) throw new Error(input.assistantStep === undefined ? 'message not found' : 'invalid_assistant_step');
    const nextMessage = journal.find(row => row.event.seq > last.event.seq && ['assistant/message', 'user/message', 'turn/start', 'step/start'].includes(row.event.type));
    boundary = nextMessage ? nextMessage.event.seq - 1 : journal.at(-1)!.event.seq;
  }
  if (boundary === undefined) {
    const ended = journal.findLastIndex(row => row.event.type === 'turn/end');
    if (ended >= 0) {
      const nextTurn = journal.findIndex((row, index) => index > ended && (row.event.type === 'turn/start' || row.event.type === 'agent/inbox/spliced' || row.event.type === 'user/message' && row.event.surfaceOp === 'append'));
      boundary = journal[nextTurn < 0 ? journal.length - 1 : nextTurn - 1]!.event.seq;
    }
  }
  const index = boundary === undefined ? -1 : journal.findIndex(row => row.event.seq === boundary);
  if (index < 0) throw new SessionRpcFault('session/fork-unavailable', boundary === undefined ? 'Session has no completed turn to fork from' : `Fork event ${boundary} does not exist`, {});
  // The existing public wire starts at one. The official utility accepts a
  // zero-based contiguous log; normalize only at this pure adapter boundary.
  const zero = journal.map(({ event }, seq) => ({ ...event, seq: SessionSeq(seq),
    ...('sourceEventSeqs' in event ? { sourceEventSeqs: (event.sourceEventSeqs as number[]).map(value => value - 1) } : {}),
  })) as SessionEvent[];
  const records: SessionWireRecord[] = buildForkSeed(zero, SessionSeq(index)).map(event => {
    const { surfaceOp, ...rest } = event;
    if (surfaceOp !== undefined && surfaceOp !== 'append') throw new SessionRpcFault('session/fork-unavailable', 'Unsupported surface replacement in fork source', {});
    return { type: 'event', event: {
      ...rest, seq: Number(event.seq) + 1, ...(surfaceOp === undefined ? {} : { surfaceOp }),
      ...('sourceEventSeqs' in event ? { sourceEventSeqs: (event.sourceEventSeqs as number[]).map(seq => seq + 1) } : {}),
    } };
  });
  const messages = inheritedMessages(input.records, records);
  const copiedIds = new Set(messages.map(message => message.id));
  const ends = new Map<number, { reason: string; time: number }>();
  const turnByUser = new Map<string, number>();
  let turn = 0;
  for (const { event } of records) {
    const data = event.data as Record<string, any>;
    if (event.type === 'turn/start') turn = data.turn;
    if (event.type === 'user/message') turnByUser.set(data.id, turn);
    if (event.type === 'turn/end') ends.set(data.turn, { reason: data.reason.kind, time: event.time });
  }
  const turns = input.turns.filter(row => copiedIds.has(row.userMessageId)).map(row => {
    const end = ends.get(turnByUser.get(row.userMessageId)!);
    return end?.reason === 'forked' ? { ...row, status: 'forked' as const, endedAt: end.time } : row;
  });
  return { seed: { records, messageIds: messages.map(message => message.id) }, messages, turns };
}
