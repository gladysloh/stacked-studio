---
name: format-adaptation
description: Move an approved key visual into other formats (1:1, 4:5, 9:16, 16:9 and wider) without losing the product or the message — safe zones per format, which layout each aspect ratio wants, when to recompose, and a simple pass/fail check. Use this whenever the person needs an image in another format, or a new format cut off a product, logo or copy space.
metadata:
  area: campaign
  version: "1.0.0"
  tools: [adapt_plan, image_edit, image_compare, qa_basics]
---

# Format adaptation

**Start with `adapt_plan`.** Give it the approved image and the sizes. For each size it returns the exact pixels, the safe box, the layout archetype and the action: `resize`, `crop` (with the box), `recompose` (with the model aspect and a prompt hint for `image_edit` mode `branch`), or `layout` (extreme banners → Figma, see `kv-layout`). The rest of this skill explains the reasoning behind those choices.

An image is approved in one format, then needed in others. Each format wants its own layout, and a phone's UI covers the top and bottom of vertical formats.

## Safe zones (keep critical content inside)
Critical content means the product(s), any mandatory element, logos and space reserved for copy. Backgrounds can bleed to the edge.

| Format | Canvas | Margin |
|---|---|---|
| 1:1 | 1080×1080 | 54 px all round |
| 4:5 | 1080×1350 | 54 left/right, 90 top/bottom |
| 9:16 | 1080×1920 | 64 left/right, **250 top, 320 bottom** (platform UI); keep critical content between y250 and y1600 |
| 16:9 | 1920×1080 | 48 px all round; keep critical content centred horizontally |
| anything else | — | 5% of each side |

Scale the margins proportionally for other pixel sizes.

## What each ratio wants
| Ratio | Layout |
|---|---|
| 1:1, 4:5 (about 0.7–1.4) | stay faithful to the hero: same composition, slightly different breathing room |
| 9:16 (under 0.7) | vertical stack: product in the middle band, space above and below |
| 16:9 (about 1.4–3.5) | horizontal split: product on one third, environment or copy space on the other |
| very wide banners (3.5 and over) | single strip: small product, a lot of environment |

Going between neighbours (4:5 ↔ 1:1) changes little. Going across bands (4:5 → 16:9 or 9:16) needs a new layout.

## How to make another format in the studio
The studio doesn't crop or extend images yet, so every format is a **recompose**: a new image composed for that format.
1. Call `image_generate` with `image_edit` (mode `branch`) set to the approved image (a new direction from it) and the new `format`.
2. Start from the approved image's prompt, word for word. Change only the composition line for the new layout, and name the safe area ("keep the product between 13% from the top and 17% from the bottom, clear of phone UI").
3. Pass the approved image's file as the first reference, with the note "keep this product, camera height, light, surface and palette", followed by the same product shots.
4. Set `what_changed` to the format, for example "9:16 version of v3".

Never enlarge the product to fill a bigger frame; keep it inside the safe box (at most 98% of it) and let the background fill the rest.

## Check (pass/fail)
Open each new format and check:
- every critical element is inside the margins;
- no critical elements overlap;
- in 9:16, nothing critical sits in the top 13% or bottom 17%.

A failure means the layout line was wrong for that format: refine with a clearer composition line rather than nudging small details.

See [image-prompt-craft](../image-prompt-craft/SKILL.md) for composition vocabulary.
