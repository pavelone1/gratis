// Runs Codex directly, for computers where the app's shell-script launcher cannot work (Windows).
//
// On macOS and Linux Gravis starts Codex through a small launcher script that adds
// `--ignore-user-config --ignore-rules` after `exec`, so a bot never inherits the user's own Codex
// MCP servers, hooks or rules. Windows cannot start a script that way, and the Codex SDK offers no way
// to add those two flags. So this class replaces the SDK's process runner: it builds the same command
// line the SDK would, puts the two flags in the same place the launcher does, and starts `codex.exe`
// itself. Everything else (events, resuming, stopping) is unchanged.
//
// It is written against @openai/codex-sdk 0.167. The test suite runs the real SDK against a stand-in
// program and checks that this class asks for the same command line, so an SDK upgrade that changes
// the arguments fails a test instead of silently dropping an option.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const isPlain = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const formatKey = key => BARE_KEY.test(key) ? key : JSON.stringify(key);

function tomlValue(value, where) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error(`Codex config override at ${where} must be a finite number`); return `${value}`; }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((item, i) => tomlValue(item, `${where}[${i}]`)).join(', ')}]`;
  if (isPlain(value)) return `{${Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => { if (!key) throw new Error('Codex config override keys must be non-empty strings'); return `${formatKey(key)} = ${tomlValue(child, `${where}.${key}`)}`; }).join(', ')}}`;
  if (value === null) throw new Error(`Codex config override at ${where} cannot be null`);
  throw new Error(`Unsupported Codex config override value at ${where}: ${typeof value}`);
}

function flatten(value, prefix, out) {
  if (!isPlain(value)) {
    if (!prefix) throw new Error('Codex config overrides must be a plain object');
    out.push(`${prefix}=${tomlValue(value, prefix)}`); return;
  }
  const entries = Object.entries(value);
  if (!prefix && !entries.length) return;
  if (prefix && !entries.length) { out.push(`${prefix}={}`); return; }
  for (const [key, child] of entries) {
    if (!key) throw new Error('Codex config override keys must be non-empty strings');
    if (child === undefined) continue;
    const next = prefix ? `${prefix}.${key}` : key;
    if (isPlain(child)) flatten(child, next, out); else out.push(`${next}=${tomlValue(child, next)}`);
  }
}

/** The `codex exec` command line for one turn. */
export function buildCodexExecArgs(args, { config, ephemeral = false } = {}) {
  const out = ['exec', '--ignore-user-config', '--ignore-rules', ...(ephemeral ? ['--ephemeral'] : []), '--experimental-json'];
  if (config) { const overrides = []; flatten(config, '', overrides); for (const override of overrides) out.push('--config', override); }
  if (args.baseUrl) out.push('--config', `openai_base_url=${tomlValue(args.baseUrl, 'openai_base_url')}`);
  if (args.model) out.push('--model', args.model);
  if (args.threadSource !== undefined && !args.threadId) out.push('--thread-source', args.threadSource);
  if (args.sandboxMode) out.push('--sandbox', args.sandboxMode);
  if (args.workingDirectory) out.push('--cd', args.workingDirectory);
  for (const dir of args.additionalDirectories ?? []) out.push('--add-dir', dir);
  if (args.skipGitRepoCheck) out.push('--skip-git-repo-check');
  if (args.outputSchemaFile) out.push('--output-schema', args.outputSchemaFile);
  if (args.cyberAccessProgram !== undefined) out.push('--cyber-access-program', args.cyberAccessProgram);
  if (args.modelReasoningEffort) out.push('--config', `model_reasoning_effort="${args.modelReasoningEffort}"`);
  if (args.networkAccessEnabled !== undefined) out.push('--config', `sandbox_workspace_write.network_access=${args.networkAccessEnabled}`);
  if (args.webSearchMode) out.push('--config', `web_search="${args.webSearchMode}"`);
  else if (args.webSearchEnabled === true) out.push('--config', 'web_search="live"');
  else if (args.webSearchEnabled === false) out.push('--config', 'web_search="disabled"');
  if (args.approvalPolicy) out.push('--config', `approval_policy="${args.approvalPolicy}"`);
  if (args.threadId) out.push('resume', args.threadId);
  for (const image of args.images ?? []) out.push('--image', image);
  return out;
}

export class DirectCodexExec {
  constructor({ executablePath, env, config, ephemeral = false, spawnImpl = spawn }) {
    this.executablePath = executablePath; this.env = env; this.config = config; this.ephemeral = ephemeral; this.spawnImpl = spawnImpl;
    this.lastStderr = ''; // what Codex last wrote to its error stream, kept so a stalled run can say why
  }

  async *run(args) {
    const commandArgs = buildCodexExecArgs(args, { config: this.config, ephemeral: this.ephemeral });
    const env = { ...this.env };
    env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE ||= 'codex_sdk_ts';
    if (args.apiKey) env.CODEX_API_KEY = args.apiKey;
    const child = this.spawnImpl(this.executablePath, commandArgs, { env, signal: args.signal, windowsHide: true });
    let spawnError = null;
    child.once('error', error => { spawnError = error; });
    if (!child.stdin) { child.kill(); throw new Error('Child process has no stdin'); }
    child.stdin.on('error', () => {});
    child.stdin.write(args.input);
    child.stdin.end();
    if (!child.stdout) { child.kill(); throw new Error('Child process has no stdout'); }
    const stderr = [];
    this.lastStderr = '';
    let kept = 0;
    child.stderr?.on('data', data => { if (kept < 65536) { stderr.push(data); kept += data.length; } this.lastStderr = (this.lastStderr + data).slice(-4000); });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) yield line;
      if (spawnError) throw spawnError;
      const { code, signal } = await exited;
      if (code !== 0 || signal) throw new Error(`Codex Exec exited with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}: ${Buffer.concat(stderr).toString('utf8')}`);
    } finally {
      lines.close();
      child.removeAllListeners();
      try { if (!child.killed) child.kill(); } catch { /* already gone */ }
    }
  }
}
