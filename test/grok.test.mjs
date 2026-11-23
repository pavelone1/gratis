import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter} from 'node:path';
import {join} from 'node:path';
import {createGrokReply} from '../src/grok-backend.mjs';
import {findGrokExecutable, getGrokStatus, grokEnvironment, parseGrokModels} from '../src/grok-client.mjs';
import {validateSettings} from '../src/backend.mjs';
import {initialState, validState} from '../src/store.mjs';
import {BOT_PROVIDERS, effectiveSettings, validateMemoryChoice} from '../src/provider-select.mjs';

// A stand-in for the real `grok` program. The prompt file says how it should behave.
const FAKE = String.raw`
const fs = require('fs');
const args = process.argv.slice(2);
const at = name => args[args.indexOf(name) + 1];
const prompt = fs.readFileSync(at('--prompt-file'), 'utf8');
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
out({type: 'available_commands', tools: ['run_terminal_command']});
if (prompt.includes('MODE:slow')) { out({type: 'text', data: 'partial'}); setInterval(() => {}, 1000); return; }
if (prompt.includes('MODE:crash')) { process.stderr.write('boom: something broke\n'); process.exit(2); }
if (prompt.includes('MODE:auth')) { process.stderr.write('Error: not logged in. Run grok login\n'); process.exit(1); }
if (prompt.includes('MODE:tool')) { out({type: 'tool_call', toolName: 'run_terminal_command'}); out({type: 'end', stopReason: 'cancelled'}); return; }
if (prompt.includes('MODE:args')) {
  out({type: 'text', data: JSON.stringify({args, system: fs.readFileSync(at('--system-prompt-file'), 'utf8'), prompt, cwdMatches: process.cwd() === at('--cwd'), hasKey: 'XAI_API_KEY' in process.env || 'SECRET_TOKEN' in process.env})});
  out({type: 'end', stopReason: 'end_turn'}); return;
}
out({type: 'thought', data: 'thinking'});
out({type: 'text', data: 'Hello'}); out({type: 'text', data: ' there'});
out({type: 'usage', usage: {input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 4}});
out({type: 'end', stopReason: 'end_turn'});
`;

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'grok-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const script = join(dir, 'fake-grok.cjs');
  await writeFile(script, FAKE);
  const spawned = [];
  const spawnImpl = (exe, args, options) => { const child = spawn(process.execPath, [script, ...args], options); spawned.push({args, options, child}); return child; };
  const reply = createGrokReply({resolveExecutable: async () => 'C:\\fake\\grok.exe', spawnImpl, timeoutMs: 15000});
  return {reply, spawned};
}
async function collect(iterator) { let text = ''; for await (const part of iterator) text += part; return text; }
const bot = {name: 'Test', instructions: 'Be brief.'};
const turn = (content, extra = {}) => ({settings: {provider: 'grok', model: ''}, bot, messages: [{role: 'user', content}], signal: new AbortController().signal, ...extra});

