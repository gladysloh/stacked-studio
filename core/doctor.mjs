import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { claudeLinked, codexLinked, detectAgents } from './agents.mjs';
import { teamConfig } from './config.mjs';
import { depsInstalled } from './deps.mjs';
import { isWritable } from './fsutil.mjs';
import { keyStatus } from './keys.mjs';
import { putMedia } from './media.mjs';
import * as mock from './providers/mock.mjs';
import { pyReady, uvPath } from './py.mjs';
import { displayPath, paths, repoRoot, which } from './paths.mjs';
import { renderLines } from './report.mjs';
import { linksOk, listSkills, lockMatches } from './skills.mjs';

const SETUP = 'Run ./setup.sh';
export const KEY_FIX = 'In a terminal: studio keys set gemini   (or: studio keys set fal)';

export function nodeOk(version = process.versions.node) {
  const [maj, min] = version.split('.').map(Number);
  return maj > 22 || (maj === 22 && min >= 13);
}

/** Is a path ignored by git? Client data must never be committed to the public repo. */
function gitIgnored(rel) {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) return true;
  const r = spawnSync('git', ['check-ignore', '-q', rel], { cwd: repoRoot });
  return r.status === 0;
}

/** Runs every local check. Changes nothing (the test image goes into the media cache only). */
export async function runChecks() {
  const p = paths();
  const checks = [];
  const add = (id, label, status, detail = '', fix) => checks.push({ id, label, status, detail, ...(fix ? { fix } : {}) });

  add('node', 'Node', nodeOk() ? 'ok' : 'fail', process.versions.node, nodeOk() ? undefined : 'Install Node 22.13 or newer (https://nodejs.org)');
  add('packages', 'Packages', depsInstalled() ? 'ok' : 'fail', '', depsInstalled() ? undefined : SETUP);

  const wsOk = fs.existsSync(p.workspace) && isWritable(p.workspace);
  add('workspace', 'Workspace', wsOk ? 'ok' : 'fail', displayPath(p.workspace), wsOk ? undefined : SETUP);

  if (p.workspace === repoRoot) {
    const safe = ['clients/x', 'team/x', '.cache/x'].every(gitIgnored);
    add('private', 'Client data private', safe ? 'ok' : 'fail', safe ? 'clients/, team/, .cache/ ignored by git' : 'NOT ignored', safe ? undefined : 'Restore .gitignore from the repo: git checkout .gitignore');
  }

  const skills = listSkills();
  add('skills', 'Skills', lockMatches() ? 'ok' : 'fail', `${skills.filter((s) => s.type === 'skill').length} skills, ${skills.filter((s) => s.type === 'pipeline').length} pipelines`, lockMatches() ? undefined : SETUP);
  if (!linksOk()) add('skill-links', 'Skill links', 'fail', 'missing in .claude/skills', SETUP);

  const found = detectAgents();
  if (found.claude) add('claude', 'Claude Code', claudeLinked() ? 'ok' : 'fail', claudeLinked() ? 'linked' : '.mcp.json missing', claudeLinked() ? undefined : 'git checkout .mcp.json');
  if (found.codex) add('codex', 'Codex', codexLinked() ? 'ok' : 'warn', codexLinked() ? 'linked' : 'not linked', codexLinked() ? undefined : './setup.sh --link-codex');
  if (!found.claude && !found.codex) add('agent', 'Agent', 'warn', 'none found', 'Install Claude Code or Codex (or any MCP client) to work with the studio');

  if (wsOk) {
    try {
      const { images } = await mock.image({ prompt: 'studio doctor test' });
      const m = putMedia(images[0].data, images[0].mime);
      add('test-image', 'Test image', fs.existsSync(m.file) ? 'ok' : 'fail', 'made and stored');
    } catch (err) {
      add('test-image', 'Test image', 'fail', err.message, SETUP);
    }
  }

  const keys = keyStatus().filter((k) => k.saved);
  add('keys', 'API keys', keys.length ? 'ok' : 'warn', keys.length ? keys.map((k) => `${k.label}${k.key_label ? ` (${k.key_label})` : ''}`).join(', ') : 'none (free test images for now)', keys.length ? undefined : KEY_FIX);

  const team = teamConfig();
  add('team', 'Team pack', team.name ? 'ok' : 'warn', team.name ? team.name : 'not imported (optional)', team.name ? undefined : 'If your team has one: studio team import <team-pack.zip>');

  const { googleStatus } = await import('./google/auth.mjs');
  const g = googleStatus();
  add('google', 'Google Drive', g.connected ? 'ok' : 'warn', g.connected ? `connected${g.email ? ` as ${g.email}` : ''}` : g.configured ? 'not connected (optional)' : 'not set up for this team (optional)', g.connected ? undefined : g.configured ? 'studio connect google' : 'See docs/google-setup.md');

  const uv = uvPath();
  add('media', 'Media tools', pyReady() ? 'ok' : 'warn', pyReady() ? 'installed' : uv ? 'not installed (optional)' : 'uv not installed (optional)', pyReady() ? undefined : uv ? './setup.sh --with-media' : 'Only needed for cutouts, OCR and video analysis: curl -LsSf https://astral.sh/uv/install.sh | sh');

  const zipOk = which('zip') && which('unzip');
  add('zip', 'Client import/export', zipOk ? 'ok' : 'warn', zipOk ? 'zip available' : 'zip/unzip missing', zipOk ? undefined : 'Install zip and unzip with your package manager');

  const clients = fs.existsSync(p.clients) ? fs.readdirSync(p.clients).filter((n) => !n.startsWith('.') && n !== '_scratch' && fs.existsSync(path.join(p.clients, n, 'client.yaml'))) : [];
  add('clients', 'Clients', 'ok', clients.length ? `${clients.length}: ${clients.join(', ')}` : 'none yet (work without a client, or import one)');

  const failed = checks.some((c) => c.status === 'fail');
  const summary = failed ? 'Needs attention' : keys.length ? 'Ready' : 'Ready · free test images until a key is added';
  return { ready: !failed, summary, checks };
}

export function renderDoctor(report) {
  return renderLines('stacked-studio check', report.checks) + '\n' + report.summary;
}
