# Composite workflow — building hard group shots by separation + assembly

Single-pass Gemini one-shots scene + products: one prompt, one image with everything in it. For hard multi-product group shots that approach drifts — product/label fidelity degrades roll-to-roll and the scene keeps changing under you. The honest fix is to **stop one-shotting**: generate the background and the products as separate passes, then assemble them. This file is the methodology; the assembly tool is `/composite-shot`.

This is craft, not a client rule — it applies to any brand. Client-specific application (which SKUs are fragile, palette guardrails) lives in the client's `knowledge/` notes.

## 1. Decision gate — do you even need this?

Reach for separation only when single-pass earns it:

- **Tight group (≈3 products, single cluster) → try in-scene first.** Direct placement with the prompt ("product A left, product B centre and slightly forward, product C right"). Often lands in a few rolls. Don't pay the composite tax if a one-shot cooperates.
- **Larger families (5+ products), multi-row / multi-tier layouts, explicit depth ordering, or per-product lighting that won't unify → separate and composite.**
- **A single fragile SKU keeps breaking inside an otherwise-fine group → give just that SKU a solo pass** and composite it in; leave the rest in-scene.

Stop-loss tie-in: if a lineage hits chain depth 5 (see SKILL.md → Phase 3 stop-loss) on a structural problem — depth ordering, stacking/perching, per-product palette — that's the signal to switch to this workflow rather than roll again.

> **Reading an existing shot:** a final that *looks* one-shot may have been composited. The tell is a **cutout-layout reference** in the concept's `references/` (a flat arrangement of product cutouts on transparent/neutral ground). A bare background PNG in `references/` is just an iteration self-reference, not proof of a composite.

## 2. The invariant + two axes

**Invariant:** never generate scene + products in one shot. Generate them apart, chunk the products, assemble.

Two **independent** choices — mix freely per shot:

- **Order**
  - *Background-first* — generate/lock an empty "stage" (an `empty-stage` frame), then place products onto it. Best when the scene is the hard part (specific lighting, light burst, set geometry).
  - *Products-first* — fix the product arrangement, then generate the background *fitted around* the placed products. Best when product placement is the hard part and the background is forgiving/atmospheric.
- **Chunking granularity** — per **product** (finest, max control) → per **cluster/tier** → per **row** → whole **group** (one product pass, one bg pass). Finer = more control + more assembly work.

## 3. Practices that make the seams disappear

- **Colour-match the product pass to the background.** Render the separated products in a scene whose colour/temperature matches the destination background — *not* a neutral/white box. Then highlights, shadow direction, and warmth already agree and the comp doesn't read as "stickered". (If solos were rendered against mismatched palettes, fix on the assembled output with a `/retouch-image` "unify warmth" delta, or re-render the solos — see `/composite-shot` failure modes.)
- **Compose first as a cutout layout.** Decide the arrangement as a flat cutout layout (a `references/refN.png`) *before* rendering any scene. This is the layout spec the rest of the workflow targets — and the same layout drives `/composite-shot`'s per-product X/Y/scale/z.
- **Keep decorative elements out of the product render.** Ribbons, props, festive dressing → add at assembly time, not baked into the product pass. The product pass should be products + lighting only, clean.
- **Lock the arrangement, then change the camera angle by prompt.** Once a composition is approved, shift viewpoint (low angle, top-down) with a prompt delta rather than re-rolling the whole layout — landing the arrangement is the expensive part, angle is cheap. `/reference-pose` can supply a synthetic perspective anchor.
- **Comp-time finishing.** Small highlights — a sparkle/glint on a hero product, a contact shadow — added at assembly sell the light interaction. `/composite-shot` does contact shadows; `/retouch-image` does glints/warmth the compositor can't.

## 4. Tooling map

| Step | Tool |
|---|---|
| Background pass (locked empty stage, or generated backdrop) | `/generate-image-gemini` (concept or atomic) |
| Product passes (per-product / per-cluster / per-row solos, colour-matched) | `/generate-image-gemini`, brought to "approved" via `/iterate-shot` + `/tweak-prompt` |
| Products-first background (generate bg *around* placed products) | `/generate-image-gemini` with the placed-product composition as reference |
| Camera-angle anchor | `/reference-pose` |
| Assemble (layer solos + backdrop, explicit X/Y/scale/z/shadow) | `/composite-shot` |
| Clean the assembled output (unify warmth, glints, fringe) | `/retouch-image` |
| Verify labels survived layering | `/typo-watch` |

## 5. End-to-end (background-first, per-cluster example)

1. Generate and approve the empty stage (`/generate-image-gemini`).
2. Build the cutout layout (`references/refN.png`) — the target arrangement.
3. Render each product cluster as a solo pass in a colour-matched scene; bring each to approved (`/iterate-shot`).
4. Assemble: solos + the empty stage as `canvas.background`, per-cluster X/Y/scale/z from the layout (`/composite-shot`).
5. Finish: contact shadows in the layout; `/retouch-image` for glints/warmth unification.
6. `/typo-watch` the final.

Products-first swaps steps 1–2: place products first, then generate the background fitted around that composition, then assemble (or in-paint).

## See also
- the `composite` approach in the image-edit skill — the assembler (layout schema, backdrop sources, failure modes).
- `gemini-prompt-best-practices.md` → "Known Gemini limitations" — why single-pass structurally refuses some compositions.
- the client's `knowledge/` notes — client-specific: which SKUs are fragile (need a solo pass), palette guardrails for the colour-matched pass.
