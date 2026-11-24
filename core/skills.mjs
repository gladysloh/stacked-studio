import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { hashDir, readJson, writeJsonAtomic } from './fsutil.mjs';
import { paths, repoRoot } from './paths.mjs';

// Skills (skills/) and pipelines (pipelines/) are SKILL.md folders: plain markdown, so any agent can
// read them. Claude Code finds them through .claude/skills links made by setup; Codex and other MCP
// clients get the same catalog from AGENTS.md and the studio_capabilities tool.

export const SOURCES = [
  { dir: path.join(repoRoot, 'skills'), type: 'skill' },
  { dir: path.join(repoRoot, 'pipelines'), type: 'pipeline' },
];
const CLAUDE_SKILLS = path.join(repoRoot, '.claude', 'skills');

export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    return YAML.parse(m[1]) ?? {};
  } catch {
    return {};
  }
}

export function listSkills() {
  const out = [];
  for (const src of SOURCES) {
    if (!fs.existsSync(src.dir)) continue;
    for (const folder of fs.readdirSync(src.dir).sort()) {
      const file = path.join(src.dir, folder, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const fm = frontmatter(fs.readFileSync(file, 'utf8'));
      out.push({
        name: fm.name || folder,
        folder,
        type: fm.type || src.type,
        area: fm.metadata?.area ?? fm.area ?? null,
        description: fm.description ?? '',
        tools: fm.metadata?.tools ?? fm.tools ?? [],
        needs: fm.metadata?.needs ?? fm.needs ?? [],
        version: String(fm.metadata?.version ?? fm.version ?? '0.0.0'),
        dir: path.join(src.dir, folder),
        hash: hashDir(path.join(src.dir, folder)).slice(0, 16),
      });
    }
  }
  return out;
}

/** The catalog an agent reads to choose a capability. */
export function catalog() {
  return listSkills().map(({ name, type, area, description, tools, needs }) => ({ name, type, area, description, tools, needs }));
}

export function readSkill(name) {
  const s = listSkills().find((x) => x.name === name || x.folder === name);
  return s ? { ...s, text: fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8') } : null;
}

/** Skill name -> short hash, recorded on every generation. */
export function skillVersions() {
  return Object.fromEntries(listSkills().map((s) => [s.name, s.hash]));
}

export function linksOk() {
  return listSkills().every((s) => fs.existsSync(path.join(CLAUDE_SKILLS, s.folder, 'SKILL.md')));
}

/** Makes .claude/skills/<name> point at skills/<name> or pipelines/<name>; removes links whose target is gone. */
export function linkClaudeSkills() {
  fs.mkdirSync(CLAUDE_SKILLS, { recursive: true });
  const wanted = new Set();
  for (const s of listSkills()) {
    wanted.add(s.folder);
    const target = path.join(CLAUDE_SKILLS, s.folder);
    let ok = false;
    try {
      ok = fs.realpathSync(target) === fs.realpathSync(s.dir);
    } catch {}
    if (ok) continue;
    fs.rmSync(target, { recursive: true, force: true });
    try {
      fs.symlinkSync(path.relative(CLAUDE_SKILLS, s.dir), target, 'dir');
    } catch {
      fs.cpSync(s.dir, target, { recursive: true });
    }
  }
  for (const n of fs.readdirSync(CLAUDE_SKILLS)) {
    const full = path.join(CLAUDE_SKILLS, n);
    if (!wanted.has(n) && (fs.lstatSync(full).isSymbolicLink() || !fs.existsSync(path.join(full, 'SKILL.md')))) fs.rmSync(full, { recursive: true, force: true });
  }
}

// Subagents: agents/*.md, linked into .claude/agents/ for Claude Code.
const AGENTS_SRC = path.join(repoRoot, 'agents');
const CLAUDE_AGENTS = path.join(repoRoot, '.claude', 'agents');
export const listAgents = () => (fs.existsSync(AGENTS_SRC) ? fs.readdirSync(AGENTS_SRC).filter((n) => n.endsWith('.md')).sort() : []);

export function agentsLinked() {
  return listAgents().every((n) => fs.existsSync(path.join(CLAUDE_AGENTS, n)));
}

export function linkAgents() {
  fs.mkdirSync(CLAUDE_AGENTS, { recursive: true });
  for (const n of listAgents()) {
    const target = path.join(CLAUDE_AGENTS, n);
    const source = path.join(AGENTS_SRC, n);
    try {
      if (fs.realpathSync(target) === fs.realpathSync(source)) continue;
    } catch {}
    fs.rmSync(target, { force: true });
    try {
      fs.symlinkSync(path.relative(CLAUDE_AGENTS, source), target);
    } catch {
      fs.copyFileSync(source, target);
    }
  }
}

export function lockMatches() {
  const saved = readJson(paths().skillsLock);
  return Boolean(saved && saved.hash === allHash() && linksOk() && agentsLinked());
}

const allHash = () => [...SOURCES.map((s) => hashDir(s.dir)), hashDir(AGENTS_SRC)].join(':');

export function writeLock() {
  const lock = { hash: allHash(), skills: skillVersions(), updated_at: new Date().toISOString() };
  writeJsonAtomic(paths().skillsLock, lock);
  return lock;
}
