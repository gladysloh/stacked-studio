// The Workbench: view, compare, refine and approve. Plain ES module, no build step.
// Routes: #/ (board), #/image/<id>[/<output>], #/compare/<id:out>,<id:out>,...

const $ = (sel) => document.querySelector(sel);
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
  const res = await fetch(`/api/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.fix ? `${json.error} ${json.fix}` : json.error);
  return json;
}
const media = (sha) => (sha ? `/media/${sha}` : '');
const STATUS = { new: 'Needs review', approved: 'Approved', rejected: 'Rejected' };
const badge = (s) => h('span', { class: `badge ${s}` }, STATUS[s] ?? s);

const ui = {
  client: localStorage.getItem('ws.client') ?? '',
  project: localStorage.getItem('ws.project') ?? '',
  filter: '',
  picked: new Set(),
  state: null,
  seenRuns: new Set(),
};

async function loadState() {
  const q = new URLSearchParams({ client: ui.client, project: ui.project, status: ui.filter });
  ui.state = await api(`state?${q}`);
  const cs = $('#client');
  cs.replaceChildren(h('option', { value: '' }, 'All clients'), ...ui.state.clients.map((c) => h('option', { value: c.slug, selected: c.slug === ui.client }, c.name)), h('option', { value: '_scratch', selected: ui.client === '_scratch' }, 'No client'));
  const ps = $('#project');
  ps.hidden = !ui.client;
  ps.replaceChildren(h('option', { value: '' }, 'All projects'), ...ui.state.projects.map((p) => h('option', { value: p.slug, selected: p.slug === ui.project }, p.name)));
  const s = ui.state;
  $('#meta').textContent = [s.agent ?? 'No agent found', s.providers.length ? s.providers.join(', ') : 'Test images', `$${s.spent_today.toFixed(2)} of $${s.daily_cap} today`].join(' · ');
  renderRuns(s.runs);
}

// ---------- Board ----------
async function board() {
  await loadState();
  const prompt = h('textarea', { placeholder: 'Describe an image…', 'aria-label': 'New image' });
  const n = h('select', { 'aria-label': 'How many' }, ...[1, 2, 3, 4].map((x) => h('option', { value: x }, `${x} image${x > 1 ? 's' : ''}`)));
  const go = h('button', {
    class: 'primary',
    onclick: async () => {
      if (!prompt.value.trim()) return prompt.focus();
      await api('runs', { kind: 'new', text: prompt.value, client: ui.client === '_scratch' ? null : ui.client, project: ui.project, n: Number(n.value) });
      prompt.value = '';
      poll();
    },
  }, 'Make');
  const filters = h('div', { class: 'filters' }, ...[['', 'All'], ['new', 'Needs review'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([v, l]) => h('button', { 'aria-pressed': String(ui.filter === v), onclick: () => ((ui.filter = v), board()) }, l)));
  const compareBtn = h('button', { disabled: ui.picked.size < 2, onclick: () => (location.hash = `#/compare/${[...ui.picked].join(',')}`) }, `Compare ${ui.picked.size || ''}`.trim());
  const tiles = ui.state.tiles;
  const grid = tiles.length
    ? h('div', { class: 'grid' }, ...tiles.map((t) => {
        const key = `${t.id}:0`;
        return h('a', { class: `tile${ui.picked.has(key) ? ' selected' : ''}`, href: `#/image/${t.id}` },
          h('img', { src: media(t.sha), alt: t.prompt ?? '', loading: 'lazy' }),
          h('div', { class: 'cap' },
            h('span', {}, [t.deliverable, `v${t.version}`].filter(Boolean).join(' · ') + (t.outputs > 1 ? ` · ${t.outputs}` : '')),
            h('span', { class: 'row' }, badge(t.status), h('input', { type: 'checkbox', 'aria-label': 'Select to compare', checked: ui.picked.has(key), onclick: (e) => { e.stopPropagation(); }, onchange: (e) => { e.target.checked ? ui.picked.add(key) : ui.picked.delete(key); board(); } }))));
      }))
    : h('div', { class: 'empty' }, 'No images yet. Describe one above, or ask your agent.');
  $('#view').replaceChildren(h('div', { class: 'ask' }, prompt, h('div', { class: 'row' }, n, go)), h('div', { class: 'row' }, filters, h('span', { class: 'grow' }), compareBtn), grid);
}

