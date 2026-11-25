---
name: studio
description: How to work in stacked-studio — pick the right capability for what the person wants, work with or without a client, and keep every image's history. Use at the start of any creative production request (research, concepts, images, edits, product shots, video, adaptations, review), or when the person asks what the studio can do or whether it's working.
metadata:
  area: studio
  version: "1.0.0"
  tools: [studio_capabilities, studio_status, client_list, client_context]
---

# Working in the studio

## Start where the person is
Creative work is not a line. Don't push anyone through research, a brief or concepts when they already know what they want. Match the request to the smallest capability that does it:

| They have / want | Use |
|---|---|
| A prompt or a clear picture in mind | `image-generate` |
| An image and a change ("softer light", "swap the background") | `image-edit` |
| Several versions to choose between | `compare-and-select` |
| The review deck: update it, a shortlist, comments under images, before/after, a new slide layout | `review-deck` |
| A product that must look exactly right | `product-shot` |
| A reference image to borrow angle/light/framing from | `reference-decoding` → `image-generate` |
| A brief (PDF, deck, doc, pasted text) | `brief-intake` |
| A brief and no idea yet | `concept-directions` (or pipeline `brief-to-concepts`) |
| "Find references", trends, competitors, Pinterest | `creative-research` |
| An approved image in more formats | `format-adaptation` with `adapt_plan` (or pipeline `kv-to-adapts`) |
| Copy or a logo on an image, or a Figma adapt set | `kv-layout` |
| A Pinterest board to pull references from | `creative-research` (`pinterest_board`) |
| "Find product photos / dynamic layouts / poses for …" | `creative-research` (`research_plan` per subject) |
| "What angles / placements / poses could we use?" | `shot_library` (query, category or subject) |
| An image that should move | `video-treatment` |
| "Is this good?", "check it against the brief" | `creative-qa` |
| Brand guidelines or a deck to learn from | `brand-profile-extraction` |
| A Google Slides deck to bring in or re-sync | `deck_import`, then `brand-profile-extraction` or `brief-intake` |
| A shot list or batch in a Google Sheet | pipeline `sheet-batch` |
| "Save it to Drive" | `drive_save` (after the person approves) |

`studio_capabilities` lists everything; call it with a name to read that skill. Read the skill before doing the work — they hold the craft.

## Client or no client
- No client named → work without one. Everything goes to `clients/_scratch/`.
- A client named → call `client_context` with the client and what you're about to make. Follow **approved** rules (brand.md). Treat **source** items as the client's facts, and **draft** / **unverified** items as hints — say when you rely on one. Pass what you used as `context_used`.
- Projects: pass `project` (created if new). For deck-based work, pass `deliverable` (e.g. `D01`); its brief is in `clients/<client>/projects/<project>/<CODE>-<name>/brief.md`.

## The working deck is the source of truth
Each client's working deck (`client.yaml` → `links.decks`, marked `working`) is what the team follows. Deliverable codes, messaging, status and comments all come from it. Before working on a deliverable, re-sync it: `deck_import` with no link, when Google is connected. Read its open comments for that code. Local briefs mirror the deck: when they disagree, the deck wins, and tell the person. Deck images come from a PowerPoint download of that same deck (`deck_import_file`).

