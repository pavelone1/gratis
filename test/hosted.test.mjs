import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateSettings, streamReply} from '../src/backend.mjs';
import {createHostedReply, listHostedModels, redact} from '../src/hosted-backend.mjs';
import {HOSTED, isHostedProvider} from '../src/hosted-providers.mjs';
import {Connections} from '../src/connections.mjs';

const KEY = 'xai-test-key-1234567890abcdef';
const secrets = {hostedKey: async () => KEY};
const base = {baseUrl: 'http://127.0.0.1:11434/v1', effort: 'medium'};
const bot = {name: 'Helper', instructions: 'Be concise'};
const messages = [{role: 'user', content: 'First'}, {role: 'assistant', content: 'Reply'}, {role: 'user', content: 'Second'}];

const sse = frames => new Response(new ReadableStream({start(c) { const enc = new TextEncoder(); for (const f of frames) c.enqueue(enc.encode(f)); c.close(); }}), {status: 200, headers: {'content-type': 'text/event-stream'}});
const delta = text => `data: ${JSON.stringify({choices: [{delta: {content: text}}]})}\n\n`;
async function collect(iterable) { let out = ''; for await (const chunk of iterable) out += chunk; return out; }

test('hosted providers are recognised and validated', () => {
  assert.deepEqual(Object.keys(HOSTED), ['xai-api', 'openai-api', 'anthropic-api']);
  assert.equal(isHostedProvider('xai-api'), true);
  for (const nope of ['claude', 'local', 'constructor', '__proto__', undefined, 5]) assert.equal(isHostedProvider(nope), false);
  for (const provider of Object.keys(HOSTED)) assert.equal(validateSettings({...base, provider, model: 'some-model_1.2:tag'}).provider, provider);
  assert.throws(() => validateSettings({...base, provider: 'xai-api', model: ''}), /Enter a model ID for xAI/);
  assert.throws(() => validateSettings({...base, provider: 'openai-api', model: 'bad model!'}), /model ID/);
  assert.throws(() => validateSettings({...base, provider: 'nonsense', model: 'x'}), /Choose Claude/);
});

test('every hosted provider uses a fixed https host (a saved key cannot be redirected)', () => {
  for (const spec of Object.values(HOSTED)) {
    const url = new URL(spec.baseUrl);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username + url.password + url.search + url.hash, '');
  }
});

test('xAI request goes to the fixed endpoint with the key, system prompt, history and usage', async () => {
  let seen; const usage = [];
  const reply = createHostedReply({fetchImpl: async (url, init) => { seen = {url, init}; return sse([delta('Hel'), delta('lo'), `data: ${JSON.stringify({choices: [], usage: {prompt_tokens: 11, completion_tokens: 3}})}\n\n`, 'data: [DONE]\n\n']); }});
  const text = await collect(reply({settings: {...base, provider: 'xai-api', model: 'grok-x'}, bot, messages, signal: new AbortController().signal, secrets, onMetadata: v => usage.push(v)}));
  assert.equal(text, 'Hello');
  assert.equal(seen.url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(seen.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(seen.init.redirect, 'error');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'grok-x'); assert.equal(body.stream, true);
  assert.deepEqual(body.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(body.messages[0].content, 'Be concise');
  assert.deepEqual(usage, [{usage: {model: 'grok-x', inputTokens: 11, outputTokens: 3, cacheReadInputTokens: 0}}]);
});

test('OpenAI goes to its own host, and the key never appears in the request body', async () => {
  let seen;
  const reply = createHostedReply({fetchImpl: async (url, init) => { seen = {url, init}; return sse([delta('ok'), 'data: [DONE]\n\n']); }});
  await collect(reply({settings: {...base, provider: 'openai-api', model: 'gpt-x'}, bot: {...bot, instructions: ''}, messages: [messages[0]], signal: new AbortController().signal, secrets}));
  assert.equal(seen.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(seen.init.body.includes(KEY), false);
  assert.deepEqual(JSON.parse(seen.init.body).messages.map(m => m.role), ['user']); // empty instructions: no system message
});

test('missing key, bad key and rate limit give clear messages that never contain the key', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(collect(createHostedReply()({settings: {...base, provider: 'xai-api', model: 'm'}, bot, messages, signal, secrets: {hostedKey: async () => ''}})), /Add your xAI API key in Settings/);
  const failing = status => createHostedReply({fetchImpl: async () => new Response(JSON.stringify({error: {message: `Incorrect key ${KEY}`}}), {status, headers: {'content-type': 'application/json'}})});
  await assert.rejects(collect(failing(401)({settings: {...base, provider: 'xai-api', model: 'm'}, bot, messages, signal, secrets})), /rejected the API key/);
  await assert.rejects(collect(failing(429)({settings: {...base, provider: 'openai-api', model: 'm'}, bot, messages, signal, secrets})), /rate limiting/);
  await assert.rejects(collect(failing(500)({settings: {...base, provider: 'openai-api', model: 'm'}, bot, messages, signal, secrets})), error => { assert.match(error.message, /HTTP 500/); assert.equal(error.message.includes(KEY), false); return true; });
  assert.equal(redact(`oops ${KEY} and sk-abcdefgh12345678`, KEY).includes('abcdef'), false);
});

test('cancelling mid-stream stops cleanly with the abort reason', async () => {
  const controller = new AbortController();
  const reply = createHostedReply({fetchImpl: async (url, init) => new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode(delta('partial'))); init.signal.addEventListener('abort', () => c.error(init.signal.reason ?? new Error('aborted'))); }}), {status: 200, headers: {'content-type': 'text/event-stream'}})});
  const seen = [];
  await assert.rejects((async () => { for await (const chunk of reply({settings: {...base, provider: 'xai-api', model: 'm'}, bot, messages, signal: controller.signal, secrets})) { seen.push(chunk); controller.abort(new Error('user stopped')); } })(), /user stopped/);
  assert.deepEqual(seen, ['partial']);
});