// ---------- Image ----------
async function imagePage(id, output = 0) {
  await loadState();
  const { image, versions, shas } = await api(`image/${id}`);
  const out = image.outputs[output] ?? image.outputs[0];
  const sha = shas[id]?.[output]?.sha;
  const act = (action, extra = {}) => async () => {
    await api('review', { id, output, action, ...extra });
    imagePage(id, output);
  };
  const ask = h('textarea', { placeholder: 'What should change?', 'aria-label': 'Refine' });
  const run = (kind) => async () => {
    if (!ask.value.trim()) return ask.focus();
    await api('runs', { kind, text: ask.value, id, output, client: image.client === '_scratch' ? null : image.client, project: image.project });
    ask.value = '';
    poll();
  };
  const comment = h('input', { placeholder: 'Comment', 'aria-label': 'Comment', style: 'flex:1' });

  $('#view').replaceChildren(
    h('p', {}, h('a', { href: '#/' }, '← Board'), ' ', h('span', { class: 'muted' }, [image.client === '_scratch' ? 'No client' : image.client, image.project, image.deliverable].filter(Boolean).join(' · '))),
    h('div', { class: 'image' },
      h('div', { class: 'stage' },
        h('img', { src: media(sha), alt: image.prompt ?? '' }),
        image.outputs.length > 1 ? h('div', { class: 'outs' }, ...image.outputs.map((o, i) => h('img', { src: media(shas[id][i].sha), class: i === output ? 'on' : '', alt: `Option ${i + 1}`, onclick: () => (location.hash = `#/image/${id}/${i}`) }))) : null),
      h('div', { class: 'side' },
        h('div', { class: 'card' },
          h('div', { class: 'row' }, h('b', {}, `Version ${image.version}`), badge(out.status), h('span', { class: 'grow' }),
            h('button', { class: 'ok', onclick: act('approve') }, 'Approve'), h('button', { class: 'bad', onclick: act('reject') }, 'Reject'), h('button', { onclick: act('like') }, '♥')),
          image.what_changed ? h('p', {}, h('span', { class: 'muted' }, 'What changed: '), image.what_changed) : null,
          image.instruction ? h('p', { class: 'muted' }, `“${image.instruction}”`) : null),
        h('div', { class: 'card' }, h('h3', {}, 'Refine'), ask, h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: run('refine') }, 'Refine'), h('button', { onclick: run('direction') }, 'New direction'), h('span', { class: 'grow' }), h('button', { onclick: () => (location.hash = `#/compare/${versions.slice(-2).map((v) => `${v.id}:0`).join(',')}`), disabled: versions.length < 2 }, 'Compare last two'))),
        h('div', { class: 'card' }, h('h3', {}, 'History'),
          h('div', { class: 'versions' }, ...[...versions].reverse().map((v) => h('a', { class: `version${v.id === id ? ' on' : ''}`, href: `#/image/${v.id}` },
            h('img', { src: media(shas[v.id]?.[0]?.sha), alt: '' }),
            h('span', {}, `v${v.version}${v.kind === 'upscale' ? ' · upscaled' : ''}`, h('small', {}, v.what_changed ?? (v.version === 1 ? 'First version' : ''))),
            badge(v.outputs[0]?.status ?? 'new'))))),
        h('div', { class: 'card' }, h('h3', {}, 'Comments'),
          ...(image.comments[output] ?? []).map((c) => h('p', {}, h('b', {}, c.author), ' ', c.note)),
          h('div', { class: 'row' }, comment, h('button', { onclick: async () => { if (comment.value.trim()) await act('comment', { note: comment.value })(); } }, 'Add'))),
        h('details', { class: 'card' }, h('summary', {}, 'Details'),
          h('pre', {}, [`Prompt: ${image.prompt ?? ''}`, `Model: ${image.provider} ${image.model ?? ''}`, `Settings: ${JSON.stringify(image.settings)}`, `Inputs: ${image.inputs.map((i) => `${i.role}${i.note ? ` (${i.note})` : ''}`).join(', ') || 'none'}`, `Cost: $${image.cost_usd ?? 0}`, `Id: ${image.id}`].join('\n'))))));
}

