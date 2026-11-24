import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from './errors.mjs';
import { readYaml, slugify, writeYamlAtomic } from './fsutil.mjs';
import { importFile, mediaPath, readMedia } from './media.mjs';
import { layout, SCRATCH } from './workspace.mjs';

// The product library: clients/<client>/products/<product>/product.yaml — the exact name and label
// text, and the photos/cutouts image models must reproduce. Product shots take their inputs from here.

const dir = (client) => layout.products(client);

export function listProducts(client) {
  if (client === SCRATCH || !fs.existsSync(dir(client))) return [];
  // Single products in products/<p>/, groups (duos, line-ups) in products/_groups/<g>/.
  const at = (base, group) =>
    fs.existsSync(base)
      ? fs.readdirSync(base).filter((n) => !n.startsWith('_') && fs.existsSync(path.join(base, n, 'product.yaml'))).sort().map((slug) => {
          const p = readYaml(path.join(base, slug, 'product.yaml'), {});
          return { slug, name: p.name ?? slug, group, includes: p.includes ?? null, label_text: p.label_text ?? null, shape: p.shape ?? null, size: p.size ?? null, notes: p.notes ?? null, cutouts: (p.cutouts ?? []).map((c) => ({ ...c, file: mediaPath(c.sha) })) };
        })
      : [];
  return [...at(dir(client), false), ...at(path.join(dir(client), '_groups'), true)];
}

export function findProduct(client, ref) {
  const want = String(ref).toLowerCase();
  return listProducts(client).find((p) => p.slug === slugify(ref) || p.name.toLowerCase() === want) ?? null;
}

/**
 * Adds a product, or adds an image to an existing one. `image` is { path } or { sha }.
 * With `cutout: true` and the media tools installed, the background is removed first and the cutout
 * is stored alongside the original.
 */
export async function addProduct(client, { name, label_text, shape, size, notes, image, style = 'packshot', cutout = false, source = null }) {
  if (client === SCRATCH) throw new StudioError('Products belong to a client.', 'Pass a client.');
  if (!name?.trim()) throw new StudioError('A product needs a name.');
  const slug = slugify(name);
  const existing = listProducts(client).find((x) => x.slug === slug);
  const file = path.join(dir(client), existing?.group ? '_groups' : '', slug, 'product.yaml');
  const p = readYaml(file, null) ?? { name: name.trim(), cutouts: [] };
  if (label_text) p.label_text = label_text;
  if (shape) p.shape = shape;
  if (size) p.size = size;
  if (notes) p.notes = notes;
  p.cutouts ??= [];
  const added = [];
  if (image) {
    const m = image.path ? importFile(image.path) : readMedia(image.sha);
    if (!m) throw new StudioError("That image isn't in the local cache.", 'Pass a file path, or fetch it from Drive first.');
    const entry = { sha: m.sha, mime: m.mime, width: m.width ?? null, height: m.height ?? null, style, kind: 'photo', ...(image.name ? { name: image.name } : {}), ...(image.drive_id ? { drive_id: image.drive_id } : {}), ...(source ? { source } : {}) };
    if (!p.cutouts.some((c) => c.sha === entry.sha)) {
      p.cutouts.push(entry);
      added.push(entry);
    }
    if (cutout) {
      const { pyReady, runMedia } = await import('./py.mjs');
      if (!pyReady()) throw new StudioError('Cutouts need the media tools.', './setup.sh --with-media, then: uv sync --project py --extra cutout');
      const r = await runMedia('cutout', { sha: m.sha });
      const c = r.files?.[0];
      if (c && !p.cutouts.some((x) => x.sha === c.sha)) {
        const cut = { sha: c.sha, mime: 'image/png', width: r.width ?? null, height: r.height ?? null, style, kind: 'cutout', from: m.sha };
        // Cutouts go first: they're the cleanest input for image models.
        p.cutouts.unshift(cut);
        added.push(cut);
      }
    }
  }
  writeYamlAtomic(file, p);
  return { client, product: slug, name: p.name, label_text: p.label_text ?? null, added: added.length, images: p.cutouts.length };
}
