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
2. List target formats from the deliverable brief (or ask). Group by aspect class (tall, square, wide, strip) — see `format-adaptation`.
3. Per format: `image_edit` mode `branch` from the KV with `aspect` set and a recompose prompt ("Extend the scene to 9:16: more marble below, more sky above; keep product size, position relative to the light, and label exactly"). Products must stay inside the safe zone ([safe-zones.json](../../skills/format-adaptation/references/safe-zones.json)).
4. Check each against the format's safe zone and the product (`creative-qa`, quick). Fix with `image_edit`.
5. Copy and logo: if the format needs headline/super/logo, place them in Figma with the Figma tools (one frame per format, image as fill, safe zones as guides) rather than rendering text in the image.
6. `image_compare` the set against the KV so the person can approve them together.
