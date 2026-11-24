// The Workbench: clients → projects → deliverables → images. View, upload, organise, make, refine,
// check, compare and approve. Plain ES module, no build step.
// Routes: #/  #/c/<client>  #/c/<client>/p/<project>  #/c/<client>/p/<project>/d/<code>
//         #/image/<id>[/<output>]  #/compare/<id:out>,<id:out>  #/all

const $ = (sel) => document.querySelector(sel);
// Optional parts are written as `cond ? el : null`: never render empty slots as text.
const replaceChildren = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) {
  return replaceChildren.apply(this, kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
};
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}
async function api(path, body) {
  const res = await fetch(`/api/${path}`, body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.fix ? `${json.error} ${json.fix}` : json.error);
  return json;
}
const media = (sha) => (sha ? `/media/${sha}` : '');
const STATUS = { new: 'Needs review', approved: 'Approved', rejected: 'Rejected', not_started: 'Not started', in_progress: 'In progress' };
const badge = (s) => h('span', { class: `badge ${s}` }, STATUS[s] ?? s);
const enc = encodeURIComponent;
const thumb = (sha, alt = '') => (sha ? h('img', { src: media(sha), alt, loading: 'lazy' }) : h('div', { class: 'noimg' }, 'No image yet'));
const ui = { picked: new Set(), seenRuns: new Set(), started: false, filter: '' };

function setMeta(m) {
  if (!m) return;
  $('#meta').textContent = [m.agent ?? 'No agent found', m.providers?.length ? m.providers.join(', ') : 'Test images', `$${Number(m.spent_today ?? 0).toFixed(2)} of $${m.daily_cap} today`].join(' · ');
  if (m.runs) renderRuns(m.runs);
}
function crumbs(...parts) {
  $('#crumbs').replaceChildren(...parts.flatMap((p, i) => [i ? h('span', { class: 'muted' }, ' / ') : null, p.href ? h('a', { href: p.href }, p.label) : h('span', {}, p.label)]));
}

