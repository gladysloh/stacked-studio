import fs from 'node:fs';
import path from 'node:path';
import { readYaml } from './fsutil.mjs';
import { projectDir } from './workspace.mjs';

// Project looks: projects/<p>/looks/<name>.yaml pins shared colours (sky, sea, background…) for a
// group of assets listed in applies_to, so they come out consistent. Used in prompts (generate) and
// shown as swatches on the review deck.
//
//   name: Gold Series · sea and sky
//   applies_to: [APS003, APS006]
//   light: Bright, hazy tropical sun from the upper left.
//   sky:  { words: light blue, hex: "#A3CEE7" }
//   sea:  { words: clear turquoise, hex: "#7DBCCD" }
//   sand: { words: warm light golden sand, hex: "#E0C8A7" }
// One generic colour and a short description per element keeps it simple and consistent. An element
// can be limited to some assets with `only: [codes]` (e.g. sand only where the scene has a beach).

const PARTS = ['sky', 'sea', 'sand', 'rocks', 'background', 'surface', 'water'];

/** Every look in the project, with its file: [{ ...look, file: 'looks/<name>.yaml' }]. */
export function listLooks(client, project) {
  const dir = path.join(projectDir(client, project), 'looks');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((x) => x.endsWith('.yaml'))
    .sort()
    .map((n) => ({ ...readYaml(path.join(dir, n), {}), file: `looks/${n}` }))
    .filter((l) => l.name);
}

export function lookForCode(client, project, code) {
  const dir = path.join(projectDir(client, project), 'looks');
  if (!code || !fs.existsSync(dir)) return null;
  for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.yaml')).sort()) {
    const l = readYaml(path.join(dir, n), null);
    if (l?.applies_to?.some((c) => String(c).toLowerCase() === String(code).toLowerCase())) return { ...l, file: `looks/${n}` };
  }
  return null;
}

/** The prompt block for a look: words plus colour values, never to be printed. */
export function lookPromptBlock(l, code = null) {
  const forCode = (x) => !x?.only || !code || x.only.some((c) => String(c).toLowerCase() === String(code).toLowerCase());
  const label = (k) => k[0].toUpperCase() + k.slice(1);
  const part = (k) => {
    const x = l[k];
    if (!x || !forCode(x)) return null;
    return `${label(k)}: ${x.words ?? ''}${x.hex ? ` (colour ${x.hex})` : ''}.`;
  };
  return [`COLOUR PALETTE for this group of assets (${l.name}): keep these colours. The colour values are for matching only; never print them.`, l.light ? `Light: ${l.light}` : null, ...PARTS.map(part)].filter(Boolean).join('\n');
}

/** One swatch per element for display: [{ part, words, hex }]. */
export function lookSwatches(l, code = null) {
  const forCode = (x) => !x?.only || !code || x.only.some((c) => String(c).toLowerCase() === String(code).toLowerCase());
  return PARTS.filter((k) => l?.[k]?.hex && forCode(l[k])).map((k) => ({ part: k, words: l[k].words ?? '', hex: l[k].hex }));
}
