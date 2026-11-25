---
name: review-deck
description: Make and keep up the project's review deck in Google Slides — the deck the team and client comment on. Covers which slide each asset gets (versions, selected image with plain comments, before / after with what changed, concept board, scene), writing the comments and change points in simple English from people's comments, shortlists, pausing, and updating in place so comments stay attached. Use whenever the person mentions the review deck, a draft or shortlist deck, slides for review, "put this in the deck", "update the deck", comments under an image, a before/after slide, or wants a new slide layout — even if they don't say "review deck".
metadata:
  area: review
  version: "1.0.0"
  tools: [review_deck, review_notes, deck_import, drive_push_versions, prune_rejected, history]
---

# Review deck

Each project has a review deck: a Google Slides file in the project's Drive folder (`04_Review Decks`), separate from the client's working deck. The studio draws it from files (records, `deliverable.yaml`, looks, `project.yaml`), so to change what a slide says you change those files and run `review_deck`, never edit the slides by hand.

The look is one plain template drawn by `core/review-deck.mjs`: white, one typeface, hairlines, 10 × 5.625 in. A sample with one of every slide type and made-up content: `docs/review-deck/sample.pptx` (rebuild it with `npm run sample:review-deck` after changing a layout). The layouts, as sketches: `references/slide-types.md`.

## Updating: in place, comments stay

After making or reviewing versions, run `drive_push_versions` then `review_deck` (no link needed after the first time; `deck: <link>` points it at a file). The deck is updated in place: only sections (cover, overview, each scene, each asset) whose content changed are redrawn, on the same slides. People comment on these slides, and a comment is attached to the element it was made on, so the drawing code keeps element ids and tags each image with its identity in its alt text. That is why:

- **Never use `rebuild: true`** unless the person asks for it by name: it replaces the whole file and every comment loses its place.
- Don't delete or recreate slides or images yourself to "fix" a deck. Change the files and run `review_deck`.
- Slides people move or add by hand are kept where they are; only new slides are placed (after the one before them).
- **Renamed assets keep their slides.** When the working deck renumbers assets, record it in `projects/<p>/renumber.yaml` (see the studio skill) and run `review_deck`: each renamed asset's slides move to its new code and are redrawn there, so comments on images and points stay (a comment on the code box itself may come loose). Only renumbers made after the deck was last drawn are applied, each once. A version's own id never changes; to word a caption differently, use `title` in `selected`.
- **`links.review_deck.paused: true`** in `project.yaml` stops all updates to that file. Set it when the person says not to touch the deck; only they lift it. Pointing at a new file starts that file fresh.
- **Never post, resolve or delete comments** without asking: comments go out in the person's name and the team gets notified. Write mentions as "(to <name>)", never an @email.
- After changing studio code, ask the person to reconnect `stacked-studio` (`/mcp`) in every other session: a stale server can overwrite the deck with old logic.

Rejected versions never appear (they stay in history and in `02_Rejected` on Drive); the overview only counts them. `prune_rejected` frees disk space once Drive holds them (run with `dry_run` first and say what will go).

## Which slides an asset gets

| The asset has | Slide(s) |
|---|---|
| `concept_board` (directions agreed before generating) | Concept board: three directions per slide, lettered A, B, C |
| Versions, no shortlist | Version slides: the current working-deck visual, then each version, with "changes requested" on the left. One slide per `review_groups` direction |
| A shortlist entry | One "Selected" slide per pick: the image large on the left, its comments as points |
| `compare` | Before / after: the preferred image large on the left, the options in a grid, what changed under each |
| A project look | Scene guide or "Chosen scene" slide, once for the group, after the overview |

### Selected image with comments (shortlist)

`links.review_deck.shortlist: { <code>: ["<version id>:<output>", …] }` in `project.yaml` shows only those versions (keep the full list in `assets_before_shortlist` so it can be restored). Each pick gets its own slide. Its points come from `deliverable.yaml`:

```yaml
selected:
  - version: "K3M9QZ:2"          # last characters of the version id : output number
    notes:
      - Add a lens flare, like the old visual.
      - Turn the bottle a little towards the sun.
  - version: "7TX2LB:0"
    title: Second option            # default "Selected"
    notes:
      - Keep this as the second option.
```

