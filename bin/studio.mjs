#!/usr/bin/env node
// stacked-studio — the one command-line entry point. `studio mcp` is the one MCP server.
// Every command here calls the same core operations the MCP tools and Workbench use.

import '../core/quiet.mjs';
import fs from 'node:fs';

const [cmd, ...rest] = process.argv.slice(2);

/** --flag value / --flag / positional parsing; repeated flags become arrays. */
function parse(args) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2);
      const next = args[i + 1];
      const v = inline ?? (next !== undefined && !next.startsWith('--') ? (i++, next) : true);
      opts[k] = k in opts ? [].concat(opts[k], v) : v;
    } else pos.push(a);
  }
  return { pos, opts };
}
const { pos, opts } = parse(rest);
const list = (v) => (v === undefined ? [] : [].concat(v));
const num = (v) => (v === undefined ? undefined : Number(v));

const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
function fail(err) {
  console.error(err.message);
  if (err.fix) console.error(`Fix: ${err.fix}`);
  process.exit(1);
}

const HELP = `stacked-studio

  studio doctor [--json]                    check everything works
  studio keys set <gemini|fal> [--label L]  save an API key (typed at a hidden prompt)
  studio keys list | remove <service>
  studio config [<setting> [<value>]]       daily_cap_usd, image_provider, image_model, aspect, size, author
  studio spend                              what you've spent, per day and per key

  studio image "<prompt>" [--client C] [--project P] [--n 2] [--ref file.png ...] [--product file.png ...]
               [--aspect 4:5] [--size 1K] [--provider gemini|fal|test] [--model M]
  studio edit <id> "<change>" [--output 0] [--branch] [--ref file.png ...]
  studio upscale <id> [--output 0]
  studio compare <id> <id> [...] [--pick <id>]
  studio history [<id>] [--client C] [--project P]
  studio review <id> approve|reject|like|comment|rate [--note "..."] [--value 4] [--output 0]

  studio client list | new "<name>" | context <client> ["<query>"]
  studio client export <client> [--out file.zip] [--with-media] [--drive]
  studio client import <file.zip | Drive link> [--as <folder>]
  studio team import <team-pack.zip>
  studio connect google | disconnect google  sign in to Drive, Slides and Sheets (browser)
  studio drive init <client> | link <client> <folder link> [--read-only]   the client's Drive folders
  studio drive index <client>               list the client's Drive files for search
  studio drive fetch <link|id>              download a Drive file into the cache
  studio drive save <id> [--output 0] [--folder <link>]      upload an image to Drive
  studio deck import <client> [<slides link>] [--thumbnails]  import a deck, or re-sync all linked decks
  studio sheet read <link> [--range "Shots!A1:H50"] | sheet write <link> --range R '<json rows>'
  studio search "<query>" [--client C] [--kind brief ...]
  studio index [--rebuild] [--embed]

  studio media <tool> ['{"json": "args"}']  optional Python media tools (cutout, palette, ocr, ...)
  studio migrate studio-data <path> [--dry-run]
  studio skills                             list skills and pipelines
  studio run <operation> ['{"json": "args"}']  call any operation directly (same as the MCP tools)
  studio mcp                                start the MCP server (used by Claude Code / Codex)
  studio ui [--port 4321] [--no-open]       open the Workbench
`;