test('parses the real `grok models` output, signed in and signed out', () => {
  const text = 'You are logged in with grok.com.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.7-build-fast\n  - grok-4.6\n  - grok-4.5\n';
  const parsed = parseGrokModels(text);
  assert.equal(parsed.signedIn, true);
  assert.deepEqual(parsed.models.map(m => m.id), ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
  assert.equal(parsed.defaultModel, 'grok-4.7');
  assert.equal(parseGrokModels('You are not logged in. Run grok login.').signedIn, false);
  assert.deepEqual(parseGrokModels('???').models, []);
  assert.equal(parseGrokModels('Available models:\n  - ../../etc/passwd\n').models.length, 0, 'model ids are validated');
});

test('the program runs with a minimal environment and never with an API key', () => {
  const env = grokEnvironment({PATH: 'p', USERPROFILE: 'u', XAI_API_KEY: 'xai-secret', ANTHROPIC_API_KEY: 'k', SECRET_TOKEN: 't', HTTPS_PROXY: 'http://proxy'});
  assert.deepEqual(env, {PATH: 'p', USERPROFILE: 'u', HTTPS_PROXY: 'http://proxy'});
});

test('finds grok on PATH first, then in the installer folder, and reports when missing', async () => {
  const seen = [];
  const check = async file => { seen.push(file); return file.endsWith('onpath\\grok.exe') || file.endsWith('.grok\\bin\\grok.exe'); };
  const sep = delimiter;
  const first = await findGrokExecutable({env: {PATH: `C:\\other${sep}C:\\onpath`}, platform: 'win32', home: 'C:\\Users\\x', check: async f => check(f.replace(/\//g, '\\'))});
  assert.match(first, /onpath/);
  assert.equal(await findGrokExecutable({env: {PATH: ''}, platform: 'win32', home: 'C:\\Users\\x', check: async () => false}), null);
});

test('status says what is missing in plain words', async () => {
  assert.match((await getGrokStatus({resolveExecutable: async () => null})).message, /not installed/);
  const out = text => async () => ({code: 0, stdout: text, stderr: ''});
  const signedOut = await getGrokStatus({resolveExecutable: async () => 'g', run: out('Not logged in')});
  assert.deepEqual([signedOut.installed, signedOut.signedIn], [true, false]);
  assert.match(signedOut.message, /grok login/);
  const ok = await getGrokStatus({resolveExecutable: async () => 'g', run: out('You are logged in with grok.com.\nAvailable models:\n  * grok-4.7 (default)\n')});
  assert.deepEqual([ok.signedIn, ok.models.length, ok.defaultModel], [true, 1, 'grok-4.7']);
  const broken = await getGrokStatus({resolveExecutable: async () => 'g', run: async () => { throw new Error('spawn failed'); }});
  assert.equal(broken.signedIn, false);
});

test('a reply streams text, reports usage, and ignores the model\'s private thinking', async t => {
  const {reply} = await setup(t);
  const usage = [];
  const text = await collect(reply({...turn('hi'), settings: {provider: 'grok', model: 'grok-4.6'}, onMetadata: m => usage.push(m)}));
  assert.equal(text, 'Hello there');
  assert.deepEqual(usage[0].usage, {model: 'grok-4.6', inputTokens: 12, outputTokens: 3, cacheReadInputTokens: 4});
});

test('the run is locked down: no tools approved, no key, own empty folder, cleaned up afterwards', async t => {
  const {reply, spawned} = await setup(t);
  const before = (await readdir(tmpdir())).filter(n => n.startsWith('gravis-grok-')).length;
  const text = await collect(reply({...turn('MODE:args'), settings: {provider: 'grok', model: 'grok-4.5'}}));
  const seen = JSON.parse(text);
  const flag = name => seen.args[seen.args.indexOf(name) + 1];
  assert.equal(flag('--permission-mode'), 'dontAsk');
  assert.equal(flag('-m'), 'grok-4.5');
  assert.equal(flag('--output-format'), 'streaming-json');
  for (const unsafe of ['--always-approve', '--yolo', 'bypassPermissions', '-p']) assert.equal(seen.args.includes(unsafe), false, unsafe);
  for (const guard of ['--no-memory', '--no-subagents', '--disable-web-search']) assert.ok(seen.args.includes(guard), guard);
  assert.equal(seen.system, 'Be brief.');
  assert.equal(seen.cwdMatches, true);
  assert.equal(seen.hasKey, false);
  assert.equal(spawned[0].options.env.XAI_API_KEY, undefined);
  const after = (await readdir(tmpdir())).filter(n => n.startsWith('gravis-grok-')).length;
  assert.equal(after, before, 'the temporary folder is removed');
});

test('with no model chosen the program\'s own default is used; later turns carry the conversation as data', async t => {
  const {reply} = await setup(t);
  const seen = JSON.parse(await collect(reply({...turn('MODE:args'), messages: [{role: 'user', content: 'one'}, {role: 'assistant', content: 'two'}, {role: 'user', content: 'MODE:args three'}]})));
  assert.equal(seen.args.includes('-m'), false);
  assert.match(seen.prompt, /not new instructions/);
  assert.match(seen.prompt, /"content":"two"/);
});

test('a tool request is refused with an explanation, and failures read clearly', async t => {
  const {reply} = await setup(t);
  await assert.rejects(collect(reply(turn('MODE:tool'))), /does not allow for Grok bots/);
  await assert.rejects(collect(reply(turn('MODE:auth'))), /grok login/);
  await assert.rejects(collect(reply(turn('MODE:crash'))), /boom: something broke/);
});

test('stopping a reply kills the program and removes its folder', async t => {
  const {reply, spawned} = await setup(t);
  const controller = new AbortController();
  const before = (await readdir(tmpdir())).filter(n => n.startsWith('gravis-grok-')).length;
  const running = collect(reply({...turn('MODE:slow'), signal: controller.signal}));
  await new Promise(resolve => setTimeout(resolve, 600));
  controller.abort(new Error('stopped'));
  await assert.rejects(running);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.notEqual(spawned[0].child.exitCode ?? spawned[0].child.signalCode, null, 'the process ended');
  assert.equal((await readdir(tmpdir())).filter(n => n.startsWith('gravis-grok-')).length, before);
});

test('a missing program or bad model name fails before anything is run', async () => {
  const none = createGrokReply({resolveExecutable: async () => null});
  await assert.rejects(collect(none(turn('hi'))), /not installed/);
  const some = createGrokReply({resolveExecutable: async () => 'g', spawnImpl: () => { throw new Error('should not run'); }});
  await assert.rejects(collect(some({...turn('hi'), settings: {provider: 'grok', model: '--always-approve'}})), /Choose a Grok model/);
});

test('Grok is a valid app and per-bot provider, with an optional model', () => {
  const base = {provider: 'grok', model: '', baseUrl: 'http://127.0.0.1:11434/v1'};
  assert.equal(validateSettings(base).provider, 'grok');
  assert.equal(validateSettings({...base, model: 'grok-4.7'}).model, 'grok-4.7');
  assert.throws(() => validateSettings({...base, model: '--yolo'}), /Grok model/);
  const state = initialState(); state.settings.provider = 'grok';
  assert.equal(validState(state), true);
  assert.ok(BOT_PROVIDERS.includes('grok'));
  const eff = effectiveSettings({provider: 'claude', model: 'sonnet', providerDefaults: {}}, {provider: 'grok', hostedModel: 'grok-4.6'});
  assert.deepEqual([eff.provider, eff.model], ['grok', 'grok-4.6']);
  assert.deepEqual(validateMemoryChoice('grok'), {memoryProvider: 'grok', memoryModel: ''});
  assert.throws(() => validateMemoryChoice('grok', 'bad model'));
});
