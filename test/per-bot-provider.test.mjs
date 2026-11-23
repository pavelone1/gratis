import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChatService} from '../src/chat-service.mjs';
import {effectiveSettings, isBotProvider, botModelField, BOT_PROVIDERS} from '../src/provider-select.mjs';

const app = {provider: 'claude', model: 'haiku', effort: 'low', baseUrl: 'http://127.0.0.1:11434/v1', providerDefaults: {codex: {model: 'gpt-default', effort: 'high'}}};

test('a bot with no pin follows the app-wide provider and model', () => {
  assert.deepEqual(effectiveSettings(app, {}), app);
  assert.deepEqual(effectiveSettings(app, {provider: ''}), app);
  assert.equal(effectiveSettings(app, {model: 'opus'}).model, 'opus'); // per-bot model on the default provider
  assert.equal(effectiveSettings({...app, provider: 'codex', model: 'gpt-app'}, {codexModel: 'gpt-bot'}).model, 'gpt-bot');
});

test('a pinned bot uses its own provider, model and the remembered effort for that provider', () => {
  const codex = effectiveSettings(app, {provider: 'codex', codexModel: 'gpt-sup'});
  assert.equal(codex.provider, 'codex'); assert.equal(codex.model, 'gpt-sup'); assert.equal(codex.effort, 'high');
  assert.equal(codex.baseUrl, app.baseUrl); // everything else stays app-wide
  assert.equal(effectiveSettings(app, {provider: 'codex'}).model, 'gpt-default'); // falls back to what Settings remembered
  assert.equal(effectiveSettings(app, {provider: 'xai-api', hostedModel: 'grok-x'}).model, 'grok-x');
  assert.equal(effectiveSettings({...app, provider: 'codex', model: 'gpt-app'}, {provider: 'claude'}).model, 'sonnet'); // sensible Claude default
  assert.equal(effectiveSettings(app, {provider: 'openai-api'}).model, ''); // no model known: the run will ask for one
});

test('only subscription and API-key providers can be pinned; local and demo follow the app', () => {
  assert.deepEqual([...BOT_PROVIDERS], ['claude', 'codex', 'xai-api', 'openai-api', 'anthropic-api']);
  for (const nope of ['local', 'demo', 'nonsense', '', undefined, '__proto__']) assert.equal(isBotProvider(nope), false);
  assert.equal(effectiveSettings({...app, provider: 'local', model: 'llama'}, {provider: 'local'}).provider, 'local');
  assert.equal(effectiveSettings(app, {provider: 'demo'}).provider, 'claude'); // an unknown pin is ignored, not obeyed
  assert.equal(botModelField('claude'), 'model'); assert.equal(botModelField('codex'), 'codexModel'); assert.equal(botModelField('xai-api'), 'hostedModel'); assert.equal(botModelField('local'), null);
});

async function setup(t, backend) {
  const dataDir = await mkdtemp(join(tmpdir(), 'gravis-perbot-'));
  const s = new ChatService({dataDir, backend, runtimeFactory: async args => args});
  await s.init();
  await s.updateSettings({...s.state.settings, provider: 'claude', model: 'haiku'});
  const ids = [s.state.activeBotId];
  await s.updateBot({id: ids[0], name: 'Supervisor', instructions: 'Coordinate the team.'});
  for (const name of ['Researcher', 'Planner', 'Writer']) { await s.createBot({name, instructions: 'Contribute independently.'}); ids.push(s.state.activeBotId); }
  t.after(async () => { await s.close().catch(() => {}); await rm(dataDir, {recursive: true, force: true}); });
  return {s, ids, dataDir};
}

test('bot provider fields are validated, saved, copied and survive a restart', async t => {
  const {s, ids, dataDir} = await setup(t, async function* () { yield 'ok'; });
  for (const bad of ['local', 'demo', 'bogus', 'constructor']) await assert.rejects(s.updateBot({id: ids[0], provider: bad}), /supported AI/);
  await assert.rejects(s.updateBot({id: ids[0], hostedModel: 'has a space'}), /supported model/);
  await assert.rejects(s.updateBot({id: ids[0], hostedModel: 7}), /supported model/);
  await s.updateBot({id: ids[0], provider: 'xai-api', hostedModel: 'grok-sub'});
  assert.equal(s._bot(ids[0]).provider, 'xai-api');
  await s.updateBot({id: ids[0], provider: ''});
  assert.equal(s._bot(ids[0]).provider, '');
  await s.updateBot({id: ids[1], provider: 'codex', codexModel: 'gpt-sup'});
  const copyState = await s.duplicateBot({id: ids[1]});
  const copy = s._bot(copyState.activeBotId);
  assert.equal(copy.provider, 'codex'); assert.equal(copy.codexModel, 'gpt-sup');
  await s.close();
  const again = new ChatService({dataDir, backend: async function* () { yield 'ok'; }}); await again.init();
  t.after(() => again.close().catch(() => {}));
  assert.equal(again._bot(ids[1]).provider, 'codex');
  assert.equal(effectiveSettings(again.state.settings, again._bot(ids[1])).provider, 'codex');
});

test('a supervisor and each sub-agent run on their own AI, in one group', async t => {
  const seen = {};
  const {s, ids} = await setup(t, async function* ({bot, settings, runtime}) {
    seen[bot.name] = {provider: settings.provider, model: settings.model, tools: !!runtime};
    yield `${bot.name} answering`;
  });
  await s.updateBot({id: ids[0], provider: 'codex', codexModel: 'gpt-sup'});              // supervisor on ChatGPT/Codex
  await s.updateBot({id: ids[1], provider: 'xai-api', hostedModel: 'grok-sub'});         // sub-agent on Grok (API key)
  await s.updateBot({id: ids[2], provider: 'anthropic-api', hostedModel: 'claude-haiku-5-5'}); // sub-agent on Claude (API key)
  /* the fourth bot is left on the app default: Claude subscription */
  await s.createThread({botIds: ids});
  const id = s.state.activeConversationId;
  await s.send({conversationId: id, text: '@everyone report in'});
  await s.whenIdle();
  assert.deepEqual(seen, {
    Supervisor: {provider: 'codex', model: 'gpt-sup', tools: true},
    Researcher: {provider: 'xai-api', model: 'grok-sub', tools: false},          // API-key bots are plain chat: no delegation or computer
    Planner: {provider: 'anthropic-api', model: 'claude-haiku-5-5', tools: false},
    Writer: {provider: 'claude', model: 'haiku', tools: true},
  });
  const root = s._conversation(id);
  const byName = Object.fromEntries(root.messages.filter(m => m.role === 'assistant').map(m => [s.state.bots.find(b => b.id === (m.botId || ids[0])).name, m.provider]));
  assert.deepEqual(byName, {Supervisor: 'codex', Researcher: 'xai-api', Planner: 'anthropic-api', Writer: 'claude'});
});

test('a direct mention runs only that teammate, on that teammate\'s AI', async t => {
  const calls = [];
  const {s, ids} = await setup(t, async function* ({bot, settings}) { calls.push([bot.name, settings.provider]); yield 'ok'; });
  await s.updateBot({id: ids[1], provider: 'openai-api', hostedModel: 'gpt-sub'});
  await s.createThread({botIds: ids});
  await s.send({conversationId: s.state.activeConversationId, text: '@Researcher take this one'});
  await s.whenIdle();
  assert.deepEqual(calls, [['Researcher', 'openai-api']]);
});
