#!/usr/bin/env node
// Sets up stacked-studio on this computer. Safe to run any number of times: each step checks first
// and only does work that is still needed.
//
//   ./setup.sh                  set up (or repair)
//   ./setup.sh --dry-run        show what would change, change nothing
//   ./setup.sh --json           machine-readable output for coding agents
//   ./setup.sh --with-media     also install the optional Python media tools (needs uv)
//   ./setup.sh --link-codex     also add the studio to Codex's settings

import '../core/quiet.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { agentNames, codexLinked, detectAgents, linkCodex } from '../core/agents.mjs';
import { depsInstalled, markDepsInstalled } from '../core/deps.mjs';
import { readJson, writeJsonAtomic } from '../core/fsutil.mjs';
import { displayPath, osName, paths, repoRoot } from '../core/paths.mjs';
import { renderLines } from '../core/report.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const dryRun = flag('--dry-run');
const json = flag('--json');
const skip = new Set((process.env.STACKED_SETUP_SKIP || '').split(',').filter(Boolean)); // tests and CI only

if (flag('--help') || flag('-h')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const p = paths();
const found = detectAgents();
const say = (msg) => !json && !dryRun && process.stderr.write(msg + '\n');

// Modules that need installed packages are loaded only after the packages step.
const late = async () => ({
  skills: await import('../core/skills.mjs'),
  doctor: await import('../core/doctor.mjs'),
  keys: await import('../core/keys.mjs'),
  py: await import('../core/py.mjs'),
  index: await import('../core/index.mjs'),
});

const steps = [
  {
    id: 'computer',
    label: 'This computer',
    check: () => ({ needed: false, detail: [osName(), `Node ${process.versions.node}`, ...agentNames(found)].join(' · ') }),
  },
  {
    id: 'packages',
    label: 'Packages',
    check: () => (depsInstalled() ? { needed: false } : { needed: true, detail: 'install with npm ci (no install scripts)' }),
    run: () => {
      say('  Installing packages…');
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const r = spawnSync(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: repoRoot, stdio: json ? 'pipe' : ['ignore', 'ignore', 'inherit'], encoding: 'utf8', shell: process.platform === 'win32' });
      if (r.status !== 0) {
        const err = new Error('npm ci failed');
        err.fix = 'Check your internet connection, then run setup again.';
        throw err;
      }
      markDepsInstalled();
      return 'installed';
    },
  },
  {
    id: 'workspace',
    label: 'Workspace',
    check: () => (fs.existsSync(p.clients) && fs.existsSync(p.cache) && fs.existsSync(p.user) ? { needed: false, detail: displayPath(p.workspace) } : { needed: true, detail: 'create clients/, .cache/ and ~/.stacked-studio' }),
    run: () => {
      for (const d of [p.clients, p.media, p.user]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
      return `${displayPath(p.clients)} (private, not in git)`;
    },
  },
  {
    id: 'skills',
    label: 'Skills',
    check: async () => {
      const { skills } = await late();
      const n = skills.listSkills().length;
      return skills.lockMatches() ? { needed: false, detail: `${n} linked` } : { needed: true, detail: `link ${n}` };
    },
    run: async () => {
      const { skills } = await late();
      skills.linkClaudeSkills();
      skills.linkAgents();
      return `${Object.keys(skills.writeLock().skills).length} linked`;
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    check: () => {
      if (!found.codex) return { needed: false, detail: 'not installed' };
      if (codexLinked()) return { needed: false, detail: 'linked' };
      return flag('--link-codex') ? { needed: true, detail: 'link' } : { needed: false, detail: 'not linked' };
    },
    run: () => {
      linkCodex();
      return 'linked';
    },
  },
  {
    id: 'media',
    label: 'Media tools',
    check: async () => {
      const { py } = await late();
      if (py.pyReady()) return { needed: false, detail: 'installed' };
      if (!flag('--with-media')) return { needed: false, detail: 'optional (./setup.sh --with-media)' };
      return py.uvPath() ? { needed: true, detail: 'install with uv' } : { needed: false, detail: 'needs uv first' };
    },
    run: async () => {
      say('  Installing media tools with uv (this can take a minute)…');
      const { py } = await late();
      py.syncPy(['media']);
      return 'installed';
    },
  },
  {
    id: 'index',
    label: 'Search index',
    check: () => ({ needed: true, detail: 'refresh' }),
    run: async () => {
      const { index } = await late();
      const r = index.refresh();
      return `${r.chunks} entries`;
    },
  },
];

async function main() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (!(maj > 22 || (maj === 22 && min >= 13))) {
    const msg = `Node 22.13 or newer is needed (found ${process.versions.node}).`;
    json ? console.log(JSON.stringify({ ok: false, error: msg })) : console.error(msg);
    process.exit(1);
  }

  const results = [];
  let failed = null;
  for (const step of steps) {
    if (skip.has(step.id)) {
      results.push({ id: step.id, label: step.label, status: 'unchanged', detail: 'skipped' });
      continue;
    }
    let c;
    try {
      c = await step.check();
    } catch (err) {
      c = { needed: true, detail: err.message };
    }
    // The index refresh is a read-mostly step: it doesn't count as a change.
    if (!c.needed || !step.run) {
      results.push({ id: step.id, label: step.label, status: 'unchanged', detail: c.detail ?? 'no change' });
      continue;
    }
    if (dryRun) {
      results.push({ id: step.id, label: step.label, status: 'planned', detail: c.detail });
      continue;
    }
    try {
      const detail = await step.run();
      results.push({ id: step.id, label: step.label, status: step.id === 'index' ? 'unchanged' : 'done', detail });
    } catch (err) {
      failed = step.id;
      results.push({ id: step.id, label: step.label, status: 'fail', detail: err.message, fix: err.fix ?? 'Run setup again.' });
      break;
    }
  }

  const actions = [];
  let doctor = null;
  if (!dryRun && !failed) {
    const { doctor: d, keys } = await late();
    if (found.codex && !codexLinked() && !flag('--link-codex')) actions.push({ id: 'link-codex', label: 'Link Codex', status: 'action', detail: 'changes Codex settings, so it needs your OK', fix: './setup.sh --link-codex' });
    if (!keys.keyStatus().some((k) => k.saved)) actions.push({ id: 'add-key', label: 'Add an API key', status: 'action', detail: 'optional: free test images until then', fix: d.KEY_FIX });
    doctor = await d.runChecks();
    const state = readJson(p.setupState, {}) ?? {};
    writeJsonAtomic(p.setupState, { ...state, last_run: new Date().toISOString(), ready: doctor.ready });
  }

  const ok = !failed && (dryRun || doctor.ready);
  if (json) console.log(JSON.stringify({ ok, dry_run: dryRun, steps: results, actions, doctor }, null, 2));
  else {
    const { renderDoctor } = doctor ? (await late()).doctor : {};
    console.log(renderLines(dryRun ? 'Setup (preview, nothing changed)' : 'Setup', results));
    if (actions.length) console.log('\n' + renderLines('Next', actions));
    if (doctor) console.log('\n' + renderDoctor(doctor));
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