/** Minimal, safe markdown: headings, bullets, paragraphs. */
function md(text) {
  const out = h('div', { class: 'md' });
  for (const block of String(text ?? '').split(/\n{2,}/)) {
    const t = block.trim();
    if (!t) continue;
    const head = t.match(/^(#{1,3})\s+(.*)$/);
    if (head) out.append(h(`h${Math.min(4, head[1].length + 2)}`, {}, head[2]));
    else if (/^[-*]\s/m.test(t)) out.append(h('ul', {}, ...t.split('\n').map((l) => h('li', {}, l.replace(/^[-*]\s+/, '')))));
    else out.append(h('p', {}, t));
  }
  return out;
}

// ---------- Clients ----------
async function home() {
  const d = await api('overview');
  setMeta(d);
  crumbs({ label: 'Clients' });
  $('#view').replaceChildren(
    h('div', { class: 'row head' }, h('h2', {}, 'Clients'), h('span', { class: 'grow' }), h('a', { href: '#/all', class: 'btn' }, 'All images')),
    h('div', { class: 'grid cards' },
      ...d.clients.map((c) => h('a', { class: 'tile', href: `#/c/${enc(c.slug)}` }, thumb(c.cover, c.name), h('div', { class: 'cap' }, h('b', {}, c.name), h('span', { class: 'muted' }, `${c.projects} project${c.projects === 1 ? '' : 's'} · ${c.images} images`)))),
      h('a', { class: 'tile', href: '#/c/_scratch' }, h('div', { class: 'noimg' }, 'No client'), h('div', { class: 'cap' }, h('b', {}, 'No client'), h('span', { class: 'muted' }, d.scratch_inbox ? `${d.scratch_inbox} in inbox` : 'Scratch work')))),
    d.clients.length ? null : h('p', { class: 'muted' }, 'No clients yet. Add one with `studio client new "<name>"` or import a client pack.'));
}

// ---------- Client ----------
async function clientView(client) {
  const d = await api(`client/${enc(client)}`);
  setMeta(d);
  crumbs({ label: 'Clients', href: '#/' }, { label: d.client.name });
  const lib = d.library ?? {};
  const view = $('#view');
  view.replaceChildren(
    h('div', { class: 'row head' }, h('h2', {}, d.client.name), d.client.industry ? h('span', { class: 'muted' }, d.client.industry) : null, h('span', { class: 'grow' }),
      d.drive_folder ? h('a', { class: 'btn', href: d.drive_folder, target: '_blank', rel: 'noopener' }, 'Drive folder') : null,
      h('button', { onclick: () => api('open', { client }) }, 'Open folder')),
    h('h3', {}, 'Projects'),
    d.projects.length
      ? h('div', { class: 'grid cards' }, ...d.projects.map((p) => h('a', { class: 'tile', href: `#/c/${enc(client)}/p/${enc(p.slug)}` }, thumb(p.cover, p.name),
          h('div', { class: 'cap col' }, h('b', {}, p.name), h('span', { class: 'muted' }, p.deliverables != null ? `${p.deliverables} deliverables · ${p.images} images` : ''),
            p.by_status ? h('span', { class: 'row' }, ...Object.entries(p.by_status).map(([s, n]) => h('span', { class: `badge ${s}` }, `${n} ${STATUS[s] ?? s}`))) : null))))
      : h('p', { class: 'muted' }, 'No projects yet. Share a brief with your agent ("set up a project from this brief") or make an image for this client.'),
    inboxSection(client, d),
    client === '_scratch' ? null : h('div', { class: 'row lib' },
      ...[['brand', 'Brand', null], ['products', 'Products', lib.products], ['library/references', 'References', lib.references], ['library/past-work', 'Past work', lib.past_work], ['library/moodboards', 'Moodboards', lib.boards]].map(([sub, label, n]) =>
        h('button', { class: 'stat', onclick: () => api('open', { client, sub }).catch(() => alert(`No ${label.toLowerCase()} yet.`)) }, h('b', {}, n == null ? '↗' : String(n)), h('span', {}, label)))),
    client === '_scratch' ? null : driveSection(client, d));
}

function inboxSection(client, d) {
  const note = h('input', { placeholder: 'Note for these images (optional): e.g. "new serum packshots" or "refs for D01"', 'aria-label': 'Note', class: 'grow' });
  const status = h('span', { class: 'muted' });
  const picker = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, hidden: true, onchange: (e) => upload([...e.target.files]) });
  async function upload(files) {
    files = files.filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    for (const [i, f] of files.entries()) {
      status.textContent = `Uploading ${i + 1} of ${files.length}…`;
      const res = await fetch(`/api/upload?client=${enc(client)}&name=${enc(f.name)}&note=${enc(note.value)}`, { method: 'POST', body: f });
      if (!res.ok) status.textContent = (await res.json()).error;
    }
    clientView(client);
  }
  const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Upload images',
    onclick: () => picker.click(), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && picker.click(),
    ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); },
    ondragleave: (e) => e.currentTarget.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); upload([...e.dataTransfer.files]); } },
    'Drop images here, or click to choose');
  const items = d.inbox ?? [];
  const fileAs = (it) => {
    const sel = h('select', { 'aria-label': `File ${it.name} as` }, ...[['', 'File as…'], ['product', 'Product photo'], ['reference', 'Reference'], ['logo', 'Logo'], ['past_work', 'Past work'], ['discard', 'Discard']].map(([v, l]) => h('option', { value: v }, l)));
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const extra = sel.value === 'product' ? { product: prompt('Product name?') ?? '' } : {};
      if (sel.value === 'product' && !extra.product) return (sel.value = '');
      await api('inbox', { client, items: [{ name: it.name, as: sel.value, ...extra }] });
      clientView(client);
    });
    return sel;
  };
  return h('section', { class: 'card inbox' },
    h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, `Inbox${items.length ? ` · ${items.length}` : ''}`), h('span', { class: 'grow' }), status,
      items.length ? h('button', { class: 'primary', onclick: async () => { await api('runs', { kind: 'organise', text: note.value, client }); poll(); } }, 'Organise with agent') : null),
    h('div', { class: 'row' }, note), drop, picker,
    items.length ? h('div', { class: 'grid small' }, ...items.map((it) => h('div', { class: 'tile' }, h('img', { src: media(it.sha), alt: it.name, loading: 'lazy' }), h('div', { class: 'cap col' }, h('span', { class: 'clip' }, it.name), it.note ? h('span', { class: 'muted clip' }, it.note) : null, fileAs(it))))) : null);
}

