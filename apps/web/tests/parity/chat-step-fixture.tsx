/** Actual pinned Chat definitions and React renderers, driven by native/reference or shared journals. */
import React, { useMemo, useState } from 'react';
import { Context } from '@deepseek-ai/cordis';
import { ConversationNodeAssembler, ConversationEventRegistry, ConversationViewRegistry } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { registerConversationNodes } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/register.ts';
import { AssistantNodeView } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/AssistantNodeView.tsx';
import { TurnProcessNodeView } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/TurnProcessNodeView.tsx';
import * as copy from '@deepseek-ai/dsh-client-ui-chat/src/client/locale.ts';
import { SessionWireSequencer, buildSessionHistory } from '../../../../packages/boot/dsh-base-session-wire/src/index.ts';

const user = { id: 'request', role: 'user', parts: [{ type: 'text', text: 'Fetch then answer' }] };
const tool = { type: 'tool-fetch_url', toolCallId: 'call', input: { url: 'https://example.invalid' }, state: 'approval-requested' };
const source = { type: 'data-dsh-model-source', data: { provider: 'deepseek-official', model: 'deepseek-reasoner' } };
const pending = { id: 'sdk-multi-step', role: 'assistant', parts: [{ type: 'step-start' }, { type: 'text', text: 'Fetching the page.' }, tool, source] };
const complete = { ...pending, parts: [{ type: 'step-start' }, { type: 'text', text: 'Fetching the page.' }, { ...tool, state: 'output-available', output: 'Page title' }, { type: 'step-start' }, { type: 'text', text: 'Final answer: Page title.' }, source] };
const lifecycle = (finished: boolean) => [{ requestId: user.id, status: finished ? 'completed' as const : 'awaiting-approval' as const, startedAt: 1000, ...(finished ? { endedAt: 5000 } : {}) }];
const message = (id: string, content: unknown[]) => ({ id, role: 'assistant', content, source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-reasoner' } });
// Native official journal protocol: a fresh assistant Message identity per Step.
function reference(finished: boolean): any[] {
  const rows: Array<[string, unknown, boolean?]> = [
    ['turn/start', { turn: 1 }], ['step/start', { turn: 1, step: 1 }],
    ['user/message', { id: user.id, role: 'user', content: [{ type: 'text', text: 'Fetch then answer' }], source: { kind: 'user', rpcId: user.id } }, true],
    ['assistant/message', { turn: 1, step: 1, stream: [], message: message('native-step-one', [{ type: 'text', text: 'Fetching the page.' }, { type: 'tool-call', id: 'call', name: 'fetch_url', arguments: '{"url":"https://example.invalid"}' }]) }, true],
    ['tool/call', { turn: 1, step: 1, callId: 'call', name: 'fetch_url', arguments: '{"url":"https://example.invalid"}' }],
  ];
  if (finished) rows.push(
    ['tool/result', { turn: 1, step: 1, message: { id: 'tool-result-call', role: 'tool', toolCallId: 'call', source: { kind: 'tool', callId: 'call' }, content: [{ type: 'text', text: 'Page title' }] } }, true],
    ['step/end', { turn: 1, step: 1 }], ['step/start', { turn: 1, step: 2 }],
    ['assistant/message', { turn: 1, step: 2, stream: [], message: message('native-step-two', [{ type: 'text', text: 'Final answer: Page title.' }]) }, true],
    ['step/end', { turn: 1, step: 2 }], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  );
  return rows.map(([type, data, append], i) => ({ type: 'event', event: { type, seq: i + 1, time: type === 'turn/end' ? 5000 : 1000, data, ...(append ? { surfaceOp: 'append' } : {}) } }));
}
function assembler() {
  const ctx = new Context(), events = new ConversationEventRegistry(ctx), views = new ConversationViewRegistry(ctx);
  registerConversationNodes({ uiConversation: { events, views, groups: { register: () => () => {} } } } as never);
  const result = new ConversationNodeAssembler(events, views); result.activateTarget('chat'); return result;
}
const presentation = { foldedReplies: 'all', mode: 'standard', settledReasoningPreview: true };
const contextMenu = { getTriggerProps: () => ({}) };
const no = () => {};
export function ChatStepFixture({ locale, adapted }: { locale: 'en' | 'zh'; adapted: boolean }) {
  const fixture = useMemo(() => {
    const journal = new SessionWireSequencer([user, pending], { turns: lifecycle(false) });
    const model = assembler(); model.replaceWindow((adapted ? journal.records : reference(false)) as never, false); model.flush();
    return { model, journal, finished: false, records: adapted ? journal.records : reference(false) };
  }, [adapted]);
  const [revision, setRevision] = useState(0), [open, setOpen] = useState(true);
  const snapshot: any = fixture.model.snapshot('chat');
  const t = useMemo(() => (key: string, values: Record<string, unknown> = {}) => String((copy[locale] as any)[key] ?? key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? '')), [locale]);
  const refresh = () => { fixture.model.flush(); setRevision(value => value + 1); };
  (window as any).__CHAT_STEP__ = {
    advance() {
      const rows = adapted ? fixture.journal.pushMessages([user, complete], lifecycle(true)) : reference(true).slice(fixture.records.length);
      for (const row of rows) fixture.model.append(row as never);
      fixture.finished = true; fixture.records = adapted ? fixture.journal.records : reference(true); refresh();
    },
    replay() { const rows = adapted ? fixture.journal.pushMessages([user, complete], lifecycle(true)) : []; if (rows.length) throw new Error('replay appended duplicate events'); refresh(); },
    reload() { fixture.model = assembler(); fixture.records = adapted ? buildSessionHistory([user, complete], undefined, lifecycle(true)) : reference(true); fixture.model.replaceWindow(fixture.records as never, false); refresh(); },
    read() { const value: any = fixture.model.snapshot('chat'); return { finished: fixture.finished, records: fixture.records, nodes: value.nodes.values().map((node: any) => ({ key: node.key, kind: node.kind, id: node.data.finalNode?.messageId })), turns: value.timeline.turnOrder }; },
  };
  const nodes = snapshot.nodes.values().filter((node: any) => node.kind === 'assistant-step' || node.kind === 'turn-process');
  return <section data-chat-step-fixture data-revision={revision} style={{ width: 680, padding: 24 }}>
    {nodes.map((node: any) => {
      const process = snapshot.nodes.processSource(node.key).getSnapshot();
      const turnProcess = process && { spec: process.spec, hasContent: true, foldable: true, open, setOpen };
      const props: any = { node, turnProcess, t, sessionId: 'fixture', useTurnData: (key: string) => node.location.turn?.data.get(key), useDisclosure: () => ({ open: true, setOpen: no }), useGroupAction: () => undefined, usePresentation: (selector: any) => selector(presentation), openFile: no, loadImage: no, fileMentions: () => undefined, resolveFilePath: (path: string) => path, useContextMenu: () => contextMenu, renderSlot: () => null };
      return <div key={node.key} data-node-kind={node.kind}>{node.kind === 'assistant-step' ? <AssistantNodeView {...props} /> : <TurnProcessNodeView {...props} />}</div>;
    })}
  </section>;
}
