// Where Claude Code lives on Windows. The Claude desktop app ships its own copy of the program inside
// its data folder, in a versioned folder, so it is searched after the usual places.
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const versionParts = text => (/(\d+(?:\.\d+)*)/.exec(text)?.[1] ?? '0').split('.').map(Number);
const newer = (a, b) => { const x = versionParts(a), y = versionParts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] ?? 0) - (x[i] ?? 0); if (d) return d; } return 0; };

/** `claude.exe` copies found in `<root>/**\/claude-code/<version>/**` (shallow search), newest version first. */
export async function findBundledClaude(roots, { list = readdir, maxDepth = 5 } = {}) {
  const found = [];
  const walk = async (folder, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await list(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.win32.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.name.toLowerCase() === 'claude.exe' && /[\\/]claude-code[\\/]/i.test(full)) found.push(full);
    }
  };
  for (const root of roots.filter(Boolean)) await walk(root, 0);
  return found.sort((a, b) => newer(/claude-code[\\/]([^\\/]+)/i.exec(a)?.[1] ?? '', /claude-code[\\/]([^\\/]+)/i.exec(b)?.[1] ?? ''));
}
