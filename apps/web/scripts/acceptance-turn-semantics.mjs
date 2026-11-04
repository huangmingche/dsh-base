/**
 * Official turn semantics, read from the real session/page and rendered process.
 * Source: pinned core/agent-loop/src/agent.ts opens one turn, loops over steps,
 * and closes the turn after the loop. ui-chat/TurnProcessNodeView.tsx publishes
 * one button[data-turn-process] per closed turn. Tool/approval continuation is
 * another step of the same user turn, never another synthetic turn.
 */
import assert from 'node:assert/strict';
import { assistantStepMessageSource } from '../../../packages/boot/dsh-base-session-wire/src/index.ts';

async function officialSessionRead({ base, cookie }, method, request) {
  const rpcId = `turn-semantics-${crypto.randomUUID()}`;
  const response = await fetch(`${base}/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: { request } } }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, 'official history HTTP status');
  assert.equal(body.type, 'server-response');assert.equal(body.rpcId, rpcId);
  assert.equal(body.result?.ok, true, 'official history must succeed');
  return body.result.value;
}

export const officialSessionPage = options => officialSessionRead(options, 'session/page', { address: { kind: 'session', sessionId: options.sessionId }, maxMessages: 100 });
export const officialSessionProjections = options => officialSessionRead(options, 'session/projections', { sessionId: options.sessionId });

export function assertStatsMatchJournal(projections, page) {
  assert.equal(page.hasMore, false, 'statistics comparison requires the complete isolated journal');
  const events = page.records.map(record => record.event).filter(Boolean);
  const expected = { turns: events.filter(event => event.type === 'turn/start').length, steps: events.filter(event => event.type === 'step/start').length };
  assert.equal(projections.values?.sessionStats?.turns, expected.turns, 'durable statistics count actual logical turns');
  assert.equal(projections.values?.sessionStats?.steps, expected.steps, 'durable statistics count actual model steps including continuation');
  return expected;
}

export async function assertVisibleSessionStats(page, expected, locale = 'en') {
  const label = locale === 'zh' ? `${expected.turns} 轮 ${expected.steps} 步` : `${expected.turns} turns ${expected.steps} steps`;
  await page.waitForFunction(text => document.querySelector('[data-composer-stat="activity"]')?.textContent.includes(text), { timeout: 30000 }, label);
}

const textOf = content => (content ?? []).filter(part => part.type === 'text').map(part => part.text).join('');

/** Tool-only Steps precede the final reply; never borrow another user's answer. */
export function findAssistantTextForPrompt(records, needle) {
  const start=records.findIndex(record=>record.role==='user' && textOf(record.parts).includes(needle));
  if(start<0)return undefined;
  for(const record of records.slice(start+1)) {
    if(record.role==='user')break;
    if(record.role!=='assistant')continue;
    const text=textOf(record.parts);
    if(text.trim())return {requestId:records[start].id,text};
  }
  return undefined;
}

export function assertUserTurnSemantics(page, { promptNeedle, toolName, expectedUserTurns, expectedModelSource }) {
  assert.equal(page.hasMore, false, 'the small isolated acceptance Session must fit in one complete official page');
  assert.ok(Array.isArray(page.records));
  const events = page.records.map(record => record.event).filter(Boolean);
  const turns = new Map();let active;
  const userMessages = [];
  for (const event of events) {
    if (event.type === 'turn/start') {
      assert.ok(Number.isSafeInteger(event.data.turn));
      assert.ok(!turns.has(event.data.turn), 'one start per turn identity');
      active = event.data.turn;turns.set(active, { start: event, ends: [], events: [] });
    }
    const turn = Number.isSafeInteger(event.data?.turn) ? event.data.turn : active;
    if (turns.has(turn)) turns.get(turn).events.push(event);
    if (event.type === 'user/message' && event.data.source?.kind === 'user') userMessages.push({ event, turn });
    if (event.type === 'turn/end') {
      assert.ok(turns.has(turn), 'a turn must start before it ends');
      turns.get(turn).ends.push(event);if (active === turn) active = undefined;
    }
  }
  assert.equal(userMessages.length, expectedUserTurns, 'exactly the expected real user requests exist');
  assert.equal(turns.size, expectedUserTurns, 'assistant/tool continuation must not create extra turns');
  for (const entry of turns.values()) {
    assert.equal(entry.ends.length, 1, 'each completed user turn has one final end');
    assert.equal(entry.ends[0].data.reason?.kind, 'completed', 'successful acceptance requests complete rather than fail or cancel');
  }
  const modelSources = events.filter(event => event.type === 'assistant/message').map(event => {
    const source = event.data.message?.source;
    assert.equal(source?.kind, 'model', 'assistant messages carry the official model source');
    if (expectedModelSource !== undefined) {
      assert.equal(source.provider, expectedModelSource.provider, 'assistant provenance identifies the provider actually used');
      if (expectedModelSource.model !== undefined) assert.equal(source.model, expectedModelSource.model, 'assistant provenance identifies the provider model actually used');
    }
    return { messageId: event.data.message.id, turn: event.data.turn, step: event.data.step, source };
  });
  const matches = userMessages.filter(({ event }) => textOf(event.data.content).includes(promptNeedle));
  assert.equal(matches.length, 1, 'the target user request is unique');
  const turn = matches[0].turn;const target = turns.get(turn);assert.ok(target, 'user input belongs to an opened turn');
  const stepStarts = target.events.filter(event => event.type === 'step/start');
  const steps = stepStarts.map(event => event.data.step);
  assert.ok(new Set(steps).size >= 2, 'tool continuation is multiple steps in one turn');
  assert.equal(new Set(steps).size, steps.length, 'each step starts once');
  const stepEnds = new Map();
  for (const start of stepStarts) {
    const ends = target.events.filter(event => event.type === 'step/end' && event.data.step === start.data.step);
    assert.equal(ends.length, 1, 'every completed step closes once');
    assert.ok(ends[0].seq > start.seq && ends[0].seq < target.ends[0].seq, 'step boundaries stay within their user turn');
    stepEnds.set(start.data.step, ends[0]);
  }
  const calls = target.events.filter(event => event.type === 'tool/call' && event.data.name === toolName);
  assert.ok(calls.length >= 1, `the expected ${toolName} call belongs to this turn`);
  for (const call of calls) assert.ok(typeof call.data.callId === 'string' && call.data.callId !== '', 'tool calls have an official call identity');
  assert.equal(new Set(calls.map(event => event.data.callId)).size, calls.length, 'tool calls are not replayed twice');
  const results = calls.map(call => {
    // SessionEventMap['tool/result'] carries its identity on the embedded
    // ToolResultMessage, not on event.data. Session validates the matching
    // source.callId too (core/session/src/types.ts and src/index.ts).
    const matches = events.filter(event => event.type === 'tool/result' && event.data.message?.toolCallId === call.data.callId);
    assert.equal(matches.length, 1, 'every actual tool call has exactly one result');const result = matches[0];
    assert.equal(result.data.message.role, 'tool', 'the result is an official ToolResultMessage');
    assert.equal(result.data.message.source?.kind, 'tool', 'the result has the official tool source');
    assert.equal(result.data.message.source.callId, call.data.callId, 'tool result identity matches its source');
    assert.notEqual(result.data.message.isError, true, 'the expected successful tool call must not return an error');
    assert.equal(result.data.turn, turn, 'tool results keep their original user turn');
    assert.equal(result.data.step, call.data.step, 'tool results keep their original calling step');
    assert.ok(result.seq > call.seq, 'tool result follows its call');
    assert.ok(stepEnds.get(call.data.step)?.seq > result.seq, 'the calling step cannot close before its tool result');
    return result;
  });
  const lastResult = [...results].sort((left, right) => left.seq - right.seq).at(-1);
  const replies = target.events.filter(event => event.type === 'assistant/message' && textOf(event.data.message?.content).trim() !== '' && event.seq > lastResult.seq);
  assert.ok(replies.length > 0, 'the final assistant reply follows the tool result within the same turn');
  const reply = replies.at(-1);assert.ok(reply.data.step > lastResult.data.step, 'the post-tool assistant reply belongs to a later step');
  assert.ok(stepEnds.get(reply.data.step)?.seq > reply.seq, 'the final assistant message precedes its step end');
  assert.ok(target.ends[0].seq > reply.seq, 'the single turn end follows the final assistant reply');
  return { userRequests: userMessages.length, turnIds: [...turns.keys()], targetTurn: turn, stepIds: steps,
    toolCalls: calls.map(event => ({ callId: event.data.callId, turn: event.data.turn, step: event.data.step })),
    finalReplyStep: reply.data.step, completionProcesses: turns.size, modelSources };
}

export async function waitForUserTurnSemantics(read, expected, timeout = 30000) {
  let failure;const deadline = Date.now() + timeout;
  do {
    const page = await read();
    try { return assertUserTurnSemantics(page, expected); } catch (error) { failure = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw failure;
}

export async function assertVisibleTurnProcesses(page, semantics) {
  const expected = semantics.turnIds.map(String).sort();
  await page.waitForFunction(ids => {
    const actual = [...document.querySelectorAll('button[data-turn-process]')]
      .filter(button => button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0)
      .map(button => button.getAttribute('data-turn-process')).sort();
    return JSON.stringify(actual) === JSON.stringify(ids);
  }, { timeout: 30000 }, expected);
  const actual = await page.$$eval('button[data-turn-process]', buttons => buttons
    .filter(button => button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0)
    .map(button => button.getAttribute('data-turn-process')).sort());
  assert.deepEqual(actual, expected, 'the official UI renders one completion process per actual user turn');
}

/** Match the public source to actual durable SDK response evidence, never a requested alias. */
export function assertModelExecutionEvidence(history, page, expected) {
  const byId = new Map(history.records.map(record => [record.id, record]));
  const sources = page.records.filter(record => record.event?.type === 'assistant/message').map(record => {
    const message = record.event.data.message;
    const identity = assistantStepMessageSource(message.id);
    assert.ok(identity, 'official message links to its durable SDK step');
    const durable = byId.get(identity.messageId);
    assert.ok(durable, 'durable step for official source exists');
    const step = durable.parts.find(part => part.type === 'data-dsh-step')?.data;
    const source = durable.parts.find(part => part.type === 'data-dsh-model-source')?.data;
    assert.ok(step && source, 'new model execution has durable step and response evidence');
    assert.equal(step.requestedModel, expected.requestedModel, 'each step uses the admitted canonical model');
    assert.equal(step.reasoningEffort, expected.reasoningEffort, 'each continuation retains the admitted effort');
    assert.equal(source.requestedModel, step.requestedModel);
    assert.equal(source.reasoningEffort, step.reasoningEffort);
    assert.ok(typeof step.responseModel === 'string' && step.responseModel !== '' && step.responseModel !== 'unknown', 'successful response reports its actual provider model');
    assert.equal(source.model, step.responseModel, 'source keeps the response model instead of echoing the request');
    assert.equal(message.source.provider, expected.provider);
    assert.equal(message.source.model, step.responseModel, 'official message source matches actual response evidence');
    return { messageId: message.id, requestedModel: step.requestedModel, reasoningEffort: step.reasoningEffort, responseModel: step.responseModel };
  });
  assert.ok(sources.length > 0);
  return sources;
}