// ---------- Compare ----------
async function comparePage(spec) {
  await loadState();
  const items = spec.split(',').map((s) => {
    const [id, o] = s.split(':');
    return { id, output: Number(o ?? 0) };
  });
  const r = await api('compare', { items });
  const diff = r.prompt_diff ? h('p', { class: 'diff' }, ...r.prompt_diff.map((d) => (d.op === '=' ? d.text : h(d.op === '-' ? 'del' : 'ins', {}, d.text)))) : null;
  $('#view').replaceChildren(
    h('p', {}, h('a', { href: '#/' }, '← Board')),
    h('div', { class: 'compare' }, ...r.items.map((it) => h('div', { class: 'card' },
      h('a', { href: `#/image/${it.id}/${it.output}` }, h('img', { src: media(it.file?.match(/([0-9a-f]{64})/)?.[1]), alt: '' })),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('b', {}, `v${it.version}`), badge(it.status ?? 'new'), h('span', { class: 'grow' }),
        h('button', { class: 'primary', onclick: async () => { await api('compare', { items, pick: { id: it.id, output: it.output } }); ui.picked.clear(); location.hash = `#/image/${it.id}/${it.output}`; } }, 'Pick this'))))),
    diff ? h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', {}, 'Prompt changes'), diff) : null);
}

// ---------- Runs ----------
function renderRuns(runs) {
  const recent = runs.filter((r) => ['queued', 'running'].includes(r.status) || (Date.now() - new Date(r.finished ?? r.created).getTime() < 60_000));
  $('#runs').replaceChildren(...recent.slice(0, 4).map((r) => h('div', { class: `run ${r.status}` },
    h('div', { class: 'row' }, h('b', {}, { new: 'New image', refine: 'Refine', direction: 'New direction' }[r.kind]), h('span', { class: 'muted' }, r.status), h('span', { class: 'grow' }),
      ['queued', 'running'].includes(r.status) ? h('button', { onclick: async () => { await api(`runs/${r.id}/stop`, {}); poll(); } }, 'Stop') : null),
    h('div', { class: 'muted' }, `“${r.text.slice(0, 80)}”`),
    h('div', { class: 'step' }, r.message ?? r.steps.at(-1) ?? ''),
    r.images?.length ? h('a', { href: `#/image/${r.images.at(-1)}` }, 'Open') : null)));
  for (const r of runs) {
    if (r.status === 'done' && !ui.seenRuns.has(r.id)) {
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
  const [, page, a, b] = location.hash.split('/');
  const render = page === 'image' ? imagePage(a, Number(b ?? 0)) : page === 'compare' ? comparePage(a) : board();
  render.catch((err) => $('#view').replaceChildren(h('div', { class: 'empty' }, err.message)));
}
$('#client').addEventListener('change', (e) => {
  ui.client = e.target.value;
  ui.project = '';
  localStorage.setItem('ws.client', ui.client);
  localStorage.setItem('ws.project', '');
  location.hash = '#/';
  board();
});
$('#project').addEventListener('change', (e) => {
  ui.project = e.target.value;
  localStorage.setItem('ws.project', ui.project);
  board();
});
window.addEventListener('hashchange', route);
route();
poll();