function driveSection(client, d) {
  const parts = [['brand', 'Logos'], ['products', 'Products'], ['library', 'Library (references, past work, moodboards)'], ['final', 'Approved images'], ['versions', 'All versions'], ['references', 'Deck references']];
  const checks = parts.map(([v, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: v, checked: ['brand', 'products', 'library', 'final'].includes(v) }), l));
  const out = h('span', { class: 'muted' });
  const ready = d.google?.connected && d.drive_folder;
  return h('section', { class: 'card' }, h('h3', {}, 'Upload to Drive'),
    ready
      ? h('div', {}, h('div', { class: 'row' }, ...checks), h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'primary', onclick: async (e) => {
            e.target.disabled = true;
            out.textContent = 'Uploading…';
            try {
              const r = await api('drive-push', { client, parts: checks.map((c) => c.firstChild).filter((i) => i.checked).map((i) => i.value) });
              out.textContent = `Uploaded ${r.uploaded}, already there ${r.already}.`;
            } catch (err) { out.textContent = err.message; }
            e.target.disabled = false;
          } }, 'Upload'), out))
      : h('p', { class: 'muted' }, !d.google?.configured ? 'Google is not set up for this team yet (docs/google-setup.md).' : !d.google?.connected ? 'Connect Google first: studio connect google' : `This client has no Drive folder yet: studio drive init ${client}`));
}

// ---------- Project ----------
async function projectView(client, project) {
  const d = await api(`project/${enc(client)}/${enc(project)}`);
  setMeta(d);
  const cname = client === '_scratch' ? 'No client' : client;
  crumbs({ label: 'Clients', href: '#/' }, { label: cname, href: `#/c/${enc(client)}` }, { label: d.name });
  const q = h('input', { placeholder: 'Find a deliverable: code, product, message…', 'aria-label': 'Find', class: 'grow', value: ui.find ?? '' });
  const filters = h('div', { class: 'filters' }, ...[['', 'All'], ['not_started', 'Not started'], ['in_progress', 'In progress'], ['approved', 'Approved']].map(([v, l]) => h('button', { 'aria-pressed': String(ui.filter === v), onclick: () => ((ui.filter = v), projectView(client, project)) }, l)));
  const grid = h('div', { class: 'grid cards' });
  const render = () => {
    const words = q.value.toLowerCase();
    const list = d.deliverables.filter((x) => (!ui.filter || x.status === ui.filter) && (!words || `${x.code} ${x.product} ${x.key_message}`.toLowerCase().includes(words)));
    grid.replaceChildren(...list.map((x) => h('a', { class: 'tile', href: `#/c/${enc(client)}/p/${enc(project)}/d/${enc(x.code)}` }, thumb(x.thumb, x.code),
      h('div', { class: 'cap col' }, h('span', { class: 'row' }, h('b', {}, x.code), h('span', { class: 'grow' }), badge(x.status)), x.product ? h('span', { class: 'clip' }, x.product) : null, x.key_message ? h('span', { class: 'muted clip' }, x.key_message) : null, h('span', { class: 'muted' }, x.thumb_kind === 'deck' ? 'Deck image' : `${x.images} image${x.images === 1 ? '' : 's'}`)))));
    if (!list.length) grid.replaceChildren(h('div', { class: 'empty' }, d.deliverables.length ? 'Nothing matches.' : 'No deliverables in this project yet.'));
  };
  q.addEventListener('input', () => ((ui.find = q.value), render()));
  render();
  $('#view').replaceChildren(
    h('div', { class: 'row head' }, h('h2', {}, d.name), badge(d.status === 'active' ? 'in_progress' : d.status), h('span', { class: 'grow' }), h('button', { onclick: () => api('open', { client, sub: `projects/${project}` }) }, 'Open folder')),
    d.brief ? h('details', { class: 'card' }, h('summary', {}, 'Brief'), md(d.brief)) : null,
    h('div', { class: 'row' }, filters, q), grid);
}

