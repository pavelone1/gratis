import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChatService} from '../src/chat-service.mjs';
import {validateSettings} from '../src/backend.mjs';
import {validState, initialState, DEFAULT_SETTINGS} from '../src/store.mjs';
import {validateMemoryChoice} from '../src/provider-select.mjs';
import {extractMemory, memorySettings} from '../src/memory-extract.mjs';

const base = {provider: 'codex', model: 'gpt-main', effort: 'high', baseUrl: 'http://127.0.0.1:11434/v1', providerDefaults: {claude: {model: 'opus', effort: 'high'}}};
const job = {id: 'j1', user: {text: 'Call me Sam.', at: 1700000000000}, reply: 'Hi Sam.', tools: []};

test('memory AI choice is validated: provider list, model rules, nothing for the default', () => {
  assert.deepEqual(validateMemoryChoice(), {memoryProvider: '', memoryModel: ''});
  assert.deepEqual(validateMemoryChoice('', 'ignored without a provider'), {memoryProvider: '', memoryModel: ''});
  assert.deepEqual(validateMemoryChoice('claude'), {memoryProvider: 'claude', memoryModel: ''}); // Haiku by default
  assert.deepEqual(validateMemoryChoice('claude', 'haiku'), {memoryProvider: 'claude', memoryModel: 'haiku'});
  assert.deepEqual(validateMemoryChoice('xai-api', ' grok-mini '), {memoryProvider: 'xai-api', memoryModel: 'grok-mini'});
  for (const bad of [['local', 'x'], ['demo', 'x'], ['__proto__', 'x'], ['claude', 'gpt-5'], ['codex', ''], ['openai-api', ''], ['openai-api', 'has space'], ['codex', 'x'.repeat(201)]]) {
    assert.throws(() => validateMemoryChoice(...bad), undefined, JSON.stringify(bad));
  }
  assert.throws(() => validateMemoryChoice(7, ''), /text/);
});

test('settings carry the memory choice, default to following the app, and old saves still load', () => {
  const settings = {...base, provider: 'claude', model: 'sonnet'};
  assert.deepEqual([validateSettings(settings).memoryProvider, validateSettings(settings).memoryModel], ['', '']);
  const picked = validateSettings({...settings, memoryProvider: 'openai-api', memoryModel: 'gpt-mini'});
  assert.deepEqual([picked.memoryProvider, picked.memoryModel], ['openai-api', 'gpt-mini']);
  assert.throws(() => validateSettings({...settings, memoryProvider: 'local'}));
  assert.deepEqual([DEFAULT_SETTINGS.memoryProvider, DEFAULT_SETTINGS.memoryModel], ['', '']);
  const state = initialState();
  assert.equal(validState(state), true);
  const legacy = structuredClone(state); delete legacy.settings.memoryProvider; delete legacy.settings.memoryModel;
  assert.equal(validState(legacy), true, 'a workspace saved before this setting existed must still load');
  state.settings.memoryProvider = 'nonsense'; assert.equal(validState(state), false);
});

test('memory runs on the app default (Claude on Haiku) unless a memory AI is chosen', () => {
  assert.deepEqual([memorySettings({...base, provider: 'claude', model: 'opus'}).model, memorySettings({...base, provider: 'claude', model: 'opus'}).effort], ['haiku', 'low']);
  assert.deepEqual([memorySettings(base).provider, memorySettings(base).model, memorySettings(base).effort], ['codex', 'gpt-main', 'high']); // unchanged behaviour
  const cheap = memorySettings({...base, memoryProvider: 'openai-api', memoryModel: 'gpt-mini'});
  assert.deepEqual([cheap.provider, cheap.model, cheap.effort, cheap.baseUrl], ['openai-api', 'gpt-mini', 'low', base.baseUrl]);
  const claude = memorySettings({...base, memoryProvider: 'claude'});
  assert.deepEqual([claude.provider, claude.model, claude.effort], ['claude', 'haiku', 'low']); // not the remembered Opus
  assert.equal(memorySettings({...base, memoryProvider: 'claude', memoryModel: 'sonnet'}).model, 'sonnet');
});

test('the memory call goes to the chosen AI, even when the app default is the demo provider', async () => {
  const seen = [];
  const backend = async function* (request) { seen.push(request.settings); yield '{"facts":[],"episode":null,"task":null}'; };
  await extractMemory({job, settings: {...base, memoryProvider: 'xai-api', memoryModel: 'grok-mini'}, workspaceDir: '.', backend});
  assert.deepEqual([seen[0].provider, seen[0].model], ['xai-api', 'grok-mini']);
  const demoDefault = await extractMemory({job, settings: {...base, provider: 'demo', model: ''}, workspaceDir: '.', backend});
  assert.equal(seen.length, 1, 'the demo default still makes no model call');
  assert.deepEqual(demoDefault.facts, []);
  await extractMemory({job, settings: {...base, provider: 'demo', model: '', memoryProvider: 'claude'}, workspaceDir: '.', backend});
  assert.equal(seen[1].provider, 'claude');
});

test('saving other settings keeps the memory choice, and saving it persists', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'memory-ai-'));
  t.after(() => rm(dataDir, {recursive: true, force: true}));
  const s = new ChatService({dataDir, backend: async function* () { yield 'ok'; }});
  await s.init(); t.after(() => s.close().catch(() => {}));
  await s.updateSettings({...s.state.settings, memoryProvider: 'claude', memoryModel: 'haiku'});
  const {memoryProvider, memoryModel, ...withoutMemory} = s.state.settings;
  await s.updateSettings({...withoutMemory, voiceLanguage: 'auto'});
  assert.deepEqual([s.state.settings.memoryProvider, s.state.settings.memoryModel, s.state.settings.voiceLanguage], ['claude', 'haiku', 'auto']);
  const again = new ChatService({dataDir, backend: async function* () { yield 'ok'; }}); await again.init();
  t.after(() => again.close().catch(() => {}));
  assert.equal(again.state.settings.memoryProvider, 'claude');
});
