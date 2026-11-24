---
name: kv-to-adapts
description: Pipeline from one approved key visual to a set of formats (e.g. 1:1, 4:5, 9:16, 16:9, banners) — recompose per aspect ratio, keep product and safe zones, check each, and lay out copy in Figma when needed. Use when the person says "adapt this", "make the other sizes", or lists formats for an approved image.
metadata:
  area: campaign
  version: "1.0.0"
  steps: [format-adaptation, image-edit, creative-qa, compare-and-select]
---

# Key visual → adapts

1. Confirm the source is approved (`history` shows status). If not, ask before adapting.
2. List target formats from the deliverable brief (or ask), then `adapt_plan` with the KV and every size. Show the person the plan: how many sizes need resizing, cropping, recomposing or a Figma layout, and the cost of the recomposes.
3. For each `recompose`: `image_edit` mode `branch` from the KV with the plan's `model_aspect` and a recompose prompt built on its `prompt_hint` ("Extend the scene to 9:16: more marble below, more sky above; keep product size, position relative to the light, and label exactly"). Products must stay inside the safe zone ([safe-zones.json](../../skills/format-adaptation/references/safe-zones.json)).
4. Check each against the format's safe zone and the product (`creative-qa`, quick). Fix with `image_edit`.
5. Copy, logo, `resize`/`crop` sizes and `layout` banners: build them in Figma with `kv-layout`. That means one frame per size at the exact pixels, the image as fill (cropped per plan), and copy and logo inside the safe box.
6. `image_compare` the set against the KV so the person can approve them together.
