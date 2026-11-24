---
name: product-shot
description: Commercial product photography with exact product fidelity — packshots, hero shots, lifestyle placement, groups and line-ups — keeping shape, colour, label text and proportions right, with believable lighting, contact shadows and reflections; plus fixing a product that came out wrong. Use whenever a real product must appear in an image, or the person says the product, label or packaging looks off.
metadata:
  area: product
  version: "1.0.0"
  tools: [product_list, product_add, shot_library, client_context, image_generate, image_edit, image_compare, qa_basics, qa_record]
---

# Product shots

## Before you prompt
1. `product_list` for the client: each product's exact label text and its photos and cutouts (by `sha`, cutouts first). `client_context` (query: the product name) adds notes and past feedback. A product that's missing gets added with `product_add` (give the label text exactly; `cutout: true` removes the background when the media tools are installed).
   No local cutout? `search` the client's Drive (`kinds: [drive_file]`, query: the product name) and `drive_fetch` the best packshot.
2. Choose the **cleanest** cutout per product: front-facing, evenly lit, label readable. One good cutout beats three mediocre ones. If there's no cutout but there's a photo, `media_run` `cutout` (optional media tools) makes one.
3. Pass each as an input with role `product` and a note naming it ("Product: amber serum, 30 ml dropper bottle").

## Choose the shot
Pick the angle, placement, lighting and any motion from `shot_library` (subject `product` or `product_with_model`). Use each entry's `prompt` wording and heed its `watch_out`: a top-down angle hides front labels, and splashes swallow labels. The team's tagged examples for an id make strong `layout` or `reference` inputs.

## Prompt rules that keep products right
- Describe each product by **visible identity** (shape, material, cap, colour, where the label sits), and tie it to its photo: "the amber dropper bottle exactly as in its product photo".
- Give exact placement and scale for each product ("left, front, about one third of frame height"). Avoid occlusion of labels; never let props overlap a logo.
- Light like a studio would: name the key (direction, softness), fill, rim, and the surface response (contact shadow, reflection on glass, specular highlights on caps).
- Gravity and contact: products sit *on* something unless the concept says floating; say so.
- Long or small label text is the model's weakest point. Keep labels front-facing and large; if they still garble, use the two-pass approach below.
- Read `image-prompt-craft/references/gemini-prompt-best-practices.md` → product-label limits, and `composite-workflow.md`.

## Two-pass when single-pass fails
1. Make the scene with placeholder shapes in the right places (no product references).
2. `image_edit` the best scene with the product cutouts as inputs: "Replace the placeholder bottle on the left with the product exactly as in its photo; keep light direction and shadows consistent." One product per pass for fragile labels.

## Check
Open the image and compare each product with its cutout: silhouette, colour, cap, label words (spell them), proportions. Then run `creative-qa` when it matters. Report label errors exactly ("reads SERUN, should read SERUM").

## Fixing a wrong product
`image_edit` mode `edit` on the image, the correct cutout as input (role `product`), prompt: "Replace the [product] with the exact product from its photo — same position, scale, angle and lighting. Change nothing else." Use Pro (`gemini-3-pro-image` / `nano-banana-pro`) for this.
