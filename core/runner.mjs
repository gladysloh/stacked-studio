import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { detectAgents, STUDIO_BIN } from './agents.mjs';
import { userConfig } from './config.mjs';
import { appendJsonl, readJsonl } from './fsutil.mjs';
import { newId } from './ids.mjs';
import { paths, repoRoot } from './paths.mjs';
import { listGenerations } from './records.mjs';
import { readSkill } from './skills.mjs';

// Runs the person's own coding agent in the background when they type in the Workbench.
// One run at a time; the rest wait. Claude Code runs restricted: only the studio's MCP tools and
// Read, no shell, no file edits. The run id travels to the studio tools in STACKED_RUN_ID, so every
// image made in a run is linked back to it.

const RUN_TIMEOUT_MS = 10 * 60 * 1000;
export const RUN_KINDS = ['new', 'refine', 'direction'];
const TOOLS = ['studio_capabilities', 'client_context', 'search', 'drive_fetch', 'image_generate', 'image_edit', 'image_upscale', 'image_compare', 'history'];

export function pickAgent() {
  if (process.env.STACKED_AGENT_CMD) return { id: 'custom', label: 'Test agent', cmd: process.env.STACKED_AGENT_CMD };
  const found = detectAgents();
  const want = userConfig().agent;
  if (want === 'codex' && found.codex) return { id: 'codex', label: 'Codex', cmd: found.codex };
  if (found.claude) return { id: 'claude', label: 'Claude Code', cmd: found.claude };
  if (found.codex) return { id: 'codex', label: 'Codex', cmd: found.codex };
  return null;
}

const q = (s) => `"""${String(s).replaceAll('"""', '"')}"""`;

/** The task the agent gets. The person's words are quoted exactly and passed as `instruction`. */
export function buildTask(run) {
  const where = run.client ? `Client: ${run.client}${run.project ? `, project: ${run.project}` : ''}. Call client_context first.` : 'No client: work in scratch.';
  if (run.kind === 'new') {
    return `Make an image in the studio.\n${where}\nThe person's request (pass it verbatim as instruction): ${q(run.text)}\nRead the image-generate skill, write the prompt, call image_generate with n=${run.n ?? 1}${run.aspect ? ` and aspect ${run.aspect}` : ''}. Then reply in one or two short lines.`;
  }
  const mode = run.kind === 'refine' ? 'edit' : 'branch';
  return `${run.kind === 'refine' ? 'Refine' : 'Start a new direction from'} image ${run.target} (output ${run.output ?? 0}).\n${where}\nThe person's request (pass it verbatim as instruction): ${q(run.text)}\nRead the image-edit skill. Call image_edit with id ${run.target}, output ${run.output ?? 0}, mode "${mode}", a prompt that says only the change, and what_changed. Then reply in one or two short lines.`;
}

export function agentCommand(agent, run, task) {
  const env = { STACKED_RUN_ID: run.id, ...(process.env.STACKED_WORKSPACE ? { STACKED_WORKSPACE: process.env.STACKED_WORKSPACE } : {}), ...(process.env.STACKED_USER_HOME ? { STACKED_USER_HOME: process.env.STACKED_USER_HOME } : {}) };
  const system = readSkill('studio')?.text ?? '';
  if (agent.id === 'claude') {
    const mcp = JSON.stringify({ mcpServers: { 'stacked-studio': { command: process.execPath, args: [STUDIO_BIN, 'mcp'], env } } });
    const args = ['-p', task, '--output-format', 'stream-json', '--verbose', '--restricted', '--strict-mcp-config', '--mcp-config', mcp,
      '--tools', 'Read', '--allowedTools', ...TOOLS.map((t) => `mcp__stacked-studio__${t}`), 'Read', '--permission-mode', 'dontAsk',
      '--add-dir', paths().media, '--append-system-prompt', system];
    return { cmd: agent.cmd, args, env };
  }
  if (agent.id === 'codex') {
    // Codex: read-only sandbox, the studio server passed inline. Check flags against your Codex version.
    const t = (v) => JSON.stringify(v);
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only',
      '-c', `mcp_servers.stacked-studio.command=${t(process.execPath)}`, '-c', `mcp_servers.stacked-studio.args=${t([STUDIO_BIN, 'mcp'])}`,
      ...Object.entries(env).flatMap(([k, v]) => ['-c', `mcp_servers.stacked-studio.env.${k}=${t(v)}`]),
      `${system}\n\n${task}`];
    return { cmd: agent.cmd, args, env };
  }
  return { cmd: process.execPath, args: [agent.cmd, task], env };
}

