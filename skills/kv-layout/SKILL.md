---
name: kv-layout
description: Lay out key visuals and format sets in Figma — one frame per size at exact pixels, the approved image as fill, headline, super, logo and legal inside the safe box, banners built from cut-out product plus background — using the person's Figma tools. Use when copy or a logo must go on an image, for adapt sets, extreme banner sizes, or a visual moodboard.
metadata:
  area: campaign
  version: "1.0.0"
  tools: [adapt_plan, history, client_context, drive_save]
  needs: [figma]
---

# Key visual layouts in Figma

Image models render copy badly, so copy, logos and legal lines go on in layout. This skill uses the **person's Figma tools** (the Figma MCP server). If they aren't connected, say so and stop: everything else in the studio works without Figma.

## Before you start
1. Load the Figma tool instructions first (with the official Figma plugin, the `figma-use` skill). Follow them for every Figma write.
2. Find the file: `client.yaml` → `links.figma`, or ask for a link. Prefer the brand's own template file. If there's none, create a new file named `<Client> — <Project> adapts`.
3. Get the plan: `adapt_plan` with the approved KV and the sizes. Get the copy (headline, super, CTA, legal) verbatim from the deliverable brief via `client_context`. Get the logo from the client's Drive (`search` kind `drive_file`, then `drive_fetch`).

## Build
- **One frame per size**, named after the format (`INSTAGRAM_STORY 1080×1920`), at exact pixels, laid out in a row on a page named after the KV.
- **Image:** the KV, or its recomposed version for that size, as the frame's fill (`crop` sizes use the plan's crop box). For `layout` sizes (strips, extreme ratios), use a background from the KV (extended, or a flat or gradient fill sampled from its palette), with the product cut-out placed inside the safe box.
- **Safe box:** draw it as a locked, hidden guide rectangle from the plan's `safe.rect`. **Every** logo, headline, super, CTA, legal line and badge sits inside it. Scale the copy block to fit, rather than letting it spill.
- **Archetype** (from the plan) decides the arrangement: `hero-faithful` keeps the KV composition with copy in its clear space; `vertical-stack` puts copy above or below the product; `horizontal-split` puts the product on one side and copy on the other; `single-strip` is logo, short line and CTA in a row; `compact-box` is a cropped product with one line.
- **Type and colour** come from brand.md (approved). If brand.md is empty, ask, rather than guessing fonts.

## Check and hand off
- Screenshot each frame and check: copy is verbatim (letter by letter), nothing critical is outside the safe box, the product isn't covered, the logo isn't distorted.
- Report in a few lines with the Figma link. Exported finals can be saved to Drive with `drive_save` when they're studio images. For Figma exports, give the person the frame names to export.

## Visual moodboards
For a research board: make a page named after the board, place its images in a grid with each one's "take" as a caption, and put the board's notes at the top.