// ---------- Deliverable ----------
async function deliverableView(client, project, code) {
  const d = await api(`deliverable/${enc(client)}/${enc(project)}/${enc(code)}`);
  setMeta(d);
  crumbs({ label: 'Clients', href: '#/' }, { label: client === '_scratch' ? 'No client' : client, href: `#/c/${enc(client)}` }, { label: project, href: `#/c/${enc(client)}/p/${enc(project)}` }, { label: code });
  const ask = h('textarea', { placeholder: `Describe an image for ${code}… (the brief, products and brand rules are used automatically)`, 'aria-label': 'New image' });
  const n = h('select', { 'aria-label': 'How many' }, ...[1, 2, 3, 4].map((x) => h('option', { value: x }, `${x} image${x > 1 ? 's' : ''}`)));
  const open = d.comments.filter((c) => !c.resolved);
  $('#view').replaceChildren(
    h('div', { class: 'row head' }, h('h2', {}, code), badge(d.status), h('span', { class: 'grow' }), h('button', { onclick: () => api('open', { client, sub: d.folder }).catch(() => {}) }, 'Open folder')),
    h('div', { class: 'two' },
      h('div', { class: 'col gap' },
        h('div', { class: 'card' }, h('h3', {}, 'New image'), ask, h('div', { class: 'row', style: 'margin-top:8px' }, n, h('button', { class: 'primary', onclick: async () => {
          if (!ask.value.trim()) return ask.focus();
          await api('runs', { kind: 'new', text: ask.value, client, project, deliverable: code, n: Number(n.value) });
          ask.value = '';
          poll();
        } }, 'Make'))),
        reviewCard(client, project, code, d),
        h('div', { class: 'card' }, h('h3', {}, `Image histories${d.images.length ? ` · ${d.images.filter((im) => im.outputs.some((o) => o.status !== 'rejected')).length}` : ''}`),
          d.images.some((im) => im.outputs.some((o) => o.status !== 'rejected'))
            ? h('div', { class: 'grid small' }, ...d.images.filter((im) => im.outputs.some((o) => o.status !== 'rejected')).map((im) => h('a', { class: 'tile', href: `#/image/${im.id}` }, thumb(im.outputs[0]?.sha), h('div', { class: 'cap' }, h('span', {}, `v${im.version}${im.concept ? ` · ${im.concept}` : ''}`), badge(im.outputs.find((o) => o.status === 'approved') ? 'approved' : im.outputs[0]?.status ?? 'new')))))
            : h('p', { class: 'muted' }, 'No images yet.')),
        d.concepts?.length ? h('div', { class: 'card' }, h('h3', {}, `Concepts · ${d.concepts.length}`), ...d.concepts.map((c) => h('details', {}, h('summary', {}, c.file.replace(/\.md$/, '')), md(c.text.replace(/^---[\s\S]*?---/, ''))))) : null,
        Object.keys(d.deck_images).length ? h('div', { class: 'card' }, h('h3', {}, 'From the deck'),
          ...Object.entries(d.deck_images).map(([role, shas]) => h('div', {}, h('p', { class: 'muted' }, `${role[0].toUpperCase()}${role.slice(1)} · ${shas.length}`), h('div', { class: 'strip' }, ...shas.map((s) => h('a', { href: media(s), target: '_blank', rel: 'noopener' }, h('img', { src: media(s), alt: role, loading: 'lazy' }))))))) : null),
      h('div', { class: 'col gap' },
        notesCard(client, project, code, d),
        h('div', { class: 'card' }, h('h3', {}, 'Brief'), d.brief ? md(d.brief) : h('p', { class: 'muted' }, 'No brief yet.')),
        d.comments.length ? h('div', { class: 'card' }, h('h3', {}, `Deck comments · ${open.length} open`), ...d.comments.map((c) => h('p', { class: c.resolved ? 'muted' : '' }, h('b', {}, c.author ?? 'Comment'), ' ', c.body, c.resolved ? ' (resolved)' : ''))) : null)));
}

