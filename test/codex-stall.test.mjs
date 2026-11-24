import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodexReply, codexStallMs} from '../src/codex-backend.mjs';

const ID = '01234567-89ab-cdef-0123-456789abcdef';
const settings = {provider: 'codex', model: 'm', effort: 'medium'};
const bot = {name: 'T', instructions: 'Be brief.'};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// A fake Codex whose runs are described one per attempt: 'hang', 'ok', or a function returning an event generator.
function fakeClient(plans, calls) {
  const run = async (prompt, {signal}) => {
    const plan = plans[Math.min(calls.length, plans.length - 1)];
    calls.push(plan);
    return {events: (async function* () {
      yield {type: 'thread.started', thread_id: ID};
      yield {type: 'turn.started'};
      if (plan === 'hang') { await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {once: true})); return; }
      if (typeof plan === 'function') { yield* plan(signal); return; }
      yield {type: 'item.completed', item: {id: 'a', type: 'agent_message', text: 'Hello'}};
      yield {type: 'turn.completed', usage: {input_tokens: 1, output_tokens: 1}};
    })()};
  };
  return {startThread: () => ({id: ID, runStreamed: run}), resumeThread: () => ({id: ID, runStreamed: run})};
}

async function reply(t, plans, extra = {}) {
  const calls = [], dir = await mkdtemp(join(tmpdir(), 'codex-stall-'));
  // The watchdog timer does not keep Node alive on its own (the app is always running); the test must.
  const keepAlive = setInterval(() => {}, 20); t.after(() => clearInterval(keepAlive));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const make = createCodexReply({createClient: () => fakeClient(plans, calls), status: async () => ({signedIn: true}), resolveExecutable: async () => '/fake', platform: 'linux', stallMs: 60, ...extra});
  const run = async (signal = new AbortController().signal) => { let text = ''; for await (const part of make({settings, bot, messages: [{role: 'user', content: 'hi'}], signal, workspaceDir: dir, persistSession: false, onMetadata: () => {}})) text += part; return text; };
  return {run, calls};
}

test('a reply that goes silent before saying anything is stopped and retried once', async t => {
  const {run, calls} = await reply(t, ['hang', 'ok']);
  assert.equal(await run(), 'Hello');
  assert.equal(calls.length, 2, 'the first attempt stalled, the second answered');
});

test('if the retry also stalls, the user gets a clear message instead of waiting', async t => {
  const {run, calls} = await reply(t, ['hang', 'hang']);
  await assert.rejects(run(), /Codex stopped responding.*did not recover on a second try/);
  assert.equal(calls.length, 2, 'only one retry');
});

test('a long tool call is not a stall, and a reply that already started is not retried', async t => {
  const slowTool = async function* () {
    yield {type: 'item.started', item: {id: 't', type: 'mcp_tool_call', server: 'gratis', tool: 'ask_agent', status: 'in_progress'}};
    await wait(250); // four times the stall limit, but a tool is running
    yield {type: 'item.completed', item: {id: 't', type: 'mcp_tool_call', server: 'gratis', tool: 'ask_agent', status: 'completed'}};
    yield {type: 'item.completed', item: {id: 'a', type: 'agent_message', text: 'Done'}};
    yield {type: 'turn.completed', usage: {}};
  };
  const waiting = await reply(t, [slowTool]);
  assert.equal(await waiting.run(), 'Done');
  assert.equal(waiting.calls.length, 1);

  const partial = async function* () {
    yield {type: 'item.completed', item: {id: 'a', type: 'agent_message', text: 'Partial answer'}};
    await wait(400);
  };
  const started = await reply(t, [partial, 'ok']);
  await assert.rejects(started.run(), /Codex stopped responding for/);
  assert.equal(started.calls.length, 1, 'text already shown, so no silent second attempt');
});

test('a reply that stalls after a tool already ran is not retried (the tool might repeat)', async t => {
  const afterTool = async function* () {
    yield {type: 'item.started', item: {id: 't', type: 'mcp_tool_call', server: 'gratis', tool: 'write_file'}};
    yield {type: 'item.completed', item: {id: 't', type: 'mcp_tool_call', server: 'gratis', tool: 'write_file', status: 'completed'}};
    await wait(400);
  };
  const {run, calls} = await reply(t, [afterTool, 'ok']);
  await assert.rejects(run(), /Codex stopped responding/);
  assert.equal(calls.length, 1);
});

test('pressing Stop is a stop, not a stall, and nothing is retried', async t => {
  const {run, calls} = await reply(t, ['hang', 'ok'], {stallMs: 5000});
  const controller = new AbortController();
  const running = run(controller.signal);
  await wait(100);
  controller.abort(new Error('stopped by user'));
  await assert.rejects(running, /stopped by user/);
  assert.equal(calls.length, 1);
});

test('thinking-heavy settings wait longer before a reply counts as stalled', () => {
  assert.ok(codexStallMs('medium') >= 120000);
  assert.ok(codexStallMs('xhigh') > codexStallMs('medium'));
  assert.equal(codexStallMs(undefined), codexStallMs('low'));
});
