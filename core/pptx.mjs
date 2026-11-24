import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StudioError } from './errors.mjs';
import { readYaml, writeFileAtomic, writeYamlAtomic } from './fsutil.mjs';
import { putMedia } from './media.mjs';
import { which } from './paths.mjs';
import { deliverableDir, layout, listDeliverables, listProjects } from './workspace.mjs';
import * as sectionsMod from './sections.mjs';
const await_sections = () => sectionsMod;

// Reads a deck downloaded from Google Slides as PowerPoint (.pptx): the text, shapes and original
// images of every slide, with their positions. An asset slide (with a code like ABC006) is read
// the way it is laid out: the main visual under "Creative Idea" (a past generation), the
// description and colour palette in the middle, and the lighting notes and reference images on the
// right. Images on other slides become the client's style references. Logos and template graphics
// (the same image on many slides) and tiny images are skipped.

const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const CODE = /^\s*([A-Z]{2,5}\d{2,4})\s*$/;
const MIN_BYTES = 15_000;

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Only the slide layouts are unpacked (a few MB). Images are read straight from the deck file
// one at a time, so a large deck never needs its full size again on disk.
function unzip(file) {
  if (!which('unzip')) throw new StudioError('The "unzip" command is needed to read .pptx files.', 'On Linux: install unzip (e.g. sudo apt install unzip).');
  if (!fs.existsSync(file)) throw new StudioError(`There's no file at ${file}.`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacked-pptx-'));
  const r = spawnSync('unzip', ['-q', '-o', file, 'ppt/presentation.xml', 'ppt/_rels/*', 'ppt/slides/*', '-d', dir], { encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new StudioError("Couldn't open that file as a PowerPoint deck.");
  }
  return dir;
}

/** Reads one file from inside the deck without unpacking anything else. */
function readFromDeck(deckFile, inner) {
  const r = spawnSync('unzip', ['-p', deckFile, inner], { maxBuffer: 200 * 1024 * 1024 });
  return r.status === 0 && r.stdout?.length ? r.stdout : null;
}

function rels(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const xml = fs.readFileSync(file, 'utf8');
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/\bId="([^"]+)"/)?.[1];
    const target = m[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) out[id] = target;
  }
  return out;
}

const textOf = (xml) =>
  xml
    .split(/<\/a:p>/)
    .map((para) => [...para.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1])).join(''))
    .map((l) => l.trim())
    .filter(Boolean);

/** Shapes on a slide in 0–100 units across (y in the same units), with text, image or fill colour. */
function shapesOf(xml, slideRels, slideDir, width, media) {
  const scale = 100 / width;
  const out = [];
  for (const m of xml.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g)) {
    const s = m[0];
    const off = s.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/);
    const ext = s.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/);
    const box = off && ext ? { x: +off[1] * scale, y: +off[2] * scale, w: +ext[1] * scale, h: +ext[2] * scale } : null;
    const rid = s.match(/r:embed="([^"]+)"/)?.[1];
    // Image targets are relative to ppt/slides/, e.g. ../media/image5.png → ppt/media/image5.png
    const target = rid && slideRels[rid] ? path.posix.normalize(path.posix.join('ppt/slides', slideRels[rid])) : null;
    const fill = s.match(/<p:spPr>[\s\S]*?<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/)?.[1] ?? null;
    out.push({ kind: m[1], box, lines: textOf(s), image: target && IMAGE_EXT[path.extname(target).toLowerCase()] && media.has(target) ? target : null, fill });
  }
  return out;
}

