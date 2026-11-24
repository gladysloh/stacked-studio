---
name: concept-directions
description: Develop distinct creative directions from a brief or idea — a named concept, the insight behind it, the visual world (setting, light, palette, props, casting), why it fits the brand, and a first prompt — then visualise the strongest ones. Use when the person wants ideas, "three concepts", routes, territories, or a starting point before making images.
metadata:
  area: concepts
  version: "1.0.0"
  tools: [client_context, search, image_generate, image_compare]
---

# Concept directions

1. **Ground it.** `client_context` with the brief's goal; `search` past work and approved images to avoid repeating last campaign. Note mandatories and what the client has rejected before (deck comments).
2. **Make them truly different.** Directions should differ in *idea*, not just colour. Spread across axes: literal ↔ metaphorical, product-hero ↔ world-hero, quiet ↔ bold, studio ↔ location.
3. **For each direction (default 3), write** `clients/<client>/projects/<project>/concepts/<slug>.md`:
   ```
   ---
   name: Golden Hour Ritual
   deliverable: EPS005        # if it belongs to one
   status: proposed
   ---
   # Golden Hour Ritual
   **Idea:** one sentence. **Insight:** why it lands with this audience.
   **Visual world:** setting, light, palette (hex), surfaces, props, casting.
   **Brand fit:** which approved rules it honours; risks.
   **First prompt:** the prompt you'd use (see image-prompt-craft).
   ```
4. **Show, don't just tell (ask first if it costs money):** one image per direction with `image_generate` (`concept` = the name), then `image_compare` across directions.
5. Ask the person which direction to push. Their choice → set `status: chosen` in that concept file.
