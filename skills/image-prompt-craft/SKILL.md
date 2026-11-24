---
name: image-prompt-craft
description: Write the prompt an image model (for example Gemini "Nano Banana") renders for a branded key visual, plus its short what/why/how creative direction — built dimension by dimension (camera, composition, lighting, surface and material, colour and mood) and able to take each of those from a reference image. Covers product fidelity, the deliverable's messaging, negatives, text, model quirks, variations and refinements. Use this whenever you write, improve or debug an image-generation prompt, when a reference should drive the angle, light or composition, or when an image came out wrong and you need to work out why.
metadata:
  area: image
  version: "1.1.0"
  tools: [image_generate, image_edit, client_context, shot_library]
---

# Image prompt craft

You are the art director for one key visual. In the studio you get:
- the **deliverable's messaging** from `client_context` (query: the deliverable code): campaign, product, key message, super, client remarks, creative description, and its open deck comments;
- the client's **approved brand rules (brand.md)** from `client_context`: brand, tone, products, preferences;
- the real **format**;
- **product, talent and style reference images** (the client's Brand files, or files the person gives you).

The image model receives those images alongside your prompt. You write **one prompt** and a **what / why / how** note for the person.

## The five dimensions
Every image is decided along five dimensions. Each has its own vocabulary file. Read the ones the direction or a reference touches, and use their exact terms, because precise words steer the model and vague ones don't.

| Dimension | Decides | File |
|---|---|---|
| Camera | height, distance, orientation, lens look, true stance | [camera.md](references/camera.md) |
| Composition | placement, space, depth, format fit, several products | [composition.md](references/composition.md) |
| Lighting | direction, quality, source, shadows, highlights | [lighting.md](references/lighting.md) |
| Surface and material | background, surface, props, hero materials | [surface-and-material.md](references/surface-and-material.md) |
| Colour and mood | palette, grade, contrast, five mood words | [colour-and-mood.md](references/colour-and-mood.md) |

**Taking a dimension from a reference.** Describe references under these same five headings (see [reference-decoding](../reference-decoding/SKILL.md)). For each dimension, decide where it comes from:
- **the reference:** reuse its words ("hard side light from camera left");
- **the direction:** the person's words, the deliverable's creative description, or a deck comment overrides it;
- **client knowledge** (brand rules).

When a reference and the direction disagree on a dimension, the direction wins, and you must state the new value explicitly. An unstated dimension silently follows the reference image.

## Method
1. **Product identity comes from the image, not your words.** Name the product and stop. Never describe its packaging, colour, label or typography; the attached photo is the identity, and words compete with it. In a multi-product shot, a short *visual handle* to tell products apart ("the gold tube with the brown cap") is the only allowed description. Ask for every product to be fully visible unless the direction says otherwise. Pass the product shots that match the deliverable's **Product** first in `references`.
2. **Put the most fragile thing first.** Lead with the camera line, then product identity and placement, then the rest. The model weighs early words most.
3. **Choose the prompt's shape.**
   - **Reference attached → terse.** Camera, subject (with true materials), environment, lighting, mood, once each. Don't restate what the reference already carries unless you're changing it.
   - **No reference → full spec,** in this order: camera, photographic style, subject and product, composition, background and surface, lighting, palette and brand constraints, the few negatives needed, mood.
4. **Keep it short.** Aim for about 80–120 words, up to about 200 with several products. Attention fades with length. If it needs more than about 300 words, the shot needs compositing, not a longer prompt.
5. **The deliverable's messaging.**
   - **Key message:** becomes the image's intent: what the viewer should feel or understand. It is *never* written into the image.
   - **Creative description:** goes into the scene almost word for word.
   - **Client remarks and open deck comments:** feedback to act on. Each one that applies becomes a change in the prompt.
   - **Super and other copy** (headlines, claims like "Dermatologist tested", logo lock-ups, prices, CTAs) is added later in layout, not in the image. Leave it out of the prompt and mention in `why` that it's for layout. The logo on the product's own packaging is enough.

   Never drop an explicit do-not-use rule from approved brand rules (brand.md).
6. **Write constraints as positives, and only the ones you need.**
   - "The only text visible is printed on the product packaging" beats "no text, no words, no letters".
   - Don't contradict yourself ("sunburst … no sunburst rays").
   - Repeating an instruction doesn't strengthen it.
   - Add a negative for a brand or brief restriction, or a failure you've actually seen.
   - People are in or out according to the brief: describe the talent when it's attached or asked for.
7. **No copy in the image.** Images are clean product visuals; copy goes on later in layout, where it can be spelled right and moved per format. Never ask for on-image text, quoted words, typography, badges, stickers or graphic overlays. If you want room for copy, ask for *empty space* ("upper third: calm negative space"), never the copy itself. The studio adds a no-added-text line to every render automatically, so you don't need to repeat it.
8. **Know the model's limits.**
   - Strong angles need anchoring ([camera.md](references/camera.md)).
   - About 3 products is the reliable maximum; strict depth order isn't reliable.
   - Reference limits depend on the model: **Nano Banana 2** takes up to 10 product/object images and 4 people; **Nano Banana Pro** takes up to 6 objects, 5 people and 3 style images (14 in total for both). Put products first. Use Pro when product fidelity or label text matters most.
   - A reference with garbled text spreads that text into every image made from it.
   - The same prompt gives a near-identical image, so variety comes from changing the prompt.
9. **Variations and concepts.** Several variations from one direction should ideally vary **one dimension** each (light, surface, crop, time of day), so the person can tell what made the difference. A **new concept** for an deliverable should be clearly different from its existing concepts (listed by `client_context` (query: the deliverable code)) unless the person asks to stay close.
10. **Refining** is the same concept with better execution:
    - Start from the previous version's prompt and change only what the person, a deck comment or QA names. The person outranks everything.
    - **"Regenerate this, but …"** means: take that version's exact prompt from its record (`_records/generations/<id>.yaml` → `prompt`, or `history`), change only the words for what they named, and keep its inputs and model. Rewriting the rest makes everything else drift.
    - **Change one word, not the whole description.** Descriptors swing far: "porous, honeycombed" turned a rock into a sponge, and "rounded, lumpy" then turned it into a smooth ball. When a material or shape is off, look at the wording of the version the person liked and change the smallest thing.
    - When the model keeps snapping back to a reference, ask for **small relative changes** from the latest version ("about 10° lower than the previous frame, same direction"). Stop after three steps that don't move it, and suggest a different route.
    - If the person edited the prompt themselves, use it word for word.

11. **Keywords: short, plain and the person's own.** When the person gives keywords, use them as written, 4–6 plain phrases ("warm golden-brown limestone rock, ochre", "gentle wind ripples"), plus at most one short framing line. Don't stack extra descriptors on top. Colours that must match go in as words plus a colour code marked "for matching only; never print it".

Worked prompts: [examples.md](references/examples.md).

Name shots precisely with the **shot library**. `shot_library` (query or category) gives each angle, placement, pose, light, surface and motion entry with wording the model follows and its known problems. With an id it also returns the team's tagged example images: pass the best one as an input (role `reference` or `layout`, with a note saying what to take).

Deeper notes from production work:
- [gemini-prompt-best-practices.md](references/gemini-prompt-best-practices.md) — what Nano Banana honours and ignores, product-label limits, tested openers and negatives.
- [camera-and-framing.md](references/camera-and-framing.md) — shot vocabulary that the model reliably follows.
- [style-analysis.md](references/style-analysis.md) — turning a style reference into prompt language.
- [prompt-examples.md](references/prompt-examples.md) — annotated prompts that worked, and why.
- [composite-workflow.md](references/composite-workflow.md) — when to build a shot in passes (backdrop, then products) instead of one prompt.

## The what / why / how note
One or two sentences each, written for an art director:
- **what:** the visual idea, and what varies;
- **why:** how it serves the key message and the audience;
- **how:** camera, light, surface, palette, composition.

## In the studio
Call `image_generate` with:
- `instruction`: the person's words, exactly;
- `prompt`;
- `references`: product shots first, each with a short `note`;
- `deliverable`, and `concept` when continuing one;
- `image_edit` (mode `edit`) and `what_changed` when refining.

Then open the image, check it, and reply with the what / why / how note in a few lines. Other formats: [format-adaptation](../format-adaptation/SKILL.md). Checking an image: [creative-qa](../creative-qa/SKILL.md).