/** Slides in presentation order, each with its text, code and positioned shapes. */
export function readPptx(file) {
  const dir = unzip(file);
  try {
    const ppt = path.join(dir, 'ppt');
    const pres = fs.readFileSync(path.join(ppt, 'presentation.xml'), 'utf8');
    const width = Number(pres.match(/<p:sldSz[^>]*cx="(\d+)"/)?.[1] ?? 9144000);
    const presRels = rels(path.join(ppt, '_rels', 'presentation.xml.rels'));
    const order = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => presRels[m[1]]).filter(Boolean);
    const list = spawnSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    const media = new Set((list.stdout ?? '').split('\n').filter((l) => l.startsWith('ppt/media/')));
    const slides = order.map((target, i) => {
      const slideFile = path.join(ppt, target);
      const xml = fs.readFileSync(slideFile, 'utf8');
      const slideRels = rels(path.join(path.dirname(slideFile), '_rels', path.basename(slideFile) + '.rels'));
      const shapes = shapesOf(xml, slideRels, path.dirname(slideFile), width, media);
      const lines = textOf(xml);
      const codes = [...new Set(lines.map((l) => l.match(CODE)?.[1]).filter(Boolean))];
      return { number: i + 1, lines, codes, code: codes[0] ?? null, shapes, images: shapes.filter((s) => s.image).map((s) => s.image) };
    });
    // A slide can carry a leftover code box from the slide it was copied from (e.g. every slide
    // after ABC012 still says ABC012 next to its own code). The code on the fewest slides wins.
    const freq = new Map();
    for (const s of slides) for (const c of s.codes) freq.set(c, (freq.get(c) ?? 0) + 1);
    for (const s of slides) if (s.codes.length > 1) s.code = [...s.codes].sort((a, b) => freq.get(a) - freq.get(b))[0];
    fs.rmSync(dir, { recursive: true, force: true });
    return { slides };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err instanceof StudioError ? err : new StudioError("Couldn't read that deck file. Download it again from Google Slides (File › Download › Microsoft PowerPoint).");
  }
}

const findLabel = (shapes, re) => shapes.find((s) => s.box && s.lines.length === 1 && re.test(s.lines[0]));

/**
 * Reads an asset slide the way it's laid out. Uses the slide's own labels to find the columns,
 * so it follows the template rather than fixed positions.
 */
export function readAssetSlide(slide) {
  const shapes = slide.shapes;
  const idea = findLabel(shapes, /^creative idea:?$/i);
  const desc = findLabel(shapes, /^description:?$/i);
  const light = findLabel(shapes, /^lighting references?:?$/i);
  const palette = findLabel(shapes, /colou?r palette/i);
  const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  // "AI ASSET" + "V1" + "V2" → "AI asset V2": the slide shows its latest version.
  const kind = slide.lines.find((l) => /^(ai asset|live|reference|live product|talent)$/i.test(l));
  const versions = slide.lines.map((l) => l.match(/^v(\d+)$/i)?.[1]).filter(Boolean).map(Number);
  const KIND = { 'ai asset': 'AI asset', live: 'Live', reference: 'Reference', 'live product': 'Live product', talent: 'Talent' };
  const label = [kind ? KIND[kind.toLowerCase()] : null, versions.length ? `V${Math.max(...versions)}` : null].filter(Boolean).join(' ') || null;

  // Text: the largest text box just under each label, in the same column.
  const textUnder = (lab, maxDx = 12) => {
    if (!lab) return null;
    const cands = shapes.filter((s) => s.box && s !== lab && s.lines.length && !s.image && s.box.y >= lab.box.y && s.box.y <= lab.box.y + 8 && Math.abs(s.box.x - lab.box.x) <= maxDx);
    const best = cands.sort((a, b) => b.lines.join(' ').length - a.lines.join(' ').length)[0];
    const t = best?.lines.join('\n').trim();
    return t && t.length > 3 ? t : null;
  };

  const roles = [];
  for (const s of shapes) {
    if (!s.image) continue;
    if (!s.box) {
      roles.push({ file: s.image, role: 'other' });
      continue;
    }
    if (s.box.w < 4 || s.box.h < 4) continue; // icons
    const c = centre(s.box);
    let role = 'other';
    // Without a "Description" label, the main visual is the large image in the left column under "Creative Idea".
    const leftEdge = Math.min(...[palette, light, desc].filter(Boolean).map((l) => l.box.x), 50);
    if (desc && c.x < desc.box.x) role = 'visual';
    else if (!desc && idea && c.x < leftEdge && s.box.w >= 12 && s.box.y >= idea.box.y) role = 'visual';
    else if (light && c.x >= light.box.x - 4 && c.x < light.box.x + 19) role = 'lighting';
    else if (light && c.x >= light.box.x + 19) role = 'reference';
    else if (desc && c.x >= desc.box.x) role = 'reference';
    roles.push({ file: s.image, role });
  }
  const colours = palette
    ? shapes
        .filter((s) => s.fill && s.box && s.box.y >= palette.box.y && s.box.y <= palette.box.y + 14 && s.box.x >= palette.box.x - 2 && s.box.x <= palette.box.x + 30 && s.box.w >= 1.5)
        .sort((a, b) => a.box.x - b.box.x)
        .map((s) => `#${s.fill.toUpperCase()}`)
    : [];
  return {
    label,
    creative_idea: textUnder(idea),
    description: textUnder(desc),
    lighting: textUnder(light, 6),
    palette: [...new Set(colours)],
    images: roles,
  };
}

