import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson } from './fsutil.mjs';
import { repoRoot, which } from './paths.mjs';

// Everything that depends on a specific coding agent's files or commands lives here, so it is
// easy to update when an agent changes where it keeps its settings.

export const STUDIO_BIN = path.join(repoRoot, 'bin', 'studio.mjs');

export function detectAgents() {
  return { claude: which('claude'), codex: which('codex') };
}

/** Claude Code reads the project's .mcp.json (committed in the repo) and asks the user to approve it. */
export function claudeLinked() {
  const cfg = readJson(path.join(repoRoot, '.mcp.json'));
  const s = cfg?.mcpServers?.["stacked-studio"];
  return Boolean(s && s.command === 'node' && s.args?.includes('mcp'));
}

function codexConfigFile() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
}

export function codexLinked() {
  try {
    return /^\[mcp_servers\.stacked-studio\]/m.test(fs.readFileSync(codexConfigFile(), 'utf8'));
  } catch {
    return false;
  }
}

/** Adds the studio to Codex's own settings (outside the repo). Only run after the user agrees. */
export function linkCodex() {
  const r = spawnSync('codex', ['mcp', 'add', 'stacked-studio', '--', 'node', STUDIO_BIN, 'mcp'], { encoding: 'utf8' });
  if (r.status !== 0 || !codexLinked()) {
    const err = new Error('Could not link Codex automatically.');
    err.fix = `Add this to ${codexConfigFile().replace(os.homedir(), '~')}:\n[mcp_servers.stacked-studio]\ncommand = "node"\nargs = ["${STUDIO_BIN}", "mcp"]`;
    throw err;
  }
}

export function agentNames(found = detectAgents()) {
  return [found.claude && 'Claude Code', found.codex && 'Codex'].filter(Boolean);
}
