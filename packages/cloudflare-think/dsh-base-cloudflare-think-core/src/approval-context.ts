/** Durable, non-waking Think adapter for official approval-policy messages. */
interface Notice {
  readonly id: string;
  readonly role: 'user';
  readonly source: { readonly kind: 'user-approval' };
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
}
export interface ApprovalModelContext {
  readonly approval: 'ask' | 'never';
  readonly context: string;
  readonly notices: readonly Notice[];
}
interface StoredMessage { readonly id: string; readonly metadata?: unknown }
interface NoticeMessage {
  id: string; role: 'user'; parts: Array<{type:'text';text:string}>;
  metadata: {dshContext:true;kind:'approval-policy-notice';source:Notice['source']};
}
interface NoticeSession {
  getHistory(): Promise<StoredMessage[]>;
  getMessage(id: string): Promise<unknown | null>;
  appendMessage(message: NoticeMessage): Promise<unknown>;
}
// Private runtime-only provenance survives the installed SDK's prepareStep
// message reuse, but is neither serialized nor sent as provider metadata.
const NOTICE_ID = Symbol('dsh.approval-notice');
const CURRENT_POLICY = Symbol('dsh.approval-context');
type ModelContextMessage = {role:'user';content:string;[NOTICE_ID]?:string;[CURRENT_POLICY]?:true};
export function approvalNoticeIds(messages: readonly StoredMessage[]): Set<string> {
  return new Set(messages.filter(message => (message.metadata as {kind?:string}|undefined)?.kind === 'approval-policy-notice').map(message=>message.id));
}

/**
 * Session.appendMessage persists without calling chat/send/continue. Stable IDs
 * make a lost response/restart replay a no-op. The SDK builds its model baseline
 * before beforeTurn, then reuses returned messages across prepareStep calls.
 * Provenance removes only our previous current-value snapshot and identifies
 * already-inserted notices without guessing from their text. Restart uses the
 * persisted IDs present in the new SDK request's history baseline instead.
 */
export async function prepareApprovalContext(session: NoticeSession, input: unknown, baseline: ReadonlySet<string>, messages: readonly unknown[] = []): Promise<unknown[]> {
  const value = input as ApprovalModelContext | undefined;
  if (value === undefined) return [...messages]; // isolated hooks without owner transport
  if (value === null || typeof value !== 'object' || !['ask','never'].includes(value.approval) || typeof value.context !== 'string' || value.context === '' || !Array.isArray(value.notices)) throw new Error('Invalid approval model context');
  const ids = approvalNoticeIds(await session.getHistory());
  const retained=messages.filter(message=>(message as ModelContextMessage|null)?.[CURRENT_POLICY]!==true);
  const present=new Set(retained.map(message=>(message as ModelContextMessage|null)?.[NOTICE_ID]).filter(id=>id!==undefined));
  const pending: ModelContextMessage[] = [];
  const seen = new Set<string>();
  for (const notice of value.notices as readonly Notice[]) {
    if (notice === null || typeof notice !== 'object' || typeof notice.id !== 'string' || notice.id === '' || notice.role !== 'user' || notice.source?.kind !== 'user-approval'
      || !Array.isArray(notice.content) || notice.content.some((part: Notice['content'][number])=>part === null || part.type !== 'text' || typeof part.text !== 'string')) throw new Error('Invalid official approval notice');
    const id = `dsh-context:approval-notice:${notice.id}`;
    if (seen.has(id)) throw new Error('Duplicate approval notice id');
    seen.add(id);
    if (!ids.has(id)) {
      if (await session.getMessage(id) !== null) throw new Error('Approval notice exists outside the active Session history');
      await session.appendMessage({id,role:'user',parts:notice.content.map(part=>({...part})),metadata:{dshContext:true,kind:'approval-policy-notice',source:notice.source}});
      ids.add(id);
    }
    if (!baseline.has(id)&&!present.has(id)) pending.push({role:'user',content:notice.content.map(part=>part.text).join('\n'),[NOTICE_ID]:id});
  }
  // The complete latest value goes last, as in the official runtime context.
  return [...retained,...pending, {role:'user',content:value.context,[CURRENT_POLICY]:true}];
}
