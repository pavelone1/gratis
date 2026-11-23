// Finds and asks the official Grok Build command-line program (`grok`) about itself.
//
// Gravis never handles a Grok password or token: the user signs in once with xAI's own `grok login`,
// and Gravis runs the program, which reads its own sign-in from ~/.grok. No API key is involved, so
// replies count against the signed-in subscription, not an API balance.
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

export const GROK_MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/;
export const GROK_INSTALL_HELP = 'Install Grok Build from x.ai/build, then run `grok login` in a terminal.';

// Only what the program needs to run and find its own sign-in. Everything else (API keys for other
// services, tokens) stays out of the child process. XAI_API_KEY is deliberately never passed so a
// subscription run cannot silently switch to API billing.
const ENV_ALLOWLIST = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'USERNAME', 'USER', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE'];
export function grokEnvironment(env = process.env) {
  const out = {};
  for (const key of ENV_ALLOWLIST) if (typeof env[key] === 'string') out[key] = env[key];
  return out;
}

const exists = async file => { try { await access(file, constants.X_OK); return true; } catch { return false; } };

/** The full path of the `grok` program, or null. Looks on PATH, then in the installer's default folder. */
export async function findGrokExecutable({ env = process.env, platform = process.platform, home = homedir(), check = exists } = {}) {
  const names = platform === 'win32' ? ['grok.exe'] : ['grok'];
  const folders = [...String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean), join(home, '.grok', 'bin')];
  for (const folder of folders) for (const name of names) {
    const candidate = join(folder, name);
    if (await check(candidate)) return candidate;
  }
  return null;
}

/** Runs `grok <args>` and collects bounded output. Rejects on spawn failure or timeout. */
export function runGrok(executable, args, { env = grokEnvironment(), timeoutMs = 20_000, spawnImpl = spawn, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let child, out = '', err = '', settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { child?.kill(); finish(reject, new Error('Grok did not answer in time.')); }, timeoutMs);
    timer.unref?.();
    try { child = spawnImpl(executable, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { finish(reject, error); return; }
    child.stdout.on('data', d => { if (out.length < 200_000) out += d; });
    child.stderr.on('data', d => { if (err.length < 20_000) err += d; });
    child.on('error', error => finish(reject, error));
    child.on('close', code => finish(resolve, { code, stdout: out, stderr: err }));
  });
}

/** Parses the text of `grok models`. */
export function parseGrokModels(text) {
  const clean = String(text).replace(/\x1b\[[0-9;]*m/g, '');
  const signedIn = /logged in/i.test(clean) && !/not logged in|not signed in/i.test(clean);
  const models = [];
  let inList = false;
  for (const line of clean.split(/\r?\n/)) {
    if (/^\s*available models/i.test(line)) { inList = true; continue; }
    if (!inList) continue;
    const match = /^\s*[*-]\s+(\S+)(\s+\(default\))?/.exec(line);
    if (match && GROK_MODEL_PATTERN.test(match[1])) models.push({ id: match[1], name: match[1], isDefault: Boolean(match[2]) });
  }
  const preferred = /default model:\s*(\S+)/i.exec(clean)?.[1];
  return { signedIn, models, defaultModel: models.find(m => m.isDefault)?.id || preferred || '' };
}

/** What Settings shows: is the program installed, is a user signed in, which models can they use. */
export async function getGrokStatus({ resolveExecutable = findGrokExecutable, run = runGrok } = {}) {
  const executable = await resolveExecutable();
  if (!executable) return { installed: false, signedIn: false, models: [], defaultModel: '', message: `Grok Build is not installed. ${GROK_INSTALL_HELP}` };
  let result;
  try { result = await run(executable, ['models']); } catch (error) {
    return { installed: true, signedIn: false, models: [], defaultModel: '', message: `Could not run Grok: ${String(error.message).slice(0, 160)}` };
  }
  const parsed = parseGrokModels(`${result.stdout}\n${result.stderr}`);
  if (!parsed.signedIn) return { installed: true, signedIn: false, models: [], defaultModel: '', message: 'Grok Build is installed but not signed in. Run `grok login` in a terminal, then check again.' };
  return { installed: true, signedIn: true, ...parsed, message: 'Signed in to Grok. Replies use your Grok subscription.' };
}
export const getGrokModels = async options => (await getGrokStatus(options)).models;
