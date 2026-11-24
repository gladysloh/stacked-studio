// Stands in for Claude Code or Codex in tests: reads the task, prints progress events, and makes
// free test images through the real core, linked to the run (STACKED_RUN_ID). Never calls a real agent.
import { makeImage } from '../core/generate.mjs';

const task = process.argv[2] ?? '';
const say = (e) => process.stdout.write(JSON.stringify(e) + '\n');
const words = task.match(/instruction\): """([\s\S]*?)"""/)?.[1] ?? '';
say({ type: 'step', text: 'Reading the skill' });
if (words.includes('fail please')) {
  say({ type: 'done', ok: false, message: 'Could not do it.' });
  process.exit(1);
}
if (words.includes('slow')) await new Promise((r) => setTimeout(r, 5000));
const target = task.match(/image (\S+) \(output (\d+)\)/);
if (task.startsWith('Check image')) {
  const { recordCheck } = await import('../core/qa.mjs');
  recordCheck({ id: target[1], output: Number(target[2]), summary: 'Label misspelled', scores: { messaging: { score: 4, note: 'ok' }, visual_execution: { score: 2, note: 'label wrong', severity: 'major' } }, labels: [{ product: 'Serum', expected: 'SERUM', read: 'SERUN', ok: false }], suggestions: ['Re-render the label front-facing and larger.'] });
  say({ type: 'done', ok: true, message: 'Needs changes.' });
  process.exit(0);
}
if (target) {
  const mode = task.includes('mode "branch"') ? 'branch' : 'edit';
  await makeImage({ mode, parent: target[1], parent_output: Number(target[2]), prompt: words, instruction: words, what_changed: words, provider: 'test' });
} else {
  const client = task.match(/Client: ([^,.\n]+)/)?.[1];
  const project = task.match(/project: ([^.\n]+)/)?.[1];
  const n = Number(task.match(/n=(\d)/)?.[1] ?? 1);
  await makeImage({ prompt: words, instruction: words, n, client, project, provider: 'test' });
}
say({ type: 'step', text: 'Making 1 image' });
say({ type: 'done', ok: true, message: 'Made it.' });
