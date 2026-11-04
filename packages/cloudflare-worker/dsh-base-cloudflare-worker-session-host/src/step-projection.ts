import { providerForModelId } from '../../../boot/dsh-base-session-wire/src/model-routes.ts';
interface Message { readonly id: string; readonly role: string; readonly parts: readonly unknown[]; readonly metadata?: Record<string, unknown> }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

/** Expand actual SDK step evidence; retain later approval state from the owning UIMessage. */
export function projectModelSteps<T extends Message>(messages: readonly T[]): T[] {
  const output: T[] = [];
  let turn: T[] = [];
  const flush = () => { output.push(...projectTurn(turn)); turn = []; };
  for (const message of messages) {
    if (message.role === 'user' && message.metadata?.dshContext !== true) flush();
    turn.push(message);
  }
  flush();
  return output;
}

function projectTurn<T extends Message>(messages: readonly T[]): T[] {
  // Think can carry previousSteps into a new continuation UIMessage. The real
  // tool result may remain in the original UIMessage, so join by call identity
  // across this user Turn before expanding or deduplicating Step identities.
  const tools = new Map<string, Record<string, unknown>>();
  for (const message of messages) if (message.role === 'assistant') for (const part of message.parts) {
    if (!object(part) || typeof part.toolCallId !== 'string') continue;
    const previous = tools.get(part.toolCallId);
    if (previous === undefined || toolPhase(part) >= toolPhase(previous)) tools.set(part.toolCallId, part);
  }
  const output: T[] = [], positions = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.metadata?.dshSteps) || message.metadata.dshSteps.length === 0) { output.push(message); continue; }
    const steps = message.metadata.dshSteps.filter(object);
    if (steps.some(step => typeof step.id !== 'string' || !Array.isArray(step.parts))) throw new Error('invalid_model_step_evidence');
    for (const step of steps) {
      const id = `dsh-sdk-step:${step.id}`;
      const projected = { ...message, id, parts: [
        ...(step.parts as unknown[]).map(part => object(part) && typeof part.toolCallId === 'string' ? tools.get(part.toolCallId) ?? part : part),
        { type: 'data-dsh-step', data: { ...step, parts: undefined } },
        { type: 'data-dsh-model-source', data: { provider: providerForModelId(String(step.requestedModel)), model: typeof step.responseModel === 'string' ? step.responseModel : 'unknown', requestedModel: step.requestedModel,
          ...(step.reasoningEffort === undefined ? {} : { reasoningEffort: step.reasoningEffort }) } },
      ] } as T;
      const position = positions.get(id);
      if (position === undefined) { positions.set(id, output.length); output.push(projected); }
      else output[position] = projected;
    }
  }
  return output;
}

function toolPhase(part: Record<string, unknown>): number {
  return ['output-available','output-error','output-denied'].includes(String(part.state)) ? 4
    : part.state === 'approval-responded' ? 3 : part.state === 'approval-requested' ? 2 : 1;
}
