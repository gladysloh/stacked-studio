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