/**
 * Saves a .pptx into the studio for a deck: each asset slide's images (by role), text and palette
 * to its asset; other slides' images to the client's style references; every slide's text.
 * Importing again replaces what came from the deck before, so it always matches the latest file.
 */

const ROLE_NAME = { visual: 'Earlier version', lighting: 'Lighting reference', reference: 'Reference', mood: 'Section mood', overview: 'Creative overview', other: 'Slide image' };

/** Which project a deck belongs to: given, or the one whose project.yaml names the deck, or the only one. */
function projectFor(client, project, deckTitle) {
  const ps = listProjects(client);
  if (project) {
    const hit = ps.find((p) => p.slug === project || String(p.name).toLowerCase() === String(project).toLowerCase());
    if (!hit) throw new StudioError(`There's no project "${project}" for ${client}.`);
    return hit.slug;
  }
  const byDeck = ps.filter((p) => p.deck && deckTitle && deckTitle.toLowerCase().includes(String(p.name).toLowerCase()));
  if (byDeck.length === 1) return byDeck[0].slug;
  if (ps.length === 1) return ps[0].slug;
  throw new StudioError('Which project is this deck for?', `Pass a project: ${ps.map((p) => p.slug).join(', ')}`);
}

/**
 * Imports a deck downloaded from Google Slides as PowerPoint into the client folder:
 *   - each asset slide (with a code like ABC006) → that deliverable: its images by role (earlier
 *     versions, lighting, references), and its creative idea, description, lighting and palette
 *     added to the deliverable's brief where missing;
 *   - a section's mood and overview slides → every deliverable in that section;
 *   - other images → library/references (from the deck, untagged).
 * Logos and template graphics (on many slides) and tiny images are skipped. Importing again
 * replaces what an earlier import of a deck file added; uploads and other files stay.
 */
/** The client's working deck: the linked Google Slides deck that is the source of truth. */
export function workingDecks(client) {
  const links = readYaml(layout.clientYaml(client), {})?.links?.decks ?? [];
  return links.filter((d) => typeof d === 'object' && d.working !== false);
}

