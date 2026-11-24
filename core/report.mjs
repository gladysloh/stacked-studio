// Shared formatting for setup and doctor: one line per item, and one "Fix:" line under a problem.

const MARK = { ok: '✓', done: '✓', unchanged: '·', planned: '→', warn: '!', fail: '✗', action: '→' };

export function renderLines(title, items) {
  const width = Math.max(...items.map((i) => i.label.length), 8) + 2;
  const lines = [title];
  for (const i of items) {
    lines.push(`${MARK[i.status] ?? ' '} ${i.label.padEnd(width)}${i.detail ?? ''}`.trimEnd());
    if (i.fix && (i.status === 'fail' || i.status === 'warn' || i.status === 'action')) {
      for (const [n, line] of String(i.fix).split('\n').entries()) lines.push(`    ${n === 0 ? 'Fix: ' : '     '}${line}`);
    }
  }
  return lines.join('\n');
}
