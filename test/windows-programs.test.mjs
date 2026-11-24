import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchEnvironment, findProgram, pathOf} from '../src/launch-env.mjs';
import {findBundledClaude} from '../src/claude-locate.mjs';
import {claudeEnvironment, findClaudeExecutable, getClaudeStatus} from '../src/claude-backend.mjs';
import {codexEnvironment, findCodexExecutable, codexLauncher, codexNeedsDirectRun} from '../src/codex-client.mjs';
import {buildCodexExecArgs, DirectCodexExec} from '../src/codex-direct-exec.mjs';

const secrets = {ANTHROPIC_API_KEY: 'sk-ant-x', XAI_API_KEY: 'xai-x', OPENAI_API_KEY: 'sk-x', GITHUB_TOKEN: 'ghp_x', SECRET_TOKEN: 't'};
const winSource = {Path: 'C:\\Windows\\system32;C:\\Tools', USERPROFILE: 'C:\\Users\\Pat', APPDATA: 'C:\\Users\\Pat\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\Pat\\AppData\\Local', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', ...secrets};

test('Windows environment: only what the programs need, PATH found whatever its case, secrets left out', () => {
  const env = launchEnvironment(winSource, {platform: 'win32', home: 'C:\\Users\\Pat', windowsKeys: ['CODEX_HOME']});
  assert.equal(env.USERPROFILE, 'C:\\Users\\Pat');
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\Pat\\AppData\\Local');
  assert.equal(env.PATH, 'C:\\Users\\Pat\\.local\\bin;C:\\Windows\\system32;C:\\Tools');
  for (const secret of Object.keys(secrets)) assert.equal(secret in env, false, secret);
  assert.equal(pathOf({Path: 'x'}), 'x'); assert.equal(pathOf({PATH: 'y'}), 'y'); assert.equal(pathOf({}), '');
});

test('macOS and Linux environments are unchanged: colon PATH with the Homebrew folders in front', () => {
  const env = launchEnvironment({PATH: '/custom/bin', HOME: '/home/pat', USER: 'pat', ...secrets}, {platform: 'linux', home: '/ignored', unixKeys: ['HOME', 'USER']});
  assert.equal(env.PATH, '/home/pat/.local/bin:/opt/homebrew/bin:/usr/local/bin:/custom/bin:/usr/bin:/bin');
  assert.deepEqual([env.HOME, env.USER], ['/home/pat', 'pat']);
  assert.equal('ANTHROPIC_API_KEY' in env, false);
  assert.equal(launchEnvironment({PATH: '/p'}, {platform: 'darwin', home: '/Users/me', unixKeys: ['HOME']}).HOME, '/Users/me');
});

test('finds programs by their .exe name on Windows, plain name elsewhere, PATH before extra folders', async () => {
  const existing = new Set(['C:\\Tools\\claude.exe', 'C:\\Extra\\codex.exe']);
  const check = async file => existing.has(file);
  const env = {PATH: 'C:\\Windows;C:\\Tools'};
  assert.equal(await findProgram('claude', env, {platform: 'win32', check}), 'C:\\Tools\\claude.exe');
  assert.equal(await findProgram('codex', env, {platform: 'win32', check}), null);
  assert.equal(await findProgram('codex', env, {platform: 'win32', check, extraFolders: ['C:\\Extra']}), 'C:\\Extra\\codex.exe');
  const posix = new Set(['/usr/local/bin/claude']);
  assert.equal(await findProgram('claude', {PATH: '/usr/bin:/usr/local/bin'}, {platform: 'linux', check: async f => posix.has(f)}), '/usr/local/bin/claude');
  assert.equal(await findProgram('claude', {PATH: 'relative\\dir;C:\\ok'}, {platform: 'win32', check: async f => { assert.ok(f.startsWith('C:\\ok'), f); return false; }}), null);
});

test('the Claude copy inside the Claude desktop app is found, newest version first', async () => {
  const tree = {
    'C:\\L\\Claude-Data': [['claude_x', 'dir']],
    'C:\\L\\Claude-Data\\claude_x': [['claude-code', 'dir'], ['other', 'dir']],
    'C:\\L\\Claude-Data\\claude_x\\claude-code': [['2.1.9', 'dir'], ['2.1.330', 'dir']],
    'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.9': [['aaa', 'dir']],
    'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.9\\aaa': [['claude.exe', 'file']],
    'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.330': [['bbb', 'dir']],
    'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.330\\bbb': [['claude.exe', 'file']],
    'C:\\L\\Claude-Data\\claude_x\\other': [['claude.exe', 'file']],
  };
  const list = async folder => { if (!tree[folder]) throw new Error('ENOENT'); return tree[folder].map(([name, kind]) => ({name, isDirectory: () => kind === 'dir'})); };
  const found = await findBundledClaude(['C:\\L\\Claude-Data', 'C:\\missing'], {list});
  assert.deepEqual(found, ['C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.330\\bbb\\claude.exe', 'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.9\\aaa\\claude.exe']);
});

test('Claude is looked for on PATH, then in the Claude app; the message says how to sign in', async () => {
  const env = {PATH: 'C:\\Nowhere', LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\A'};
  const bundled = async roots => { assert.ok(roots[0].endsWith('Claude-Data')); return ['C:\\L\\Claude-Data\\x\\claude-code\\1.0.0\\h\\claude.exe']; };
  assert.match(await findClaudeExecutable(env, {platform: 'win32', check: async () => false, bundled}), /claude\.exe$/);
  assert.equal(await findClaudeExecutable(env, {platform: 'win32', check: async f => f === 'C:\\Nowhere\\claude.exe', bundled}), 'C:\\Nowhere\\claude.exe');
  await assert.rejects(findClaudeExecutable(env, {platform: 'win32', check: async () => false, bundled: async () => []}), /Claude Code was not found.*claude auth login/);
  await assert.rejects(findClaudeExecutable({PATH: '/nope'}, {platform: 'linux', check: async () => false}), /Claude Code was not found/);

  const exe = 'C:\\L\\claude.exe';
  const notSignedIn = Object.assign(new Error('exit 1'), {stdout: '{"loggedIn":false,"authMethod":"none"}'});
  const out = await getClaudeStatus({find: async () => exe, run: async () => { throw notSignedIn; }, platform: 'win32', environment: () => ({})});
  assert.deepEqual([out.installed, out.signedIn], [true, false]);
  assert.match(out.message, /not signed in/); assert.ok(out.message.includes(`& "${exe}" auth login`));
  const ok = await getClaudeStatus({find: async () => exe, run: async () => ({stdout: '{"loggedIn":true,"authMethod":"claude.ai"}'}), platform: 'win32', environment: () => ({})});
  assert.equal(ok.signedIn, true);
  const apiKeyOnly = await getClaudeStatus({find: async () => exe, run: async () => ({stdout: '{"loggedIn":true,"authMethod":"api_key"}'}), platform: 'win32', environment: () => ({})});
  assert.equal(apiKeyOnly.signedIn, false, 'only a Claude account counts, not an API key');
  const broken = await getClaudeStatus({find: async () => exe, run: async () => { throw new Error('spawn EACCES'); }, platform: 'win32', environment: () => ({})});
  assert.match(broken.message, /Could not confirm/);
});

test('Claude and Codex environments on Windows keep secrets out and find the sign-in folders', () => {
  const claude = claudeEnvironment(winSource, {platform: 'win32', home: 'C:\\Users\\Pat'});
  const codex = codexEnvironment({...winSource, CODEX_HOME: 'C:\\codex-home'}, {platform: 'win32', home: 'C:\\Users\\Pat'});
  for (const env of [claude, codex]) { assert.equal(env.USERPROFILE, 'C:\\Users\\Pat'); for (const secret of Object.keys(secrets)) assert.equal(secret in env, false, secret); }
  assert.equal(codex.CODEX_HOME, 'C:\\codex-home');
  assert.equal(claude.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
});

test('Codex is found on PATH or in the Codex app folder; Windows runs it directly instead of via a script', async () => {
  const env = {PATH: 'C:\\Nowhere', LOCALAPPDATA: 'C:\\L'};
  const app = 'C:\\L\\Programs\\OpenAI\\Codex\\bin\\codex.exe';
  assert.equal(await findCodexExecutable(env, {platform: 'win32', check: async f => f === app}), app);
  await assert.rejects(findCodexExecutable(env, {platform: 'win32', check: async () => false}), /Install Codex/);
  assert.equal(codexNeedsDirectRun('win32'), true);
  assert.equal(codexNeedsDirectRun('darwin'), false);
  assert.equal(await codexLauncher('unused', 'C:\\x\\codex.exe', {platform: 'win32'}), 'C:\\x\\codex.exe');
  const dir = await mkdtemp(join(tmpdir(), 'launcher-'));
  try {
    const script = await codexLauncher(dir, '/usr/local/bin/codex', {platform: 'linux', ephemeral: true});
    const text = await readFile(script, 'utf8');
    assert.match(text, /exec --ignore-user-config --ignore-rules --ephemeral/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('the Windows Codex runner asks for exactly the command line the real SDK builds, plus the isolation flags', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-args-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  // A stand-in "codex": node itself, told by NODE_OPTIONS to print its arguments and stop before running anything.
  const dump = join(dir, 'dump.cjs').replace(/\\/g, '/');
  await writeFile(dump, "process.stdout.write(JSON.stringify({type:'dump',argv:process.argv.slice(1)})+'\\n');process.exit(0);");
  const {Codex} = await import('@openai/codex-sdk');
  const config = {features: {apps: false, shell_tool: false}, model_instructions_file: 'C:\\w\\i.md', mcp_servers: {gratis: {url: 'http://127.0.0.1:1/mcp', required: true, tool_timeout_sec: 600}}};
  const threadOptions = {workingDirectory: dir, model: 'gpt-x', modelReasoningEffort: 'low', sandboxMode: 'read-only', approvalPolicy: 'never', skipGitRepoCheck: true, networkAccessEnabled: false, webSearchMode: 'disabled', threadSource: 'gratis'};
  for (const resume of [false, true]) {
    const client = new Codex({codexPathOverride: process.execPath, env: {NODE_OPTIONS: `--require "${dump}"`, PATH: process.env.PATH || process.env.Path || ''}, config});
    const thread = resume ? client.resumeThread('01234567-89ab-cdef-0123-456789abcdef', threadOptions) : client.startThread(threadOptions);
    let sdkArgs;
    for await (const event of (await thread.runStreamed('hello')).events) if (event.type === 'dump') sdkArgs = ['exec', ...event.argv.slice(1)];
    assert.ok(sdkArgs, 'the stand-in saw the SDK command line');
    const ours = buildCodexExecArgs({input: 'hello', threadId: resume ? '01234567-89ab-cdef-0123-456789abcdef' : null, ...threadOptions}, {config});
    assert.deepEqual(ours.filter(a => !['--ignore-user-config', '--ignore-rules'].includes(a)), sdkArgs, resume ? 'resumed thread' : 'new thread');
    assert.deepEqual(ours.slice(0, 3), ['exec', '--ignore-user-config', '--ignore-rules']);
  }
  assert.ok(buildCodexExecArgs({input: 'x'}, {ephemeral: true}).includes('--ephemeral'));
  assert.equal(buildCodexExecArgs({input: 'x'}).includes('--ephemeral'), false);
});

test('the Windows Codex runner streams lines, feeds the prompt, reports failures and stops the program', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-run-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const script = join(dir, 'fake.cjs');
  await writeFile(script, `
    const args = process.argv.slice(2); let input = '';
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => {
      if (input.includes('FAIL')) { process.stderr.write('model exploded'); process.exit(3); }
      if (input.includes('HANG')) { setInterval(() => {}, 1000); return; }
      console.log(JSON.stringify({type: 'echo', input, args, originator: process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, hasSecret: 'SECRET_TOKEN' in process.env}));
      console.log(JSON.stringify({type: 'turn.completed'}));
    });`);
  const children = [];
  const spawnImpl = (exe, args, options) => { const child = spawn(process.execPath, [script, ...args], options); children.push(child); return child; };
  const make = () => new DirectCodexExec({executablePath: 'codex.exe', env: {PATH: process.env.PATH || process.env.Path || ''}, config: {features: {apps: false}}, ephemeral: true, spawnImpl});
  const lines = [];
  for await (const line of make().run({input: 'hello there', model: 'm'})) lines.push(JSON.parse(line));
  assert.equal(lines[0].input, 'hello there'); assert.equal(lines[0].originator, 'codex_sdk_ts'); assert.equal(lines[0].hasSecret, false);
  assert.deepEqual(lines[0].args.slice(0, 5), ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--experimental-json']);
  assert.equal(lines[1].type, 'turn.completed');
  await assert.rejects((async () => { for await (const line of make().run({input: 'FAIL'})) void line; })(), /code 3: model exploded/);
  const controller = new AbortController();
  const hanging = (async () => { for await (const line of make().run({input: 'HANG', signal: controller.signal})) void line; })();
  await new Promise(resolve => setTimeout(resolve, 700));
  controller.abort();
  await assert.rejects(hanging);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.notEqual(children.at(-1).exitCode ?? children.at(-1).signalCode, null, 'the program was stopped');
});
