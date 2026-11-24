// Up/Down recall of earlier prompts in the message box, like a terminal.
//
// Pure logic with no page access, so it is easy to test. The page feeds it the list of earlier prompts
// (oldest first) when browsing starts, and shows whatever it returns.

/** Your earlier prompts for the bot of `conversation`, oldest first, without immediate repeats. */
export function promptsForConversation(state, conversationId, { limit = 100 } = {}) {
  const current = state?.conversations?.find(c => c.id === conversationId);
  if (!current) return [];
  const rows = [];
  for (const conversation of state.conversations) {
    if (conversation.botId !== current.botId || conversation.parentThreadId) continue;
    for (const message of conversation.messages ?? []) if (message.role === 'user' && !message.internalContinuation && typeof message.content === 'string' && message.content.trim()) rows.push(message);
  }
  rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const texts = [];
  for (const { content } of rows) if (texts.at(-1) !== content) texts.push(content);
  return texts.slice(-limit);
}

/** Position of the caret relative to lines, for deciding whether an arrow key should browse history. */
export const onFirstLine = (value, caret) => !value.slice(0, caret).includes('\n');
export const onLastLine = (value, caret) => !value.slice(caret).includes('\n');

export function createPromptHistory() {
  let items = [], index = -1, stash = '', owner = null;
  return {
    get browsing() { return index !== -1; },
    /** Forget any browsing in progress (call when the user types, sends, or switches chat). */
    reset() { items = []; index = -1; stash = ''; owner = null; },
    /** Start or continue going back. Returns the text to show, or null when there is nothing older. */
    previous(current, load, key) {
      if (index === -1 || owner !== key) { items = load(); owner = key; stash = current; index = items.length; }
      if (index <= 0) return null;
      index -= 1;
      return items[index];
    },
    /** Go forward again; after the newest prompt this returns the text that was being typed. */
    next() {
      if (index === -1) return null;
      index += 1;
      if (index >= items.length) { const back = stash; index = -1; items = []; stash = ''; owner = null; return back; }
      return items[index];
    },
  };
}
