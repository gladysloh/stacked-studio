import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Writes to a temp file and renames it into place, so an interrupted write never leaves half a file. */
export function writeFileAtomic(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
  if (mode && process.platform !== 'win32') fs.chmodSync(file, mode);
}

export function writeJsonAtomic(file, value, mode) {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n', mode);
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hashFile(file) {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/** One hash for a folder: every file's relative path and content, in a stable order. */
export function hashDir(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (name === '.DS_Store') continue;
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        h.update(path.relative(dir, full).split(path.sep).join('/') + '\0');
        h.update(fs.readFileSync(full));
        h.update('\0');
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return h.digest('hex');
}

export function isWritable(dir) {
  try {
    const probe = path.join(dir, `.probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

// ---- YAML and JSONL: the human-readable record formats ----
// yaml is loaded on first use, so setup can import this file before packages are installed.
import { createRequire } from 'node:module';
let yamlMod = null;
const YAMLlib = () => (yamlMod ??= createRequire(import.meta.url)('yaml'));

export function readYaml(file, fallback = null) {
  try {
    return YAMLlib().parse(fs.readFileSync(file, 'utf8')) ?? fallback;
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`Can't read ${path.basename(file)}: ${err.message}`);
  }
}

export function writeYamlAtomic(file, value) {
  writeFileAtomic(file, YAMLlib().stringify(value, { lineWidth: 0 }));
}

/** Appends one JSON line. Append-only files merge cleanly when two teammates' copies are combined. */
export function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

export function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/** A readable folder name: "Acme Skincare" -> "acme-skincare". */
export function slugify(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}