const norm = (t) => String(t).toLowerCase().replace(/^copy of\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function importPptx(client, file, { project, force = false } = {}) {
  const deckTitle = path.basename(file, '.pptx').replace(/^Copy of /i, '');
  // Images must come from a download of the working deck, so the files match what the team follows.
  const working = workingDecks(client);
  const match = working.find((d) => norm(d.title ?? '') === norm(deckTitle));
  if (working.length && !match && !force) {
    throw new StudioError(
      `"${path.basename(file)}" doesn't look like a download of ${client}'s working deck (${working.map((d) => d.title).join(', ')}).`,
      'Download the working deck itself (File › Download › Microsoft PowerPoint), or pass --force if this file is right.'
    );
  }
  const { slides } = readPptx(file);
  const proj = projectFor(client, project, deckTitle);
  const dels = new Map(listDeliverables(client, proj).map((d) => [d.code.toUpperCase(), d]));
  const counts = { project: proj, slides: slides.length, asset_slides: 0, deliverables: new Set(), deliverable_images: 0, earlier_versions: 0, section_images: 0, references: 0, skipped: 0, created: [] };

  const seen = new Map();
  for (const s of slides) for (const f of new Set(s.images.map((x) => path.basename(x)))) seen.set(f, (seen.get(f) ?? 0) + 1);
  const template = (f) => slides.length >= 5 && (seen.get(path.basename(f)) ?? 0) > Math.max(3, slides.length * 0.15);
  const stored = new Map();
  const store = (f) => {
    if (stored.has(f)) return stored.get(f);
    const data = readFromDeck(file, f);
    const mime = IMAGE_EXT[path.extname(f).toLowerCase()];
    const m = data && data.length >= MIN_BYTES && mime ? putMedia(data, mime) : null;
    stored.set(f, m);
    return m;
  };

  // Asset slides, read by layout.
  const read = new Map(slides.filter((s) => s.code).map((s) => [s.number, readAssetSlide(s)]));
  const colourCount = new Map();
  for (const a of read.values()) for (const c of a.palette) colourCount.set(c, (colourCount.get(c) ?? 0) + 1);
  const templateColour = (c) => read.size >= 5 && colourCount.get(c) > read.size * 0.6;

  // Collected per deliverable, then written once.
  const add = new Map(); // code -> { files:[], slide:{} }
  const want = (code) => add.get(code) ?? add.set(code, { files: [], slides: [] }).get(code);
  const pushFile = (code, m, role, slide) => {
    const w = want(code);
    if (!w.files.some((f) => f.sha === m.sha && f.role === role)) w.files.push({ sha: m.sha, mime: m.mime, width: m.width ?? null, height: m.height ?? null, role, slide, name: `${ROLE_NAME[role]} · slide ${slide}`, source: 'deck-file' });
  };

  // Sections: a short all-capitals title slide starts one; its asset slides and its mood/overview
  // slides belong together. Repeated titles (e.g. live assets later) join the same section.
  const lineCount = new Map();
  for (const s of slides) for (const l of new Set(s.lines)) lineCount.set(l, (lineCount.get(l) ?? 0) + 1);
  const content = (s) => s.lines.filter((l) => !(slides.length >= 5 && lineCount.get(l) > slides.length * 0.3));
  const isTitle = (s) => {
    const t = (content(s)[0] ?? '').replace(/\s+/g, ' ').trim();
    return !s.code && s.images.length <= 2 && content(s).length <= 3 && t.length >= 3 && t.length <= 60 && t === t.toUpperCase() && /[A-Z]/.test(t) && !/^(CREATIVE|\d+)$/.test(t) ? t : null;
  };
  const sections = new Map();
  let current = null;
  const loose = [];
  for (const s of slides) {
    const title = isTitle(s);
    if (title) {
      current = title;
      if (!sections.has(current)) sections.set(current, { codes: new Set(), moods: [] });
      continue;
    }
    if (s.code) {
      let d = dels.get(s.code.toUpperCase());
      if (!d) {
        // A deliverable in the deck that the project doesn't have yet: create it.
        const dir = deliverableDir(client, proj, s.code, { create: true, title: current ? current.toLowerCase() : undefined });
        d = { code: s.code, folder: path.basename(dir), dir };
        dels.set(s.code.toUpperCase(), d);
        counts.created.push(s.code);
      }
      if (current) sections.get(current).codes.add(d.code);
      const a = read.get(s.number);
      a.palette = a.palette.filter((c) => !templateColour(c));
      want(d.code).slides.push({ slide: s.number, ...a });
      counts.asset_slides++;
      for (const img of a.images) {
        const m = template(img.file) ? null : store(img.file);
        if (!m) {
          counts.skipped++;
          continue;
        }
        pushFile(d.code, m, img.role, s.number);
        counts.deliverable_images++;
        if (img.role === 'visual') counts.earlier_versions++;
      }
      continue;
    }
    const imgs = s.images.filter((f) => !template(f));
    counts.skipped += s.images.length - imgs.length;
    if (!imgs.length) continue;
    const role = /^\s*CREATIVE\b/i.test(s.lines.join(' ')) ? 'overview' : 'mood';
    if (current) sections.get(current).moods.push({ slide: s.number, imgs, role });
    else loose.push({ slide: s.number, imgs, text: content(s)[0] ?? '' });
  }
  const sectionImages = [];
  for (const [secName, sec] of sections) {
    for (const mood of sec.moods) {
      for (const f of mood.imgs) {
        const m = store(f);
        if (!m) {
          counts.skipped++;
          continue;
        }
        if (!sec.codes.size) {
          loose.push({ slide: mood.slide, imgs: [f], text: '' });
          continue;
        }
        sectionImages.push({ section: secName, codes: [...sec.codes], sha: m.sha, mime: m.mime, width: m.width ?? null, height: m.height ?? null, role: mood.role, slide: mood.slide });
        counts.section_images++;
      }
    }
  }

  // Write deliverables: replace earlier deck-file entries, keep everything else.
  for (const [code, w] of add) {
    const d = dels.get(code.toUpperCase());
    const yfile = path.join(d.dir, 'deliverable.yaml');
    const meta = readYaml(yfile, {}) ?? {};
    const keep = (meta.files ?? []).filter((f) => f.source !== 'deck-file' && !w.files.some((n) => n.sha === f.sha && n.role === f.role));
    meta.code ??= d.code;
    meta.files = [...keep, ...w.files];
    if (w.slides.length) meta.slides = w.slides.map(({ images, ...rest }) => rest);
    writeYamlAtomic(yfile, meta);
    counts.deliverables.add(code);
    // Brief: add the slide's creative text where the brief doesn't have it yet.
    const bfile = path.join(d.dir, 'brief.md');
    let brief = fs.existsSync(bfile) ? fs.readFileSync(bfile, 'utf8') : `# ${d.code}\n`;
    const a = w.slides[0];
    const addSection = (name, text) => {
      if (text && !new RegExp(`^##\\s*${name}\\b`, 'mi').test(brief)) brief = `${brief.trimEnd()}\n\n## ${name}\n\n${text}\n`;
    };
    if (a) {
      addSection('Creative idea', a.creative_idea);
      addSection('Description', a.description);
      addSection('Lighting', a.lighting);
      addSection('Colour palette', a.palette?.length ? a.palette.join(', ') : null);
      if (a.label) addSection('Status in deck', a.label);
      writeFileAtomic(bfile, brief);
    }
  }

  // Section mood and overview images: stored once for the project, shared by its deliverables.
  const { saveSections } = await_sections();
  counts.sections = saveSections(client, proj, sectionImages, 'deck-file');

  // Loose images → library references (from the deck).
  const rfile = layout.references(client);
  const refs = readYaml(rfile, {}) ?? {};
  refs.items ??= [];
  for (const l of loose) {
    for (const f of l.imgs) {
      const m = store(f);
      if (!m) continue;
      if (refs.items.some((r) => r.sha === m.sha)) continue;
      refs.items.push({ sha: m.sha, mime: m.mime, width: m.width ?? null, height: m.height ?? null, kind: 'reference', name: `Slide ${l.slide}${l.text ? ` · ${l.text.slice(0, 60)}` : ''}`, source: deckTitle, added: new Date().toISOString() });
      counts.references++;
    }
  }
  writeYamlAtomic(rfile, refs);
  // Note on the deck which download the images came from.
  if (match?.slides_id) {
    const deckDir = fs.existsSync(layout.decks(client)) ? fs.readdirSync(layout.decks(client)).find((n) => readYaml(path.join(layout.decks(client), n, 'deck.yaml'), {})?.slides_id === match.slides_id) : null;
    if (deckDir) {
      const y = path.join(layout.decks(client), deckDir, 'deck.yaml');
      writeYamlAtomic(y, { ...readYaml(y, {}), images_from: { file: path.basename(file), imported: new Date().toISOString(), slides: slides.length } });
    }
  }
  return { ...counts, working_deck: match?.url ?? null, deliverables: counts.deliverables.size, images_stored: [...stored.values()].filter(Boolean).length };
}
