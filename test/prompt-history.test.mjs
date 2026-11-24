import test from 'node:test';
import assert from 'node:assert/strict';
import {createPromptHistory, promptsForConversation, onFirstLine, onLastLine} from '../src/prompt-history.mjs';

const user = (content, createdAt) => ({role: 'user', content, createdAt});
const state = {conversations: [
  {id: 'c1', botId: 'a', createdAt: 1, messages: [user('first', 10), {role: 'assistant', content: 'reply', createdAt: 11}, user('second', 20), user('second', 21), user('  ', 22)]},
  {id: 'c2', botId: 'a', createdAt: 2, messages: [user('older chat prompt', 5), user('third', 30)]},
  {id: 'other', botId: 'b', createdAt: 3, messages: [user('someone else', 25)]},
  {id: 'child', botId: 'a', parentThreadId: 'c2', createdAt: 4, messages: [user('delegated', 26)]},
]};

test('earlier prompts come from the same bot, oldest first, without blanks, repeats, other bots or delegations', () => {
  assert.deepEqual(promptsForConversation(state, 'c1'), ['older chat prompt', 'first', 'second', 'third']);
  assert.deepEqual(promptsForConversation(state, 'other'), ['someone else']);
  assert.deepEqual(promptsForConversation(state, 'missing'), []);
  assert.deepEqual(promptsForConversation(state, 'c1', {limit: 2}), ['second', 'third']);
});

test('Up walks back through prompts and Down returns to what you were typing', () => {
  const history = createPromptHistory(), load = () => ['one', 'two', 'three'];
  assert.equal(history.browsing, false);
  assert.equal(history.previous('half-typed', load, 'c1'), 'three');
  assert.equal(history.browsing, true);
  assert.equal(history.previous('three', load, 'c1'), 'two');
  assert.equal(history.previous('two', load, 'c1'), 'one');
  assert.equal(history.previous('one', load, 'c1'), null, 'nothing older than the first prompt');
  assert.equal(history.next(), 'two');
  assert.equal(history.next(), 'three');
  assert.equal(history.next(), 'half-typed', 'your unfinished text comes back');
  assert.equal(history.browsing, false);
  assert.equal(history.next(), null, 'Down does nothing when not browsing');
});

test('typing, sending or switching chat starts the history afresh', () => {
  const history = createPromptHistory();
  history.previous('', () => ['a', 'b'], 'c1');
  history.reset();
  assert.equal(history.browsing, false);
  assert.equal(history.previous('draft', () => ['a', 'b', 'c'], 'c1'), 'c');
  assert.equal(history.previous('c', () => ['x'], 'c2'), 'x', 'a different chat reloads the list');
  assert.equal(history.previous('', () => [], 'c3'), null, 'an empty history changes nothing');
});

test('arrow keys only browse history when the caret is on the first (Up) or last (Down) line', () => {
  assert.equal(onFirstLine('hello', 0), true);
  assert.equal(onFirstLine('hello\nworld', 3), true);
  assert.equal(onFirstLine('hello\nworld', 8), false);
  assert.equal(onLastLine('hello\nworld', 8), true);
  assert.equal(onLastLine('hello\nworld', 2), false);
  assert.equal(onLastLine('', 0), true);
});
