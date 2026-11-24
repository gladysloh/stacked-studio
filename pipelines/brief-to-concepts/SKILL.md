---
name: brief-to-concepts
description: Pipeline from a raw brief to chosen, visualised concept directions — intake, optional research, three directions, one image each, comparison. Use when the person hands over a brief and wants concepts, or says "take this brief to concepts". Skip any step the person has already done.
metadata:
  area: concepts
  version: "1.0.0"
  steps: [brief-intake, creative-research, concept-directions, image-generate, compare-and-select]
---

# Brief → concepts

Each step is a skill; read it when you reach it. Skip a step whenever its output already exists (a brief.md, a board, concept files) or the person says so.

1. **brief-intake** → `projects/<p>/brief.md` + deliverables. Stop and confirm open questions that block concepts.
2. **creative-research** (optional — ask) → `research/<slug>/board.yaml`.
3. **concept-directions** → 3 concept files.
4. **image-generate** → one image per direction (say the cost first; 3 images at 1K).
5. **compare-and-select** → side by side; the person picks. Mark the chosen concept file `status: chosen`.

Hand-off: the chosen direction continues with `image-edit` (refine), `product-shot` (fidelity), then `kv-to-adapts`.
