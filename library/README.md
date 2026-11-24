# Shot library

A shared vocabulary for commercial images: **angles, placements and layouts, poses, hands, lighting, surfaces, motion and framing**. Each entry gives the studio and its agents:

- `prompt`: the wording image models reliably follow
- `use_when` / `watch_out`: when it works, and the known problems (for example, labels hidden by a top-down angle)
- `search`: search terms for finding references (`{subject}` = what you're shooting, e.g. "serum bottle"; `{category}` = e.g. "skincare")
- `related`: entries that pair well

`subjects.yaml` maps a subject (product, model, product with model, food and beverage, texture…) to the categories and searches that matter for it.

**Examples are private.** References in client and scratch folders are tagged with entry ids (`shots: [angle.low-hero, placement.podium]`). The `shot_library` tool shows each entry with your team's own tagged examples. This folder holds only the vocabulary.

To add an entry: put it in the right file with a unique `id` (`<category>.<name>`), and keep `prompt` short and concrete.
