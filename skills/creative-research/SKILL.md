---
name: creative-research
description: Visual and market research — Pinterest and web references, competitor campaigns, trends, category conventions — collected into a moodboard with sources and notes on what to take from each. Use when the person asks to research, find references, build a moodboard, look at competitors or trends, or "see what's out there" before concepts.
metadata:
  area: research
  version: "1.0.0"
  tools: [search, client_context, image_generate]
---

# Creative research and moodboards

1. **Scope:** what's the board for (a concept, a deliverable, a pitch)? 3–5 search themes, e.g. "warm botanical skincare still life", "competitor X 2026 campaign".
2. **Collect** with the tools you have:
   - Web search and page fetch for campaigns, trends and articles.
   - Pinterest: the person's boards listed in `client.yaml` → `links.pinterest`, or public pins via search. (A logged-in Pinterest scraper is part of the optional media tools.)
   - The client's own past work and references: `search` with `kinds: [past_work, reference]`.
   - The person's browser tools, if connected, for pages that need a login.
3. **Write the board** to `clients/<client>/research/<slug>/board.yaml` (or `clients/_scratch/research/` without a client):
   ```yaml
   name: Warm botanical still life
   for: EPS005 concept routes
   notes: What the set of references says, in 2–3 lines.
   items:
     - title: Brand X serum launch
       url: https://...
       image: https://...        # or a local file you saved under research/<slug>/
       take: Low side light through leaves; amber glass glow
       tags: [lighting, competitor]
   ```
   Save images you'll actually use as inputs into the board folder, so `image_generate` can take them by `path`.
4. **Summarise** patterns (light, palette, composition, casting), gaps worth owning, and clichés to avoid. Research is `unverified` context — never treat it as brand rules.
5. If the person wants a visual board, they can open the folder, or you can make a Figma moodboard with the Figma tools when connected.
