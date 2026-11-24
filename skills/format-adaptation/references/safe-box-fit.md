# safe-box-fit recipe

After an adapt frame is filled, scale all non-background content to fit inside the format's safe box and centre it; the background bleeds full-frame. This is the build-time enforcement of the `safe-zones.json _build_rule`. Proven on a fintech client v2 retrofit — all 9 adapts passed the audit unforced afterward.

**Inputs:** `f` = the adapt frame (already filled); `m` = the margins object for this size from `safe-zones.json` (`{l,r,t,b}`).

**`use_figma` body:**

```js
const W = f.width, H = f.height, safeW = W - m.l - m.r, safeH = H - m.t - m.b;

// Everything except the full-bleed background is "content".
const content = f.children.filter(c =>
  c.name !== "bg" && c.name !== "sparkles-overlay" && !c.name.includes("SAFEZONE"));

// rescale() touches font sizes, so preload every font on the content first.
const fonts = new Map();
for (const t of f.findAllWithCriteria({ types: ['TEXT'] }))
  for (const s of t.getStyledTextSegments(['fontName']))
    fonts.set(JSON.stringify(s.fontName), s.fontName);
await Promise.all([...fonts.values()].map(fn => figma.loadFontAsync(fn)));

// Group → scale to fit (never enlarge) → centre in the safe box → ungroup.
const g = figma.group(content, f);
const scale = Math.min(1, (safeW * 0.98) / g.width, (safeH * 0.98) / g.height);
if (scale < 0.999) g.rescale(scale);
g.x = m.l + (safeW - g.width) / 2;
g.y = m.t + (safeH - g.height) / 2;
figma.ungroup(g);
```

**Notes**
- `bg` (and any full-bleed `sparkles-overlay`) is excluded so it keeps bleeding to the frame edge.
- Ungroup at the end so the audit can read slot nodes as direct children by name.
- `0.98` leaves a hair of inner padding inside the safe box; raise toward `1.0` for tiny banners if content looks too shrunk.
- Run `audit-safezones.md` afterward — it should PASS.