test('streamReply routes hosted providers and hands them the key store', async t => {
  let seenUrl;
  t.mock.method(globalThis, 'fetch', async url => { seenUrl = String(url); return sse([delta('routed'), 'data: [DONE]\n\n']); });
  const text = await collect(streamReply({settings: {...base, provider: 'xai-api', model: 'grok-x'}, bot, messages, signal: new AbortController().signal, secrets}));
  assert.equal(text, 'routed'); assert.equal(seenUrl, 'https://api.x.ai/v1/chat/completions');
});

test('model lists drop non-chat models and put the newest first', async () => {
  const fetchImpl = async (url, init) => { assert.equal(url, 'https://api.x.ai/v1/models'); assert.equal(init.headers.Authorization, `Bearer ${KEY}`); return new Response(JSON.stringify({data: [{id: 'grok-old', created: 1}, {id: 'grok-new', created: 9}, {id: 'text-embedding-3', created: 99}, {id: 'grok-imagine-image', created: 50}, {id: 'bad id', created: 5}]}), {status: 200, headers: {'content-type': 'application/json'}}); };
  assert.deepEqual(await listHostedModels({provider: 'xai-api', apiKey: KEY, fetchImpl}), ['grok-new', 'grok-old']);
  await assert.rejects(listHostedModels({provider: 'xai-api', apiKey: '', fetchImpl}), /Add your xAI API key/);
  await assert.rejects(listHostedModels({provider: 'nope', apiKey: KEY, fetchImpl}), /Choose a hosted provider/);
  await assert.rejects(listHostedModels({provider: 'xai-api', apiKey: 'has a space', fetchImpl}), /does not look like an API key/);
  await assert.rejects(listHostedModels({provider: 'xai-api', apiKey: 'bad\nheader', fetchImpl}), /does not look like an API key/);
});

// ---- Claude through the official Anthropic SDK (stubbed) -------------------------------------
function fakeAnthropic({events, final, onParams}) {
  return async () => ({messages: {stream: (params, options) => { onParams(params, options); const it = (async function* () { for (const e of events) yield e; })(); it.finalMessage = async () => final; return it; }}});
}
const textEvent = text => ({type: 'content_block_delta', delta: {type: 'text_delta', text}});

test('Claude API: official SDK params, effort only for 5.x models, streaming text and usage', async () => {
  const calls = []; const usage = [];
  const reply = createHostedReply({createAnthropic: fakeAnthropic({events: [{type: 'message_start'}, textEvent('He'), {type: 'content_block_delta', delta: {type: 'thinking_delta', thinking: 'hidden'}}, textEvent('llo')], final: {stop_reason: 'end_turn', usage: {input_tokens: 7, output_tokens: 2}}, onParams: (p, o) => calls.push({p, o})})});
  const signal = new AbortController().signal;
  const run = async model => collect(reply({settings: {...base, provider: 'anthropic-api', model, effort: 'high'}, bot, messages, signal, secrets, onMetadata: v => usage.push(v)}));
  assert.equal(await run('claude-opus-5-5'), 'Hello');
  assert.equal(await run('claude-3-legacy'), 'Hello');
  assert.equal(calls[0].p.model, 'claude-opus-5-5');
  assert.equal(calls[0].p.system, 'Be concise');
  assert.deepEqual(calls[0].p.output_config, {effort: 'high'});
  assert.equal(calls[0].p.thinking, undefined);
  assert.equal(calls[0].p.max_tokens, 16000);
  assert.equal(calls[0].p.messages.length, 3);
  assert.equal(calls[0].o.signal, signal);
  assert.equal(calls[1].p.output_config, undefined); // old model IDs must not get 5.x-only parameters
  assert.deepEqual(usage[0], {usage: {model: 'claude-opus-5-5', inputTokens: 7, outputTokens: 2, cacheReadInputTokens: 0}});
});

