// Platform-aware helpers for running the user's own command-line AI programs (Claude Code, Codex).
//
// The original app only handled macOS and Linux: colon-separated PATH, Homebrew folders and a
// shell-script launcher. These helpers keep that behaviour exactly and add Windows: semicolon PATH,
// `.exe` names, the Windows variables the programs need to find their own sign-in, and the usual
// Windows install folders.
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const WINDOWS_KEYS = ['USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'];

export const pathModule = platform => platform === 'win32' ? path.win32 : path.posix;
export const pathDelimiter = platform => platform === 'win32' ? ';' : ':';

/** The PATH value from an environment object, whatever its capitalisation (Windows copies often say `Path`). */
export function pathOf(source) {
  if (typeof source?.PATH === 'string') return source.PATH;
  const key = Object.keys(source ?? {}).find(name => name.toLowerCase() === 'path');
  return key ? String(source[key]) : '';
}

/**
 * A minimal environment for a child program: only the named variables are copied, so unrelated
 * secrets in the app's own environment never reach it.
 *  - unixKeys / windowsKeys: extra variables to copy on each family of platforms
 *  - home: where the user's home folder is
 */
export function launchEnvironment(source = process.env, { platform = process.platform, home = homedir(), unixKeys = [], windowsKeys = [] } = {}) {
  const p = pathModule(platform), env = {};
  for (const key of platform === 'win32' ? [...WINDOWS_KEYS, ...windowsKeys] : unixKeys) {
    const found = Object.keys(source).find(name => name === key) ?? (platform === 'win32' ? Object.keys(source).find(name => name.toLowerCase() === key.toLowerCase()) : undefined);
    if (found && source[found]) env[key] = source[found];
  }
  env.HOME ||= home;
  const fromSystem = pathOf(source);
  env.PATH = platform === 'win32'
    ? [p.join(home, '.local', 'bin'), fromSystem].filter(Boolean).join(';')
    : [p.join(env.HOME, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', fromSystem, '/usr/bin', '/bin'].filter(Boolean).join(':');
  return env;
}

const canRun = async file => { try { await access(file, constants.X_OK); return true; } catch { return false; } };

/** Every folder on the environment's PATH that is an absolute path. */
export function pathFolders(env, platform = process.platform) {
  const p = pathModule(platform);
  return [...new Set(pathOf(env).split(pathDelimiter(platform)).map(folder => folder.trim().replace(/^"(.*)"$/, '$1')).filter(folder => folder && p.isAbsolute(folder)))];
}

/** The first runnable `name` (an `.exe` on Windows) on PATH, then in `extraFolders`. Returns null if none. */
export async function findProgram(name, env, { platform = process.platform, extraFolders = [], check = canRun } = {}) {
  const p = pathModule(platform), file = platform === 'win32' ? `${name}.exe` : name;
  for (const folder of [...pathFolders(env, platform), ...extraFolders.filter(Boolean)]) {
    const candidate = p.join(folder, file);
    if (await check(candidate)) return candidate;
  }
  return null;
}
