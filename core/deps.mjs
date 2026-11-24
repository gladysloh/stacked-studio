import fs from 'node:fs';
import path from 'node:path';
import { hashFile, readJson, writeFileAtomic } from './fsutil.mjs';
import { repoRoot } from './paths.mjs';

// Packages count as installed when every dependency folder exists and the marker file in
// node_modules matches the current package-lock.json. An interrupted install leaves no marker,
// so the next setup run installs again.

const LOCK = path.join(repoRoot, 'package-lock.json');
const MARKER = path.join(repoRoot, 'node_modules', '.stacked-deps');

export function depsInstalled() {
  const pkg = readJson(path.join(repoRoot, 'package.json'), {});
  const names = Object.keys(pkg.dependencies ?? {});
  const allThere = names.every((n) => fs.existsSync(path.join(repoRoot, 'node_modules', n, 'package.json')));
  let marker = null;
  try {
    marker = fs.readFileSync(MARKER, 'utf8').trim();
  } catch {}
  return allThere && marker === hashFile(LOCK);
}

export function markDepsInstalled() {
  writeFileAtomic(MARKER, hashFile(LOCK) + '\n');
}
