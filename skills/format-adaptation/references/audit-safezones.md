# audit-safezones recipe

Backstop check after `safe-box-fit`. Flags any critical content that crosses its safe-zone margin, plus overlaps between critical elements. Built this way, adapts should PASS unforced — a FAIL means the template or fill step regressed.

**Inputs:** `f` = the adapt frame; `m` = margins from `safe-zones.json` for this size.

**`use_figma` body:**

```js
const W = f.width, H = f.height, TH = 2;
const CRIT = new Set(["logo-pill","headline","subhead","cta","legal","vertical-pill","mas-disclaimer"]);
const isCrit = c => CRIT.has(c.name) || c.name.startsWith("chip") || c.name === "label" || c.type === "TEXT";
const crit = f.children.filter(c => c.visible && isCrit(c));

// 1. margin check (alignment-aware for TEXT)
const margin = [];
for (const c of crit) {
  const x0=c.x, y0=c.y, x1=c.x+c.width, y1=c.y+c.height, iss=[];
  const al = c.type === 'TEXT' ? c.textAlignHorizontal : 'BOX';
  const checkL = al==='LEFT'||al==='BOX', checkR = al==='RIGHT'||al==='BOX';
  if (checkL && x0 < m.l - TH) iss.push(`left ${Math.round(m.l-x0)}`);
  if (y0 < m.t - TH)           iss.push(`top ${Math.round(m.t-y0)}`);
  if (checkR && x1 > W-m.r+TH)  iss.push(`right ${Math.round(x1-(W-m.r))}`);
  if (y1 > H-m.b+TH)            iss.push(`bottom ${Math.round(y1-(H-m.b))}`);
  if (iss.length) margin.push({ el: c.name, over: iss.join(", ") });
}

// 2. overlap check between critical elements (catches e.g. legal vs mas-disclaimer)
const overlap = [];
for (let i=0;i<crit.length;i++) for (let j=i+1;j<crit.length;j++){
  const a=crit[i], b=crit[j];
  const ox = Math.max(0, Math.min(a.x+a.width,b.x+b.width) - Math.max(a.x,b.x));
  const oy = Math.max(0, Math.min(a.y+a.height,b.y+b.height) - Math.max(a.y,b.y));
  if (ox > TH && oy > TH) overlap.push(`${a.name} ∩ ${b.name}`);
}

const verdict = (margin.length || overlap.length) ? "fail" : "pass";
return { verdict, margin, overlap };
```

**Verdict schema** — persist onto each adapt's `.md` and the per-campaign `adapts.json` so a UI can show ✓/✕ without reopening Figma:

```json
{
  "size": "LEADERBOARD",
  "format_key": "LEADERBOARD",
  "w": 728, "h": 90,
  "figma_node_id": "...",
  "copy": { "headline": "...", "subhead": "...", "cta": "Apply Now", "legal": "T&Cs apply" },
  "safezone": { "verdict": "pass", "margin": [], "overlap": [] }
}
```

**Notes**
- TEXT horizontal check is alignment-aware so a centred full-width box doesn't false-positive on its left/right edges.
- A FAIL is a signal to fix the template/fill, not to nudge by hand — the whole point of the build rule is that adapts arrive compliant.