/** Changes requested (deliverable.yaml review_notes): tick off, remove, add. */
function notesCard(client, project, code, d) {
  const notes = d.review_notes ?? [];
  const edit = async (body) => {
    await api('notes', { client, project, deliverable: code, ...body });
    deliverableView(client, project, code);
  };
  const text = h('input', { placeholder: 'A change to make, e.g. "warmer light, less shadow"', 'aria-label': 'New change', class: 'grow' });
  const from = h('input', { placeholder: 'From', 'aria-label': 'From', size: 9 });
  const add = () => text.value.trim() && edit({ action: 'add', change: text.value, from: from.value });
  text.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  const open = notes.filter((n) => !n.done).length;
  return h('div', { class: 'card notes' },
    h('h3', {}, `Changes requested${notes.length ? ` · ${open} open` : ''}`),
    notes.length ? h('ul', {}, ...[...notes].reverse().map((n) => h('li', { class: n.done ? 'done' : '' },
      h('input', { type: 'checkbox', checked: n.done, 'aria-label': 'Done', onchange: () => edit({ action: n.done ? 'undone' : 'done', index: n.index }) }),
      h('span', { class: 'grow' }, n.change, h('small', { class: 'muted' }, ` ${[n.from, n.date].filter(Boolean).join(' · ')}`)),
      h('button', { class: 'x', 'aria-label': 'Remove', title: 'Remove', onclick: () => confirm('Remove this change?') && edit({ action: 'remove', index: n.index }) }, '×')))) : h('p', { class: 'muted' }, 'Nothing requested yet.'),
    h('div', { class: 'row' }, text, from, h('button', { onclick: add }, 'Add')));
}

/** Every version of the asset with Approve / Reject and a tweak comment, without opening each image. */
function reviewCard(client, project, code, d) {
  const all = d.versions ?? [];
  const show = ui.vfilter ?? 'new';
  const list = all.filter((v) => (show === 'all' ? true : show === 'kept' ? v.status !== 'rejected' : v.status === show));
  const counts = Object.fromEntries(['new', 'approved', 'rejected'].map((s) => [s, all.filter((v) => v.status === s).length]));
  const filters = h('div', { class: 'filters' }, ...[['new', `Needs review ${counts.new}`], ['approved', `Approved ${counts.approved}`], ['kept', 'Not rejected'], ['rejected', `Rejected ${counts.rejected}`], ['all', 'All']].map(([v, l]) =>
    h('button', { 'aria-pressed': String(show === v), onclick: () => ((ui.vfilter = v), deliverableView(client, project, code)) }, l)));
  const tile = (v) => {
    const note = h('input', { placeholder: 'Tweak…', 'aria-label': `Comment on ${v.name}`, class: 'grow' });
    const act = (action, extra = {}) => async (e) => {
      e.preventDefault();
      e.target.disabled = true;
      await api('review', { id: v.id, output: v.output, action, ...extra });
      deliverableView(client, project, code);
    };
    const send = (e) => note.value.trim() && act('comment', { note: note.value })(e);
    note.addEventListener('keydown', (e) => e.key === 'Enter' && send(e));
    return h('div', { class: 'tile vtile' },
      h('a', { href: `#/image/${v.id}/${v.output}` }, thumb(v.sha, v.name)),
      h('div', { class: 'cap col' },
        h('span', { class: 'row' }, h('b', {}, v.name), h('span', { class: 'grow' }), badge(v.status)),
        v.instruction ? h('span', { class: 'muted clip', title: v.instruction }, v.instruction) : null,
        ...(v.comments ?? []).slice(-2).map((c) => h('span', { class: 'clip', title: c.note }, h('b', {}, c.author), ' ', c.note)),
        h('div', { class: 'row' }, note, h('button', { onclick: send, 'aria-label': 'Add comment' }, '↵')),
        h('div', { class: 'row' },
          v.status === 'approved' ? null : h('button', { class: 'ok', onclick: act('approve') }, 'Approve'),
          v.status === 'rejected' ? null : h('button', { class: 'bad', onclick: act('reject') }, 'Reject'))));
  };
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, `Review · ${all.length} version${all.length === 1 ? '' : 's'}`)),
    filters,
    list.length ? h('div', { class: 'grid small' }, ...list.map(tile)) : h('p', { class: 'muted' }, 'Nothing here.'));
}