## Making a deliverable's image: always fresh
For deck deliverables, every new image is made **fresh** with `image_generate`, never by editing the old visual:
1. **Products first.** Every product the deliverable names must be in `product_list` with a front packshot. If one is missing, find it or tell the person; don't generate without it.
2. **Read everything.** The deliverable's brief (creative idea, description, lighting, palette, key message, claims) and every open deck comment and client remark for that code. Comments override the brief where they disagree.
3. **Understand each image.** Look at the slide's reference images (client references, lighting references) and the old visual. For each one, note what it shows: scene and setting (including which side each set element is on), surfaces and props, product placement per product (position, what it leans on, tilt and rotation, how far it is set in, scale: see `product-shot`), camera angle and lens, lighting direction and quality, colour and mood (see `reference-decoding`).
4. **Write the prompt** to recreate the creative direction (and the old visual's composition where the comments say to keep it), with every change the comments ask for written in. Cover scene, lighting, product placement, camera, colour and mood, and keep every product's front (logo and label) facing the camera.
5. **Inputs: the product packshots only.** Every image is generated new from words plus the front packshots (role `product`). The old visual and the slide references are for *you* to study, not inputs: everything you learnt from them (scene, setting, surfaces, camera, lighting, each product's position, lean, turn and how it sits, colours, mood) goes into the prompt as words. Passing the old visual, even as a layout guide, makes the model rework it and drag back what the comments asked to change. Add another image input only when the person asks for one.
   ****Shared colours for a group of assets:** a project look in `projects/<p>/looks/<name>.yaml` (`name`, `applies_to: [codes]`, `light`, and ONE generic colour per element: `sky` / `sea` / `sand` / `background` / `surface`, each `{ words: "light blue", hex: "#A3CEE7" }`, measured from the working-deck visual) is added to the prompt automatically for every listed asset and shown as swatches on its review-deck slide. Make or extend one when several assets share a setting, instead of re-describing colours per prompt.
   **Keep the old visual's colours** unless a comment asks to change them: measure the sea, sky and background (`media_run` `palette` on a crop) and describe them in words as a must-have (e.g. "light, luminous aqua-turquoise sea, never navy"). Models drift to deeper, greyer blues when the colour isn't pinned.
   Write the description so someone could set up the shot from it alone:** camera (height, lens, framing, how large the products are), composition left to right and front to back (what fills which part of the frame, what's behind what, what's blurred), each product (where, what it rests on or leans against, which way it tilts or turns, how it sits in the surface, its front facing the camera), light (direction, quality, highlights, shadows, flares), colour and mood. Angles in words, never digits.
6. Use the model that renders small text best for product labels, and check every label letter for letter afterwards.
7. **Check against the comments before showing it.** Make a table: one row per change the comments ask for (and "keep placement" when they say so), ✓ or ✗ for each image, plus labels. Fixing one thing must not undo another: a placement fix that loses the requested rocks or setting fails. Show the table with the images, and say plainly which ones fail.

**Never edit unless asked, and never rewrite a prompt that worked.** "Change X", "fix Y", "remove Z", "regenerate this but…" all mean:
1. Take that version's exact prompt from its record (`history`, or `_records/generations/<id>.yaml` → `prompt`), with its inputs (packshots) and model.
2. Change only the words for what the person named, by **replacing** the old detail where it is (swap the word, rewrite that one sentence), never by appending a correction or a "not …" line. The prompt must read as if written fresh with the new requirement; every other line stays exactly as it was. Describe what you want, not what it shouldn't be; add a negative only when the model keeps ignoring that point.
3. Generate a new image with `image_generate` (a new version; the old one stays in history), then say in one line what you changed in the prompt.
Write a new prompt from scratch only for a new direction, or when the person asks for one. Use `image_edit` only when the person explicitly says to edit that image.

## Review deck
The project's review deck (Google Slides, updated in place so comments stay attached) has its own skill: `review-deck`. Read it before running `review_deck`, writing changes requested or comment points, shortlisting, or changing a slide layout. In short: run `drive_push_versions` then `review_deck` after making or reviewing versions; never `rebuild: true` unless asked; respect `paused`; never post or resolve comments without asking.

## What the person tells you about people and light
Casting and lighting preferences learnt while working (e.g. the model's look, how soft or strong the shadows should be) go into `brand/notes/` as a draft, and you read them before generating people. Only the person promotes a note to `brand/brand.md`.

## Google Drive (when connected)
- The client's Drive folder is the shared library. `search` with `kinds: [drive_file]` finds files by name, folder and description once `drive_index` has run. `drive_fetch` downloads one (cached), then use it as an input by `sha`.
- `drive_save` puts an image in `<client folder>/Studio/<project>/` and records the link. Saving twice returns the first upload.
- If a Google tool says Google isn't connected, the person runs `studio connect google` in their own terminal.

## Images and history
- Make images only with `image_generate`, change them only with `image_edit` / `image_upscale`. Anything else has no history.
- `instruction` = the person's words, verbatim. `prompt` = your final prompt. `what_changed` = one line for edits.
- Open the returned files and look before you describe them.
- Approve / reject only when the person decides (`review`). You may like, rate or comment.

## Cost
Real providers cost money (roughly $0.04–0.15 per image, more at 4K). Explore at 1K with 1–2 variations. Say the cost before more than 2 images at once or anything at 2K/4K. A daily cap stops runaway spend; never raise it unless asked. With no key, the studio makes free test images — fine for trying flows.

## Words
Say Image, Version (v1, v2), History, Refine, New direction, Approved, Rejected, Needs review. Avoid generation, lineage, hash, record.

## When something fails
Call `studio_status` and report the one fix it gives. Keys are typed by the person in their own terminal (`studio keys set gemini`); never ask for a key in chat.

## When the working deck renumbers its assets
The code in the slide's own code box is the asset's code (a code in the header table can be a hidden leftover). After a re-sync, match local asset folders to the deck by content (product, key messaging, creative idea), not by number. Then:
1. Write `projects/<p>/renumber.yaml` (`renumbers: [{at, map: {OLD: NEW}, dropped: [...]}]`). Records are never edited; versions made before `at` are read with the new code.
2. Rename the asset folders and set `code` (keep `code_was`); move dropped assets to `_dropped-<folder>`.
3. Update `links.review_deck.assets`, then `organise_folders`, `drive_push_versions` (moves Drive files to the new code folders) and `review_deck`.
