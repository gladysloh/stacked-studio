---
name: image-generate
description: Make new images — text-to-image, image-to-image, several references at once (products, style, people, layout), styles, composition and lighting — and record them with history. Use whenever the person wants a new image, variations of an idea, or a first pass at a concept, with or without a client.
metadata:
  area: image
  version: "1.0.0"
  tools: [image_generate, client_context, history]
---

# Make images

1. **Context (only if there's a client):** `client_context` with a query describing the image ("D01 honey jar on marble, warm morning light"). Pull products, palette, lighting notes, open comments.
2. **Inputs:** choose reference images and give each a `role` and a `note`:
   - `product` — must be reproduced exactly (packaging, label, shape). Put these first. Use each product's front packshot: the front (logo and label text) must face the camera unless the brief or a deck comment says otherwise.
   - `reference` — borrow something specific; say what in the note ("lighting only", "camera angle").
   - `style` — overall look and grade. `person` — talent identity. `layout` — composition.
   Inputs can be files (`path`), earlier images (`generation` + `output`), or cached media (`sha`). For a file on the client's Drive: `search` (kind `drive_file`) → `drive_fetch` → pass its `sha`.
   Too many references dilute each other: 1–4 is usually best. Nano Banana 2 takes up to 10 objects + 4 people; Pro up to 6 objects, 5 people, 3 style.
3. **Prompt:** read `image-prompt-craft` and build it dimension by dimension (camera, composition, lighting, surface, colour/mood). When a reference drives a dimension, decode it first (`reference-decoding`).
4. **Call `image_generate`:** `prompt`, `instruction` (verbatim request), `client`/`project`/`deliverable` when relevant, `inputs`, `n` (1–4), `aspect` (4:5 default; 1:1, 9:16, 16:9…), `size` (1K to explore), `context_used`, `request_id` (any unique string; a retry won't pay twice).
   - Copy is not rendered by default (only text printed on the product). Pass `allow_text: true` only for type-led images; layouts with copy belong in `format-adaptation` / Figma.
5. **Look:** open every returned file. Say in one or two lines what worked and what didn't. Offer the obvious next step (refine one, compare, check against the brief) — don't run it unasked.

## Variations
For range, change one thing per variation (angle, light, surface), not everything. Use `n` for the same prompt; use separate calls for deliberately different prompts and note the difference in `instruction`.

## Providers and models
Leave `provider`/`model` empty for the default. `gemini` (Nano Banana 2 `gemini-3.1-flash-image`, Pro `gemini-3-pro-image`), `fal` (`nano-banana`, `nano-banana-pro`), `test` (free placeholders). Use Pro for hard product fidelity or many references; Nano Banana 2 for speed and exploration.