// ---------- All images (flat board) ----------
async function allImages() {
  const s = await api(`state?status=${enc(ui.filter)}`);
  setMeta(s);
  crumbs({ label: 'Clients', href: '#/' }, { label: 'All images' });
  const filters = h('div', { class: 'filters' }, ...[['', 'All'], ['new', 'Needs review'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([v, l]) => h('button', { 'aria-pressed': String(ui.filter === v), onclick: () => ((ui.filter = v), allImages()) }, l)));
  const compareBtn = h('button', { disabled: ui.picked.size < 2, onclick: () => (location.hash = `#/compare/${[...ui.picked].join(',')}`) }, `Compare ${ui.picked.size || ''}`.trim());
  $('#view').replaceChildren(h('div', { class: 'row' }, filters, h('span', { class: 'grow' }), compareBtn),
    s.tiles.length ? h('div', { class: 'grid' }, ...s.tiles.map((t) => {
      const key = `${t.id}:0`;
      return h('a', { class: `tile${ui.picked.has(key) ? ' selected' : ''}`, href: `#/image/${t.id}` }, thumb(t.sha, t.prompt ?? ''),
        h('div', { class: 'cap' }, h('span', {}, [t.client === '_scratch' ? null : t.client, t.deliverable, `v${t.version}`].filter(Boolean).join(' · ')),
          h('span', { class: 'row' }, badge(t.status), h('input', { type: 'checkbox', 'aria-label': 'Select to compare', checked: ui.picked.has(key), onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? ui.picked.add(key) : ui.picked.delete(key); allImages(); } }))));
    })) : h('div', { class: 'empty' }, 'No images yet.'));
}