test('Claude API: a refusal with no text is reported, an SDK 401 is explained without the key', async () => {
  const signal = new AbortController().signal, settings = {...base, provider: 'anthropic-api', model: 'claude-sonnet-5-5'};
  const refused = createHostedReply({createAnthropic: fakeAnthropic({events: [], final: {stop_reason: 'refusal', usage: {input_tokens: 1, output_tokens: 0}}, onParams() {}})});
  await assert.rejects(collect(refused({settings, bot, messages, signal, secrets})), /Claude API declined this request/);
  const unauthorized = createHostedReply({createAnthropic: async () => ({messages: {stream: () => { throw Object.assign(new Error(`401 invalid ${KEY}`), {status: 401}); }}})});
  await assert.rejects(collect(unauthorized({settings, bot, messages, signal, secrets})), error => { assert.match(error.message, /rejected the API key/); assert.equal(error.message.includes(KEY), false); return true; });
});

// ---- encrypted key storage ----------------------------------------------------------------------
const encrypt = text => Buffer.from(text).map(b => b ^ 42), decrypt = buffer => Buffer.from(buffer).map(b => b ^ 42).toString();
async function store(t) { const directory = await mkdtemp(join(tmpdir(), 'gratis-hosted-')); t.after(() => rm(directory, {recursive: true, force: true})); return new Connections({directory, encrypt, decrypt}).init(); }

test('API keys are stored encrypted, reported only as booleans, and can be cleared', async t => {
  const c = await store(t);
  assert.deepEqual(c.status().hosted, {'xai-api': false, 'openai-api': false, 'anthropic-api': false});
  assert.throws(() => c.hostedKey('xai-api'), /Add your xAI API key in Settings/);
  await c.configure({xaiKey: `  ${KEY}  `});
  assert.equal(c.hostedKey('xai-api'), KEY);
  assert.equal(c.status().hosted['xai-api'], true);
  assert.equal(JSON.stringify(c.status()).includes(KEY), false);
  assert.equal((await readFile(join(c.directory, 'connections.secure'))).toString().includes(KEY), false);
  const reopened = await new Connections({directory: c.directory, encrypt, decrypt}).init();
  assert.equal(reopened.hostedKey('xai-api'), KEY);
  await reopened.configure({xaiKey: ''});
  assert.equal(reopened.status().hosted['xai-api'], false);
});

test('malformed API keys and unknown providers are rejected before anything is saved', async t => {
  const c = await store(t);
  for (const bad of ['has space', 'new\nline', 'x'.repeat(513), 42]) await assert.rejects(c.configure({openaiKey: bad}), /Invalid OpenAI API key/);
  assert.equal(c.status().hosted['openai-api'], false);
  assert.throws(() => c.hostedKey('claude'), /Choose an API-key provider/);
  assert.throws(() => c.hostedKey('__proto__'), /Choose an API-key provider/);
});

test('a vendor that answers a wrong key with HTTP 400 still gets the friendly key message', async () => {
  const reply = createHostedReply({fetchImpl: async () => new Response(JSON.stringify({code: 'Client specified an invalid argument', error: 'Incorrect API key provided: xai-****. You can obtain an API key from https://console.x.ai.'}), {status: 400, headers: {'content-type': 'application/json'}})});
  await assert.rejects(collect(reply({settings: {...base, provider: 'xai-api', model: 'm'}, bot, messages, signal: new AbortController().signal, secrets})), /rejected the API key/);
  const nested = createHostedReply({fetchImpl: async () => new Response(JSON.stringify({error: {message: 'Invalid API key'}}), {status: 400, headers: {'content-type': 'application/json'}})});
  await assert.rejects(collect(nested({settings: {...base, provider: 'openai-api', model: 'm'}, bot, messages, signal: new AbortController().signal, secrets})), /rejected the API key/);
  const other = createHostedReply({fetchImpl: async () => new Response(JSON.stringify({error: {message: 'Unsupported parameter: foo'}}), {status: 400, headers: {'content-type': 'application/json'}})});
  await assert.rejects(collect(other({settings: {...base, provider: 'openai-api', model: 'm'}, bot, messages, signal: new AbortController().signal, secrets})), /HTTP 400.*Unsupported parameter/);
});

test('API-key provider settings validate, persist across restart and reload (workspace validation)', async t => {
  const {ChatService} = await import('../src/chat-service.mjs');
  const dataDir = await mkdtemp(join(tmpdir(), 'gratis-hosted-persist-'));
  t.after(() => rm(dataDir, {recursive: true, force: true}));
  const first = new ChatService({dataDir, onChange() {}}); await first.init();
  await first.updateSettings({...first.state.settings, provider: 'xai-api', model: 'grok-test-model', effort: 'high'});
  await first.close();
  const second = new ChatService({dataDir, onChange() {}}); await second.init();
  assert.equal(second.state.settings.provider, 'xai-api');
  assert.equal(second.state.settings.model, 'grok-test-model');
  assert.equal(second.state.settings.providerDefaults['xai-api'].model, 'grok-test-model');
  await second.close();
});