async function main() {
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return out(HELP);

    case 'mcp': {
      const { startMcp } = await import('../core/mcp.mjs');
      return startMcp();
    }

    case 'doctor': {
      const { runChecks, renderDoctor } = await import('../core/doctor.mjs');
      const r = await runChecks();
      out(opts.json ? r : renderDoctor(r));
      process.exitCode = r.ready ? 0 : 1;
      return;
    }

    case 'keys': {
      const keys = await import('../core/keys.mjs');
      const [sub, service] = pos;
      if (sub === 'list' || !sub) {
        const rows = keys.keyStatus();
        return out(rows.map((k) => `${k.saved ? '✓' : '·'} ${k.label.padEnd(8)} ${k.saved ? `saved (${k.source}${k.key_label ? `, ${k.key_label}` : ''}, …${k.fingerprint})` : 'not set'}  — ${k.used_for}`).join('\n') + `\nStored in: ${keys.backendLabel()}`);
      }
      if (sub === 'set' || sub === 'import') {
        if (!keys.SERVICES[service]) throw new Error(`Which service? studio keys ${sub} <${Object.keys(keys.SERVICES).join('|')}>`);
        const value = await keys.readSecret(`Paste your ${keys.SERVICES[service].label} key (hidden), then press Enter: `);
        if (!value) throw new Error('No key entered.');
        const b = keys.setKey(service, value, { label: opts.label === true ? null : opts.label ?? (sub === 'import' ? 'team key' : null) });
        return out(`Saved your ${keys.SERVICES[service].label} key to the ${keys.backendLabel(b)}.`);
      }
      if (sub === 'remove') {
        keys.removeKey(service);
        return out(`Removed the ${service} key.`);
      }
      throw new Error(`Unknown: studio keys ${sub}`);
    }

    case 'config': {
      const { settings, setUserSetting, author } = await import('../core/config.mjs');
      const [k, v] = pos;
      if (!k) return out({ ...settings(), author: author() });
      if (v === undefined) return out(String({ ...settings(), author: author() }[k] ?? ''));
      const value = v === 'null' ? null : /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
      setUserSetting(k, value);
      return out(`${k} = ${value}`);
    }

    case 'spend': {
      const { spendSummary } = await import('../core/spend.mjs');
      return out(spendSummary(Number(opts.days ?? 30)));
    }

    case 'run': {
      const { runOp } = await import('../core/ops.mjs');
      const [op, json] = pos;
      const args = json ? JSON.parse(json) : !process.stdin.isTTY && opts.stdin ? JSON.parse(fs.readFileSync(0, 'utf8')) : {};
      return out(await runOp(op, args));
    }

    case 'image': {
      const { runOp } = await import('../core/ops.mjs');
      const inputs = [...list(opts.product).map((p) => ({ path: p, role: 'product' })), ...list(opts.ref).map((p) => ({ path: p, role: 'reference' })), ...list(opts.style).map((p) => ({ path: p, role: 'style' }))];
      return out(
        await runOp('image_generate', {
          prompt: pos.join(' '),
          instruction: pos.join(' '),
          client: opts.client,
          project: opts.project,
          n: num(opts.n) ?? 1,
          inputs,
          provider: opts.provider,
          model: opts.model,
          size: opts.size,
          aspect: opts.aspect,
          deliverable: opts.deliverable,
          allow_text: Boolean(opts['allow-text']),
        })
      );
    }

    case 'edit': {
      const { runOp } = await import('../core/ops.mjs');
      const [id, ...words] = pos;
      return out(
        await runOp('image_edit', {
          id,
          output: num(opts.output) ?? 0,
          prompt: words.join(' '),
          instruction: words.join(' '),
          what_changed: opts.note ?? words.join(' '),
          mode: opts.branch ? 'branch' : 'edit',
          inputs: [...list(opts.product).map((p) => ({ path: p, role: 'product' })), ...list(opts.ref).map((p) => ({ path: p, role: 'reference' }))],
          provider: opts.provider,
          model: opts.model,
          n: num(opts.n) ?? 1,
        })
      );
    }

    case 'upscale': {
      const { runOp } = await import('../core/ops.mjs');
      return out(await runOp('image_upscale', { id: pos[0], output: num(opts.output) ?? 0, provider: opts.provider }));
    }

    case 'compare': {
      const { runOp } = await import('../core/ops.mjs');
      return out(await runOp('image_compare', { items: pos, pick: opts.pick, note: opts.note }));
    }

    case 'history':
    case 'images': {
      const { runOp } = await import('../core/ops.mjs');
      return out(await runOp('history', { id: pos[0], client: opts.client, project: opts.project, limit: num(opts.limit) }));
    }

    case 'review': {
      const { runOp } = await import('../core/ops.mjs');
      const [id, action] = pos;
      return out(await runOp('review', { id, action, output: num(opts.output) ?? 0, value: num(opts.value), note: opts.note }));
    }

    case 'client': {
      const [sub, a, ...more] = pos;
      if (sub === 'list' || !sub) {
        const { runOp } = await import('../core/ops.mjs');
        return out(await runOp('client_list', a ? { client: a } : {}));
      }
      if (sub === 'new') {
        const { createClient } = await import('../core/workspace.mjs');
        const slug = createClient(a, { industry: opts.industry });
        return out(`Made clients/${slug}/ — fill in client.yaml (links) and brand.md (approved rules).`);
      }
      if (sub === 'context') {
        const { runOp } = await import('../core/ops.mjs');
        return out(await runOp('client_context', { client: a, query: more.join(' ') || undefined, project: opts.project }));
      }
      if (sub === 'export') {
        const { exportClient } = await import('../core/share.mjs');
        const { resolveClient } = await import('../core/workspace.mjs');
        const r = exportClient(resolveClient(a), { out: opts.out, withMedia: Boolean(opts['with-media']) });
        if (opts.drive) {
          const { uploadClientPack } = await import('../core/google/studio-drive.mjs');
          r.drive = await uploadClientPack(r.zip);
        }
        return out(r);
      }
      if (sub === 'import') {
        const { importClient } = await import('../core/share.mjs');
        let zip = a;
        if (!fs.existsSync(a) && /drive\.google\.com|^[A-Za-z0-9_-]{20,}$/.test(a)) {
          const os = await import('node:os');
          const path = await import('node:path');
          const { downloadTo } = await import('../core/google/drive.mjs');
          zip = (await downloadTo(a, path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stacked-pack-')), 'pack.zip'))).file;
        }
        const r = importClient(zip, { as: opts.as });
        const { refresh } = await import('../core/index.mjs');
        refresh();
        return out(r);
      }
      if (sub === 'sync') throw new Error('Direct Drive sync is coming later. For now: export, share the zip on Drive, import.');
      throw new Error(`Unknown: studio client ${sub}`);
    }

    case 'connect':
    case 'disconnect': {
      if (pos[0] !== 'google') throw new Error(`Usage: studio ${cmd} google`);
      const g = await import('../core/google/auth.mjs');
      if (cmd === 'disconnect') {
        await g.disconnect();
        return out('Disconnected Google.');
      }
      const r = await g.connect({ open: !opts['no-open'], onUrl: (u) => console.error(`Opening Google sign-in in your browser. If it doesn't open, visit:\n${u}\n`) });
      return out(`Connected Google${r.email ? ` as ${r.email}` : ''}.`);
    }

    case 'drive': {
      const [sub, a, b] = pos;
      const sd = await import('../core/google/studio-drive.mjs');
      const { resolveClient } = await import('../core/workspace.mjs');
      const { runOp } = await import('../core/ops.mjs');
      if (sub === 'init') return out(await sd.initClientFolder(resolveClient(a)));
      if (sub === 'link') return out(await sd.linkClientFolder(resolveClient(a), b, { readOnly: Boolean(opts['read-only']) }));
      if (sub === 'index') return out(await runOp('drive_index', { client: a }));
      if (sub === 'fetch') return out(await runOp('drive_fetch', { file: a }));
      if (sub === 'save') return out(await runOp('drive_save', { id: a, output: num(opts.output) ?? 0, folder: opts.folder, name: opts.name }));
      throw new Error('Usage: studio drive init|link|index|fetch|save …');
    }

    case 'deck': {
      if (pos[0] !== 'import') throw new Error('Usage: studio deck import <client> <slides link> [--thumbnails]');
      const { runOp } = await import('../core/ops.mjs');
      return out(await runOp('deck_import', { client: pos[1], deck: pos[2], thumbnails: Boolean(opts.thumbnails) }));
    }

    case 'sheet': {
      const { runOp } = await import('../core/ops.mjs');
      if (pos[0] === 'read') return out(await runOp('sheet_read', { sheet: pos[1], range: opts.range, limit: num(opts.limit) }));
      if (pos[0] === 'write') return out(await runOp('sheet_write', { sheet: pos[1], range: opts.range, values: JSON.parse(pos[2] ?? '[]') }));
      throw new Error('Usage: studio sheet read|write <link> …');
    }

    case 'team': {
      if (pos[0] !== 'import') throw new Error('Usage: studio team import <team-pack.zip>');
      const { importTeam } = await import('../core/share.mjs');
      return out(importTeam(pos[1]));
    }

    case 'search': {
      const { runOp } = await import('../core/ops.mjs');
      return out(await runOp('search', { query: pos.join(' '), client: opts.client, project: opts.project, kinds: opts.kind ? list(opts.kind) : undefined, k: num(opts.k) }));
    }

    case 'index': {
      const idx = await import('../core/index.mjs');
      const r = opts.rebuild ? idx.rebuild() : idx.refresh();
      if (opts.embed) Object.assign(r, { embeddings: await idx.embedMissing({ provider: opts.provider }) });
      return out(r);
    }

    case 'media': {
      const { runOp } = await import('../core/ops.mjs');
      return out(await runOp('media_run', { tool: pos[0] ?? 'list', args: pos[1] ? JSON.parse(pos[1]) : {} }));
    }

    case 'skills': {
      const { catalog } = await import('../core/skills.mjs');
      return out(catalog().map((s) => `${s.type === 'pipeline' ? '⇢' : '·'} ${s.name.padEnd(26)} ${s.description.split('. ')[0]}`).join('\n'));
    }

    case 'migrate': {
      const [source, from] = pos;
      if (source !== 'studio-data') throw new Error('Usage: studio migrate studio-data <path-to-studio-data> [--dry-run]');
      const { migrateStudioData } = await import('../core/migrate-studio-data.mjs');
      const r = await migrateStudioData(from, { dryRun: Boolean(opts['dry-run']) });
      return out(r);
    }

    case 'ui': {
      const { startServer } = await import('../apps/workbench/server.mjs');
      return startServer({ port: num(opts.port), open: !opts['no-open'] });
    }

    default:
      throw new Error(`Unknown command "${cmd}". Run: studio help`);
  }
}

main().catch(fail);
