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
- **Front facing, always:** every product shows its front, with the logo and label text visible and readable, unless the brief or a deck comment asks for something else (back of pack, cap off, a hand covering it, a top-down pour). Say in the prompt that each product faces the camera, and pick its front packshot as the `product` input.
- Describe each product by **visible identity** (shape, material, cap, colour, where the label sits), and tie it to its photo: "the amber dropper bottle exactly as in its product photo".
- **One product: let the photo speak.** Don't describe its shape, cap or packaging in the prompt: words compete with the photo and pull details off (caps especially). Say what it is, where it sits and how it's lit. Describe shapes only when several products need telling apart.
- **Spell the label out, top to bottom.** The one thing words should say about a single product is its label order, because models rearrange labels (a script line moved or boxed, SPF swapped with the product line, a clear cap instead of an opaque one). When that happens, write it as a must: "label from top to bottom exactly as in the photo: logo, brand name, the product line in handwritten script (no box), the SPF line, then the product description line". The studio already adds the label text from `product_list`; the order line is what fixes swaps.
- **Give the real size.** A packshot on white shows no scale, so models make small products too big. Set `size` on the product (`product_add` … `size: "compact 60 g travel can, about the length of a hand"`): the studio adds it to every prompt, even for one product. In scenes with hands or people, also say it relative to the hand ("about the length of her hand").
- **Make 2–3 at once for label-heavy shots** and keep the ones that are right: about half of the renders swap or garble small label lines however the prompt is written. Reject the garbled ones; don't edit them.
- **When a product's tilt matters, attach the packshot already tilted.** Models copy the orientation of the product photo and ignore "leaning right" in words when the photo stands upright. Run `media_run` `rotate` on the trimmed packshot (`degrees` > 0 tilts the top to the right) and attach that as the `product` input, with the tilt still described in the prompt.
- **Angles in words, never digits.** Write "tilted slightly left", "leaning back noticeably", "turned a little towards the centre", not "8 degrees": numbers near label instructions get printed onto the packaging.
- **Placement is dynamic, not static.** Write it per product, the way a set stylist would brief it: which side of the frame, front or back, what it rests on or leans against and in which direction, its tilt or turn (in words: slightly, a little, noticeably), how far it is set into the surface, and its scale ("the spray leans back noticeably to the left against the rock; the stick front right, tilted slightly right and turned a little towards the centre, base pushed into the sand"). Avoid lineups and identical tilts unless the brief asks for them. When remaking a visual, study the old visual, write all of this into the prompt in words (the packshots are the only image inputs), and keep it, including which side the set elements are on: models mirror compositions easily. See `shot_library` placements `leaning`, `dynamic-tilt`, `set-in-surface`, `asymmetric-anchor`.
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
