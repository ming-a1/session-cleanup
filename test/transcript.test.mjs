/**
 * Pure turn-fold tests: text extraction, tool-call counting, tail bounds, and
 * tolerance for malformed events.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTranscript, textOf, toolCallsOf } from '../lib/transcript.js';

/** Build one user event. */
function user(time, content, kind = 'user') {
  return { type: 'user/message', time, data: { role: 'user', content, source: kind === undefined ? undefined : { kind } } };
}

/** Build one assistant event. */
function assistant(time, content) {
  return { type: 'assistant/message', time, data: { message: { role: 'assistant', content } } };
}

test('textOf concatenates only text blocks', () => {
  assert.equal(textOf([{ type: 'text', text: ' hello ' }, { type: 'reasoning', text: 'think' }, { type: 'text', text: 'world' }]), 'hello \nworld');
  assert.equal(textOf([{ type: 'tool-call', id: 'c', name: 'bash', arguments: '{}' }]), '');
  assert.equal(textOf(undefined), '');
});

test('toolCallsOf collects names in order', () => {
  assert.deepEqual(toolCallsOf([{ type: 'text', text: 'x' }, { type: 'tool-call', name: 'read' }, { type: 'tool-call', name: 'bash' }]), ['read', 'bash']);
  assert.deepEqual(toolCallsOf(undefined), []);
});

test('buildTranscript folds user turns with assistant replies and tool calls', () => {
  const log = [
    { type: 'session', time: 0, data: {} },
    user(1000, [{ type: 'text', text: 'first' }]),
    assistant(2000, [{ type: 'tool-call', name: 'read' }, { type: 'text', text: 'answer' }]),
    assistant(2500, [{ type: 'text', text: 'more' }]),
    { type: 'tool/result', time: 3000, data: { message: { role: 'tool', content: [{ type: 'text', text: 'tool output' }] } } },
    user(4000, [{ type: 'text', text: 'second' }]),
    assistant(5000, [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'reply' }]),
  ];
  const result = buildTranscript(log);
  assert.equal(result.turns.length, 2);
  assert.deepEqual(result.turns[0], {
    index: 1,
    time: 1000,
    userText: 'first',
    assistantText: 'answer\n\nmore',
    tools: ['read'],
  });
  assert.equal(result.turns[1].userText, 'second');
  assert.equal(result.turns[1].assistantText, 'reply');
  assert.deepEqual(result.stats, { turns: 2, userMessages: 2, toolCalls: 1 });
  assert.equal(result.truncated, false);
});

test('buildTranscript ignores tool-result-only and empty messages', () => {
  const result = buildTranscript([
    { type: 'tool/result', time: 1, data: { message: { role: 'tool', content: [{ type: 'text', text: 'x' }] } } },
    assistant(2, [{ type: 'tool-call', name: 'bash' }]),
  ]);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].userText, '');
  assert.equal(result.turns[0].assistantText, '');
  assert.deepEqual(result.turns[0].tools, ['bash']);
  assert.deepEqual(result.stats, { turns: 0, userMessages: 0, toolCalls: 1 });
});

test('buildTranscript keeps the tail under the turn bound but counts everything', () => {
  const events = [];
  for (let index = 0; index < 10; index += 1) events.push(user(index, [{ type: 'text', text: 'm' + index }]));
  const result = buildTranscript(events, { maxTurns: 3 });
  assert.deepEqual(result.turns.map((turn) => turn.userText), ['m7', 'm8', 'm9']);
  assert.equal(result.stats.userMessages, 10);
  assert.equal(result.truncated, true);
});

test('buildTranscript keeps the tail under the character bound', () => {
  const events = [
    user(1, [{ type: 'text', text: 'a'.repeat(60) }]),
    user(2, [{ type: 'text', text: 'b'.repeat(60) }]),
    user(3, [{ type: 'text', text: 'c'.repeat(60) }]),
  ];
  const result = buildTranscript(events, { maxChars: 100 });
  assert.deepEqual(result.turns.map((turn) => turn.userText[0]), ['c']);
  assert.equal(result.stats.userMessages, 3);
  assert.equal(result.truncated, true);
});

test('injected context messages do not start a turn', () => {
  const result = buildTranscript([user(1, [{ type: 'text', text: 'context' }], 'runtime-context'), user(2, [{ type: 'text', text: 'real' }])]);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].userText, 'real');
  assert.equal(result.stats.userMessages, 1);
});

test('user events use the event data as the message itself', () => {
  const result = buildTranscript([user(1, [{ type: 'text', text: 'hi' }])]);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].userText, 'hi');
  assert.equal(result.stats.userMessages, 1);
});

test('buildTranscript tolerates malformed events', () => {
  const result = buildTranscript([null, undefined, {}, { type: 'user/message' }, { type: 'assistant/message', data: { message: { content: 'nope' } } }]);
  assert.equal(result.turns.length, 0);
  assert.deepEqual(result.stats, { turns: 0, userMessages: 0, toolCalls: 0 });
});