// ---------- Image ----------
async function imagePage(id, output = 0) {
  const { image, versions, shas } = await api(`image/${id}`);
  const out = image.outputs[output] ?? image.outputs[0];
  const sha = shas[id]?.[output]?.sha;
  const c = image.client;
  crumbs({ label: 'Clients', href: '#/' }, { label: c === '_scratch' ? 'No client' : c, href: `#/c/${enc(c)}` }, { label: image.project, href: `#/c/${enc(c)}/p/${enc(image.project)}` }, ...(image.deliverable ? [{ label: image.deliverable, href: `#/c/${enc(c)}/p/${enc(image.project)}/d/${enc(image.deliverable)}` }] : []), { label: `v${image.version}` });
  const act = (action, extra = {}) => async () => {
    await api('review', { id, output, action, ...extra });
    imagePage(id, output);
  };
  const ask = h('textarea', { placeholder: 'What should change?', 'aria-label': 'Refine' });
  const run = (kind) => async () => {
    if (!ask.value.trim()) return ask.focus();
    await api('runs', { kind, text: ask.value, id, output, client: c, project: image.project });
    ask.value = '';
    poll();
  };
  const comment = h('input', { placeholder: 'Comment', 'aria-label': 'Comment', class: 'grow' });
  const check = image.checks?.[output];
  const checkCard = h('div', { class: 'card' },
    h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, 'Check'), h('span', { class: 'grow' }),
      h('button', { onclick: async () => { await api('runs', { kind: 'check', text: '', id, output, client: c, project: image.project }); poll(); } }, check ? 'Check again' : 'Check')),
    check
      ? h('div', {},
          h('p', {}, h('b', {}, { meets_brief: 'Meets the brief', needs_changes: 'Needs changes', cant_check: "Couldn't check" }[check.verdict] ?? check.verdict), check.overall != null ? h('span', { class: 'muted' }, ` · ${check.overall} / 5`) : null),
          check.summary ? h('p', { class: 'muted' }, check.summary) : null,
          ...Object.entries(check.scores ?? {}).filter(([, v]) => v?.score != null && v.score < 4).map(([k, v]) => h('p', {}, h('span', { class: 'badge' }, `${k.replace('_', ' ')} ${v.score}`), ' ', v.note)),
          ...(check.labels ?? []).filter((l) => l.ok === false).map((l) => h('p', { class: 'bad' }, `Label: reads “${l.read}”${l.expected ? `, should be “${l.expected}”` : ''}`)),
          ...(check.issues ?? []).map((i) => h('p', {}, typeof i === 'string' ? i : `${i.product ? `${i.product}: ` : ''}${i.problem ?? ''}`)),
          ...(check.suggestions ?? []).map((s) => h('div', { class: 'row' }, h('span', { class: 'grow' }, s), h('button', { onclick: () => { ask.value = s; ask.focus(); } }, 'Use'))))
      : h('p', { class: 'muted' }, 'Reviews the image against the brief, brand rules and product photos.'));

  $('#view').replaceChildren(
    h('div', { class: 'image' },
      h('div', { class: 'stage' },
        h('img', { src: media(sha), alt: image.prompt ?? '' }),
        image.outputs.length > 1 ? h('div', { class: 'outs' }, ...image.outputs.map((o, i) => h('img', { src: media(shas[id][i].sha), class: i === output ? 'on' : '', alt: `Option ${i + 1}`, onclick: () => (location.hash = `#/image/${id}/${i}`) }))) : null),
      h('div', { class: 'side' },
        h('div', { class: 'card' },
          h('div', { class: 'row' }, h('b', {}, `Version ${image.version}`), badge(out.status), h('span', { class: 'grow' }),
            h('button', { class: 'ok', onclick: act('approve') }, 'Approve'), h('button', { class: 'bad', onclick: act('reject') }, 'Reject'), h('button', { onclick: act('like'), 'aria-label': 'Like' }, '♥')),
          image.what_changed ? h('p', {}, h('span', { class: 'muted' }, 'What changed: '), image.what_changed) : null,
          image.instruction ? h('p', { class: 'muted' }, `“${image.instruction}”`) : null),
        checkCard,
        h('div', { class: 'card' }, h('h3', {}, 'Refine'), ask, h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: run('refine') }, 'Refine'), h('button', { onclick: run('direction') }, 'New direction'), h('span', { class: 'grow' }), h('button', { onclick: () => (location.hash = `#/compare/${versions.slice(-2).map((v) => `${v.id}:0`).join(',')}`), disabled: versions.length < 2 }, 'Compare last two'))),
        h('div', { class: 'card' }, h('h3', {}, 'History'),
          h('div', { class: 'versions' }, ...[...versions].reverse().map((v) => h('a', { class: `version${v.id === id ? ' on' : ''}`, href: `#/image/${v.id}` },
            h('img', { src: media(shas[v.id]?.[0]?.sha), alt: '' }),
            h('span', {}, `v${v.version}${v.kind === 'upscale' ? ' · upscaled' : ''}`, h('small', {}, v.what_changed ?? (v.version === 1 ? 'First version' : ''))),
            badge(v.outputs[0]?.status ?? 'new'))))),
        h('div', { class: 'card' }, h('h3', {}, 'Comments'),
          ...(image.comments[output] ?? []).map((cm) => h('p', {}, h('b', {}, cm.author), ' ', cm.note)),
          h('div', { class: 'row' }, comment, h('button', { onclick: async () => { if (comment.value.trim()) await act('comment', { note: comment.value })(); } }, 'Add'))),
        h('details', { class: 'card' }, h('summary', {}, 'Details'),
          h('pre', {}, [`Prompt: ${image.prompt ?? ''}`, `Model: ${image.provider} ${image.model ?? ''}`, `Settings: ${JSON.stringify(image.settings)}`, `Inputs: ${image.inputs.map((i) => `${i.role}${i.note ? ` (${i.note})` : ''}`).join(', ') || 'none'}`, `Cost: $${image.cost_usd ?? 0}`, `Id: ${image.id}`].join('\n'))))));
}

