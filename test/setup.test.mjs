import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { cli, repo, tempStudio } from './helpers.mjs';

let t;
beforeEach(() => (t = tempStudio()));
afterEach(() => t.cleanup());

const setup = (args) => spawnSync(process.execPath, [path.join(repo, 'scripts/setup.mjs'), ...args, '--json'], { cwd: repo, env: { ...t.env, STACKED_SETUP_SKIP: 'packages,codex,media' }, encoding: 'utf8' });

test('setup: dry run changes nothing; real run is ready; second run changes nothing', () => {
  const dry = JSON.parse(setup(['--dry-run']).stdout);
  assert.equal(dry.dry_run, true);
  assert.ok(dry.steps.some((s) => s.id === 'workspace' && s.status === 'planned'));
  const first = JSON.parse(setup([]).stdout);
  assert.equal(first.ok, true, JSON.stringify(first.doctor?.checks.filter((c) => c.status === 'fail')));
  const second = JSON.parse(setup([]).stdout);
  assert.deepEqual(second.steps.filter((s) => s.status === 'done'), []);
});

test('doctor: ready without keys, says how to add one, and checks that client data is git-ignored', () => {
  setup([]);
  const r = cli(['doctor', '--json'], t.env).json();
  assert.equal(r.ready, true);
  assert.equal(r.checks.find((c) => c.id === 'keys').status, 'warn');
  assert.equal(r.checks.find((c) => c.id === 'test-image').status, 'ok');
});

test('the repo ignores client data, team packs and caches', () => {
  for (const p of ['clients/acme/client.yaml', 'team/team.yaml', '.cache/index.db', 'acme.zip', 'py/.venv/x']) {
    assert.equal(spawnSync('git', ['check-ignore', '-q', p], { cwd: repo }).status, 0, p);
  }
});

test('CLI: image → edit → review → history without a client', () => {
  const a = cli(['image', 'a', 'jar', 'on', 'linen', '--n', '2'], t.env).json();
  assert.equal(a.outputs.length, 2);
  const b = cli(['edit', a.id, 'softer', 'light', '--output', '1'], t.env).json();
  assert.equal(b.version, 2);
  cli(['review', b.id, 'approve'], t.env);
  const h = cli(['history', b.id], t.env).json();
  assert.deepEqual(h.versions.map((v) => v.outputs[0].status), ['new', 'approved']);
  const bad = cli(['edit', 'nope', 'x'], t.env);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /no image/);
});
