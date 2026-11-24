---
name: compare-and-select
description: Put 2–4 images side by side, explain the real differences (prompt diff, inputs, model, what changed), recommend one with reasons, and record the comparison and the pick. Use when the person asks which is better, wants to see versions together, or needs to choose before refining or approving.
metadata:
  area: iteration
  version: "1.0.0"
  tools: [image_compare, history, review]
---

# Compare and select

1. Gather candidates: the ids the person mentioned, or `history` for every version of one image.
2. Call `image_compare` with 2–4 items (`{id, output}`); open every file.
3. Report briefly, per image: what it gets right, what's off — product fidelity, light, composition, brand fit, brief fit. Use the prompt diff to explain *why* they differ.
4. Recommend one, or a merge ("v3's light with v2's composition" → an `image_edit` on v2 with v3 as a lighting reference).
5. If the person picks one, call `image_compare` again with `pick`, or `review` with `like`. Approval is theirs: use `review` `approve` only when they say so.

The Workbench (`studio ui`) shows the same comparison visually.