// ---------- Compare ----------
async function comparePage(spec) {
  const items = spec.split(',').map((s) => {
    const [id, o] = s.split(':');
    return { id, output: Number(o ?? 0) };
  });
  const r = await api('compare', { items });
  crumbs({ label: 'Clients', href: '#/' }, { label: 'Compare' });
  const diff = r.prompt_diff ? h('p', { class: 'diff' }, ...r.prompt_diff.map((d) => (d.op === '=' ? d.text : h(d.op === '-' ? 'del' : 'ins', {}, d.text)))) : null;
  $('#view').replaceChildren(
    h('div', { class: 'compare' }, ...r.items.map((it) => h('div', { class: 'card' },
      h('a', { href: `#/image/${it.id}/${it.output}` }, h('img', { src: media(it.file?.match(/([0-9a-f]{64})/)?.[1]), alt: '' })),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('b', {}, `v${it.version}`), badge(it.status ?? 'new'), h('span', { class: 'grow' }),
        h('button', { class: 'primary', onclick: async () => { await api('compare', { items, pick: { id: it.id, output: it.output } }); ui.picked.clear(); location.hash = `#/image/${it.id}/${it.output}`; } }, 'Pick this'))))),
    diff ? h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', {}, 'Prompt changes'), diff) : null);
}

// ---------- Runs ----------
const RUN_LABEL = { new: 'New image', refine: 'Refine', direction: 'New direction', check: 'Check', organise: 'Organise inbox' };
function renderRuns(runs) {
  const recent = runs.filter((r) => ['queued', 'running'].includes(r.status) || Date.now() - new Date(r.finished ?? r.created).getTime() < 60_000);
  $('#runs').replaceChildren(...recent.slice(0, 4).map((r) => h('div', { class: `run ${r.status}` },
    h('div', { class: 'row' }, h('b', {}, RUN_LABEL[r.kind] ?? r.kind), h('span', { class: 'muted' }, r.status), h('span', { class: 'grow' }),
      ['queued', 'running'].includes(r.status) ? h('button', { onclick: async () => { await api(`runs/${r.id}/stop`, {}); poll(); } }, 'Stop') : null),
    r.text ? h('div', { class: 'muted' }, `“${r.text.slice(0, 80)}”`) : null,
    h('div', { class: 'step' }, r.message ?? r.steps.at(-1) ?? ''),
    r.images?.length ? h('a', { href: `#/image/${r.images.at(-1)}` }, 'Open') : null)));
  for (const r of runs) {
    if (['done', 'failed'].includes(r.status) && !ui.seenRuns.has(r.id)) {
      ui.seenRuns.add(r.id);
      if (ui.started) route();
    }
  }
  ui.started = true;
}
let timer = null;
function poll() {
  clearTimeout(timer);
  api('runs').then((runs) => {
    renderRuns(runs);
    if (runs.some((r) => ['queued', 'running'].includes(r.status))) timer = setTimeout(poll, 1500);
  });
}

// ---------- Routing ----------
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let render;
  if (parts[0] === 'c' && parts[2] === 'p' && parts[4] === 'd') render = deliverableView(parts[1], parts[3], parts[5]);
  else if (parts[0] === 'c' && parts[2] === 'p') render = projectView(parts[1], parts[3]);
  else if (parts[0] === 'c' && parts[1]) render = clientView(parts[1]);
  else if (parts[0] === 'image') render = imagePage(parts[1], Number(parts[2] ?? 0));
  else if (parts[0] === 'compare') render = comparePage(parts[1]);
  else if (parts[0] === 'all') render = allImages();
  else render = home();
  render.catch((err) => $('#view').replaceChildren(h('div', { class: 'empty' }, err.message)));
}
window.addEventListener('hashchange', () => {
  ui.filter = '';
  route();
});
route();
poll();
