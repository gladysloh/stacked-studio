---
name: creative-research
description: Reference research and moodboards that know what they're looking for — product photos, dynamic product layouts, angles and groupings for products; poses, hand holds and application for models; smears and drops for textures — across Pinterest, the web, Behance and competitors, saved as a tagged moodboard. Use when the person asks to research, find references, build a moodboard, look at competitors or trends, or "see what's out there" before concepts or a shoot.
metadata:
  area: research
  version: "2.0.0"
  tools: [research_plan, image_search, pinterest_board, moodboard_save, reference_tag, shot_library, search, client_context]
---

# Reference research and moodboards

## 1. Plan the searches
Work out the **subject**: `product`, `product_with_model`, `model`, `hands`, `texture`, `food_beverage`, `fashion`, `device` or `interior`. A brief can have several, for example a product hero plus a texture frame. Call `research_plan` once per subject, passing:
- `subject_name` (what exactly, e.g. "amber glass serum bottle") and `category` (e.g. "skincare");
- `shots`, only when the person named specific looks ("low angle on a podium", "floating with petals"). Find their ids with `shot_library` (query). Otherwise the plan leads with each subject's most useful shots, such as dynamic layouts for products and poses and holds for models;
- `client`, so competitors from `client.yaml` are included.

Before searching, check what the team already has: `shot_library` with an id lists tagged examples, and `search` (kinds `reference`, `past_work`, `research`) finds the client's own material.

## 2. Search
- **With an image-search key** (the plan says `image_search: brave|serpapi`): call `image_search` for the queries that matter, about 20 results each, then look at the results. Prefer brand sites, campaign pages and photographers' portfolios over aggregators.
- **Without a key:** use your own web search and browser on the plan's queries; each query includes Pinterest, Google Images and Behance links. Collect direct image links where you can.
- **Pinterest boards** the person gives, or `client.yaml` → `links.pinterest`: `pinterest_board`. This reads public boards only, with no login.

Keep only references with a clear **take**, meaning one specific thing to borrow. Ten great references beat fifty average ones. Skip watermarked stock comps and anything off-brief.

## 3. Save and tag
1. `moodboard_save` with the board name, `for` (what it's for), `notes` (what the set says), and items with `title`, `url`, `image_url`, `take`, `subject`, and `shots` when you already know them.
2. It returns `untagged` images. **Open each one** and call `reference_tag` with the shot ids it clearly shows: angle, placement, lighting, surface, motion, pose, hands, framing. Usually 2–4 ids. Tag only what you can see, and look the ids up with `shot_library` if unsure. Tagged images become the team's examples in the shot library.
3. Without a client, boards go to scratch. Client boards are private and travel with `studio client sync`.

## 4. Report
In a few lines:
- the patterns, named with shot-library names ("most launches use a low-angle hero on a plinth with backlit glass");
- the gaps worth owning, and the clichés to avoid;
- the board's location.

Offer the next step (concepts, or a first image using the best references as `style` / `reference` inputs by `sha`). Research is unverified context: never write it into brand.md.

## Visual boards in Figma
With the Figma tools connected, follow `kv-layout` → Visual moodboards.