/** One line of agent output → plain progress lines, session id, final message. */
export function progressFrom(event) {
  const lines = [];
  let final = null;
  const label = (name, input = {}) => {
    const n = String(name).replace(/^mcp__stacked-studio__/, '');
    return (
      {
        client_context: 'Reading client knowledge',
        search: 'Searching references',
        studio_capabilities: 'Reading the skill',
        image_generate: `Making ${input.n ?? 1} image${(input.n ?? 1) > 1 ? 's' : ''}`,
        image_edit: 'Changing the image',
        image_upscale: 'Upscaling',
        image_compare: 'Comparing',
        history: 'Looking at earlier versions',
        Read: 'Looking at the images',
      }[n] ?? null
    );
  };
  if (event.type === 'assistant') for (const c of event.message?.content ?? []) if (c.type === 'tool_use' && label(c.name, c.input)) lines.push(label(c.name, c.input));
  if (event.type === 'result') final = { ok: !event.is_error, message: String(event.result ?? '').slice(0, 4000) };
  if (event.type === 'item.started' && event.item?.type === 'mcp_tool_call' && label(event.item.tool, event.item.arguments)) lines.push(label(event.item.tool, event.item.arguments));
  if (event.type === 'item.completed' && event.item?.type === 'agent_message') final = { ok: true, message: String(event.item.text ?? '').slice(0, 4000) };
  if (event.type === 'step') lines.push(event.text);
  if (event.type === 'done') final = { ok: event.ok !== false, message: event.message ?? '' };
  return { lines, final };
}

function plainError(stderr, code, agent) {
  const s = stderr.toLowerCase();
  if (/log ?in|not logged|authenticat|unauthori/.test(s)) return `${agent.label} isn't signed in. Open it in a terminal and sign in, then try again.`;
  if (/rate limit|usage limit|quota/.test(s)) return `${agent.label} has reached its usage limit. Try again later.`;
  return `${agent.label} stopped${code ? ` (exit ${code})` : ''}.`;
}

export class Runner {
  constructor() {
    this.runs = new Map();
    this.queue = [];
    this.child = null;
    this.current = null;
    this.log = path.join(paths().cache, 'runs.jsonl');
    for (const r of readJsonl(this.log).slice(-50)) this.runs.set(r.id, { ...r, status: ['running', 'queued'].includes(r.status) ? 'stopped' : r.status });
  }

  list() {
    return [...this.runs.values()].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 20).map((r) => this.view(r));
  }

  view(r) {
    const images = r.status === 'done' || r.status === 'running' ? listGenerations({ limit: 200 }).filter((g) => g.run_id === r.id).map((g) => g.id) : [];
    return { ...r, images };
  }

  get(id) {
    const r = this.runs.get(id);
    return r ? this.view(r) : null;
  }

  start({ kind, text, target = null, output = 0, client = null, project = null, n = 1, aspect = null }) {
    if (!RUN_KINDS.includes(kind)) throw new Error(`Unknown run kind "${kind}".`);
    if (!String(text ?? '').trim()) throw new Error('Type what you want first.');
    if (kind !== 'new' && !target) throw new Error('Which image?');
    const run = { id: newId('run'), kind, text: String(text).slice(0, 4000), target, output, client, project, n, aspect, status: 'queued', steps: [], message: null, created: new Date().toISOString() };
    this.runs.set(run.id, run);
    this.queue.push(run.id);
    this.save(run);
    this.next();
    return this.view(run);
  }

  stop(id) {
    const r = this.runs.get(id);
    if (!r) return null;
    if (r.status === 'queued') {
      this.queue = this.queue.filter((x) => x !== id);
      this.finish(r, 'stopped', 'Stopped.');
    } else if (r.status === 'running' && this.child) {
      this.stopping = true;
      this.child.kill('SIGTERM');
    }
    return this.view(r);
  }

  save(run) {
    fs.mkdirSync(path.dirname(this.log), { recursive: true });
    appendJsonl(this.log, run);
  }

  finish(run, status, message) {
    Object.assign(run, { status, message, finished: new Date().toISOString() });
    this.save(run);
    this.current = null;
    this.child = null;
    this.next();
  }

  next() {
    if (this.current || !this.queue.length) return;
    const run = this.runs.get(this.queue.shift());
    const agent = pickAgent();
    if (!agent) {
      this.finish(run, 'waiting', 'No agent found. Copy the request into Claude Code or Codex.');
      return;
    }
    this.current = run.id;
    this.stopping = false;
    run.status = 'running';
    run.agent = agent.label;
    run.steps = [`Starting ${agent.label}`];
    const { cmd, args, env } = agentCommand(agent, run, buildTask(run));
    let child;
    try {
      child = spawn(cmd, args, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return this.finish(run, 'failed', `Couldn't start ${agent.label}: ${err.message}`);
    }
    this.child = child;
    let buf = '';
    let errText = '';
    let final = null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, RUN_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        const p = progressFrom(ev);
        for (const l of p.lines) if (run.steps.at(-1) !== l) run.steps.push(l);
        if (p.final) final = p.final;
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => (errText = (errText + d).slice(-2000)));
    child.on('error', (err) => (errText += err.message));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (this.stopping) return this.finish(run, 'stopped', 'Stopped.');
      if (timedOut) return this.finish(run, 'failed', 'Took longer than 10 minutes, so it was stopped.');
      if (final?.ok && code === 0) return this.finish(run, 'done', final.message);
      this.finish(run, 'failed', final?.message || plainError(errText, code, agent));
    });
  }
}