### Before / after

```yaml
compare:
  - name: "Rock colour: before and after"
    note: The version chosen earlier, then the new options. Under each option is what changed.
    before: "<version id>:0"
    after: ["<id>:0", "<id>:1"]
    edits:
      "<id>:0": [Warm brown rocks]
      "<id>:1": [Warm brown rocks, Stronger sun from the top right]
```

`edits` are what changed in the prompt compared with the `before` image, not what the person asked for. Diff the two prompts from their records (`_records/generations/<id>.yaml` → `prompt`) and name each changed detail in the prompt's own words. If you only go by the request, you'll miss a sentence that changed along the way, and that sentence is often why the image looks different. Keep `note` true for every option: if the options changed different things, say "what changed is under each option".

### Version slides and changes requested

Without a shortlist, the left column shows a summary of what needs to change, grouped by date, from `review_notes` in `deliverable.yaml` (or the `review_notes` tool):

```yaml
review_notes:
  - { date: 2026-11-24, change: "Make the beach feel warmer", from: "<first name>" }
  - { date: 2026-11-20, change: "Rocks look too smooth: make them more realistic", from: "<first name>", done: true }
```

After re-syncing the working deck (`deck_import`), read every comment and reply for the asset, open and resolved, and update the notes. Mark `done: true` when a comment is resolved or a version has dealt with it. Without notes, the deck falls back to the raw open comments. `review_groups: [{ name, versions: [<id ends>] }]` gives each direction its own slide; versions in no group go on "Other versions".

### Concept board and scene

- **Concept board:** `concept_board: [{ name, idea, refs: [<sha> or "references/x.png"], verdict?: liked | maybe | not_for_us }]`, up to three references each. Generate only the directions they pick.
- **Scene:** a project look (`projects/<p>/looks/<name>.yaml`, `applies_to: [codes]`) shows a Scene guide with `scene`, `light` and a swatch per element (`sky`, `sea`, `sand`, `rocks`… each `{ words, hex }`, with `only: [codes]` when some assets lack it), plus lettered `options:`. Once they pick, record `scene_name`, `scene`, `scene_keywords` (their words, short), `scene_images`, and move the rest to `archived_options`. The deck then shows one "Chosen scene" slide.

## Writing the points

People read these slides in a few seconds, often on a phone, sometimes for a client who wasn't in the thread. So each point is one change, in plain words anyone can act on:

- **Only what was said about that image.** Find which slide a comment sits on (its anchor) and which version is on that slide. Comments on another option, or on the asset in general, don't belong on this image's slide. If you can't tell which image a comment was about, say so to the person rather than guessing.
- **One change per point, as an instruction.** "Remove the stand under the bottle." not "stand?".
- **Simple English.** Fix typos, drop slang, jokes and filler, keep their meaning and their key words ("lens flare", "Mediterranean blue"). Short sentences.
- **No names, no "@".** The slide is about the image, not who said it.
- **A verdict is a point too.** "Keep this as the second option." / "This angle does not work." (with `title: Not working`).

| Comment | Points |
|---|---|
| "love this one!! but cn we get some lens flare like the old one? also bottle is kinda facing us too straight, turn it to the sun a bit" | Add a lens flare, like the old visual. · Turn the bottle a little towards the sun. |
| "cap looks pinkish lol" + "also it's way too big vs v1, go back to that size" | Fix the cap colour. It looks pink. · Make the bottle smaller, the same size as version 1. |
| "hmm the pose is a bit much, more natural? and her face towards camera" | Make the pose more natural. · Have her face the camera. |

Show the person the points (a short table is fine) when you add them, so they can correct wording before the client sees it.

## A new slide layout

When the person shows a mockup (often a slide they rearranged by hand), match it: read that slide's elements through the Slides API (positions, text) to get the sizes, then add or change a slide function in `core/review-deck.mjs`, with its data in `deliverable.yaml` rather than in code. Keep the header and footer the other slides use. Run `npm test`, rebuild the sample, update `references/slide-types.md`, then `review_deck`, and look at the result (page thumbnails from the Slides API) before saying it's done. Leave their mockup slide alone; they can delete it.
