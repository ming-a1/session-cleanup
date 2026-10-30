/**
 * Bounded turn extraction for the session-cleanup bundle's transcript view.
 *
 * A "turn" starts at a user message and collects the assistant text and tool
 * calls that follow it until the next user message. The session log is the
 * source of truth; this module is a pure fold over its events, so live and
 * cold sessions read the same way. Reasoning and tool results stay out of the
 * compact view. The result is tail-bounded so one long session cannot flood
 * the browser, while the statistics keep counting the full log.
 *
 * @module session-cleanup/transcript
 */

/** Largest number of turns one transcript returns. */
export const TRANSCRIPT_MAX_TURNS = 200;
/** Largest total character count one transcript returns. */
export const TRANSCRIPT_MAX_CHARS = 200000;

/**
 * Concatenate the text blocks of one message.
 *
 * @param content - message content blocks.
 * @returns plain text, or an empty string.
 */
export function textOf(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

/**
 * Read the tool calls of one assistant message.
 *
 * @param content - message content blocks.
 * @returns tool names, in call order.
 */
export function toolCallsOf(content) {
  if (!Array.isArray(content)) return [];
  const names = [];
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'tool-call' && typeof block.name === 'string' && block.name.length > 0) {
      names.push(block.name);
    }
  }
  return names;
}

/**
 * Fold session events into bounded turns plus full-log statistics.
 *
 * @param events - session event log.
 * @param options - turn and character bounds.
 * @returns `{ turns, stats, total, truncated }`; `stats` counts the whole log.
 */
export function buildTranscript(events, options = {}) {
  const maxTurns = options.maxTurns ?? TRANSCRIPT_MAX_TURNS;
  const maxChars = options.maxChars ?? TRANSCRIPT_MAX_CHARS;
  const turns = [];
  let userMessages = 0;
  let toolCalls = 0;
  let current;
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;
    if (event.type === 'user/message') {
      // Injected context (runtime snapshot, time sample, approval notices) is
      // also logged as a user message; only a human prompt starts a turn.
      const kind = event.data?.source?.kind;
      if (typeof kind === 'string' && kind !== 'user') continue;
      // `user/message` carries the UserMessage itself; assistant events wrap
      // theirs in `data.message`. Accept both spellings defensively.
      const text = textOf(event.data?.content ?? event.data?.message?.content);
      if (text.length === 0) continue;
      userMessages += 1;
      current = { index: userMessages, time: event.time, userText: text, assistantText: '', tools: [] };
      turns.push(current);
      continue;
    }
    if (event.type !== 'assistant/message') continue;
    const text = textOf(event.data?.message?.content);
    const calls = toolCallsOf(event.data?.message?.content);
    toolCalls += calls.length;
    if (text.length === 0 && calls.length === 0) continue;
    if (current === undefined) {
      current = { index: 0, time: event.time, userText: '', assistantText: '', tools: [] };
      turns.push(current);
    }
    if (text.length > 0) current.assistantText = current.assistantText.length === 0 ? text : current.assistantText + '\n\n' + text;
    if (calls.length > 0) current.tools.push(...calls);
  }
  const total = turns.length;
  let truncated = false;
  while (turns.length > maxTurns) {
    turns.shift();
    truncated = true;
  }
  let chars = 0;
  let cut = -1;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    chars += turns[index].userText.length + turns[index].assistantText.length;
    if (chars > maxChars) {
      cut = index;
      break;
    }
  }
  if (cut >= 0) {
    turns.splice(0, cut + 1);
    truncated = true;
  }
  return {
    turns,
    stats: { turns: userMessages, userMessages, toolCalls },
    total,
    truncated,
  };
}
