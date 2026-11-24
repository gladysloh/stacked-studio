---
name: product-visual-set
description: Pipeline for a set of on-brand product visuals — pull the client's brand rules, products and references, make several options, refine the chosen one, compare, and save the approved image (to Google Drive when connected). Use for requests like "use <client>'s guidelines and references to make four product visuals, refine the second, compare and save the approved one".
metadata:
  area: product
  version: "1.0.0"
  steps: [studio, product-shot, image-generate, image-edit, compare-and-select]
---

# On-brand product visual set

1. `client_context` (client + "product visuals for <product>"). Note approved rules, product cutouts (`products/`), and 1–2 best style references.
2. Write one strong prompt (see `product-shot`, `image-prompt-craft`); `image_generate` with `n` as asked (say the cost), products first in `inputs`, `context_used` filled in.
3. Open all outputs, number them 1..n in your reply (they are outputs 0..n-1).
4. Refine the one the person names: `image_edit` mode `edit`, `output` = their number − 1, prompt = only the change.
5. `image_compare` original vs refined. Report the differences.
6. When the person approves: `review` `approve`, then `drive_save` (it goes to the client's folder under `Studio/<project>/` and the link is recorded). If Google isn't connected or the client has no Drive folder, say the one fix (`studio connect google` / `studio drive init <client>`) and give the local file path.
