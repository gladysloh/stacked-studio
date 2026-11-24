import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { listGenerations, withReview } from './records.mjs';
import { mediaPath } from './media.mjs';
import { readYaml } from './fsutil.mjs';
import { clientDir, listDeliverables } from './workspace.mjs';

// Frees disk space by deleting the local copies of REJECTED versions, keeping them on Drive.
// Safety rules:
//   - every rejected version is first uploaded to Drive (02_Rejected/<code>/) if it isn't there yet;
//   - a local file is deleted only when Drive has a live (not trashed) file with the same MD5;
//   - an image still used by a kept version, a deliverable or a product is never deleted.
// Records are untouched: the version stays in history with its Drive link, and `drive_fetch`
// brings the file back if it's ever needed.

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');

function shasInUse(client, project) {
  const keep = new Set();
  for (const g of listGenerations({ client, project, limit: 100_000 })) {
    for (const i of g.inputs ?? []) keep.add(i.sha);
    for (const o of withReview(g).outputs) if (o.status !== 'rejected') keep.add(o.sha);
  }
  for (const d of listDeliverables(client, project)) for (const f of readYaml(path.join(d.dir, 'deliverable.yaml'), {})?.files ?? []) keep.add(f.sha);
  const pdir = path.join(clientDir(client), 'products');
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const n of fs.readdirSync(dir)) {
      const f = path.join(dir, n);
      if (fs.statSync(f).isDirectory()) walk(f);
      else if (n === 'product.yaml') for (const c of readYaml(f, {})?.cutouts ?? []) keep.add(c.sha), c.from && keep.add(c.from);
    }
  };
  walk(pdir);
  return keep;
}

export async function pruneRejected(client, project, { dryRun = false } = {}) {
  const { pushProjectVersions } = await import('./google/studio-drive.mjs');
  const { gfetch, hosts } = await import('./google/api.mjs');
  const pushed = dryRun ? null : await pushProjectVersions(client, project);
  const inUse = shasInUse(client, project);
  const out = { client, project, deleted: 0, bytes_freed: 0, kept_in_use: 0, not_on_drive: [], already_gone: 0, pushed: pushed ? { uploaded: pushed.uploaded, moved: pushed.moved } : null };
  for (const g0 of listGenerations({ client, project, limit: 100_000, includeTests: false })) {
    const g = withReview(g0);
    for (const [i, o] of g.outputs.entries()) {
      if (o.status !== 'rejected') continue;
      const file = mediaPath(o.sha);
      if (!file) {
        out.already_gone++;
        continue;
      }
      if (inUse.has(o.sha)) {
        out.kept_in_use++;
        continue;
      }
      const label = `${g.deliverable ?? ''} ${g.id.slice(-6)}`.trim();
      if (!o.drive_id) {
        out.not_on_drive.push(label);
        continue;
      }
      const meta = await gfetch(`${hosts().drive}/files/${o.drive_id}?fields=id,trashed,md5Checksum&supportsAllDrives=true`).catch(() => null);
      if (!meta || meta.trashed || meta.md5Checksum !== md5(file)) {
        out.not_on_drive.push(`${label} (Drive copy missing or different)`);
        continue;
      }
      const size = fs.statSync(file).size;
      if (!dryRun) fs.rmSync(file);
      out.deleted++;
      out.bytes_freed += size;
      void i;
    }
  }
  if (!dryRun) {
    const { organiseClient } = await import('./organise.mjs');
    out.folders = organiseClient(client); // removes the readable copies of what was deleted
  }
  return out;
}
