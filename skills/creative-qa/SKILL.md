---
name: creative-qa
description: Check a studio image against its deliverable — messaging, open deck comments, product and label fidelity, execution craft, format and approved brand rules (brand.md) — scoring each area 1–5 against fixed anchors, with concrete fixes that can be pasted into a refine. QA advises; it never approves or rejects. Use this whenever you check or review an image, explain why an image doesn't meet the brief, or the person asks "is this good?".
metadata:
  area: qa
  version: "1.0.0"
  tools: [qa_basics, qa_record, history, client_context, product_list]
---

# Creative QA

Open the image and look at it, together with what it must satisfy: the deliverable's messaging and open deck comments (`client_context` (query: the deliverable code)), approved brand rules (brand.md) (`client_context`), and the image's own record (`history`: prompt, references, format). Judge only what is visible, write a short record for the person, and suggest fixes. You never approve, reject or make images yourself unless asked.

Rubric version: `image-v2`. Bump the version whenever the areas, anchors or weights change, so older checks stay interpretable.

## Scores
Score each area **1–5** by these anchors. Pick the anchor that describes the image; don't average in your head.

| Score | Means |
|---|---|
| 5 | ready to use |
| 4 | small touch-ups |
| 3 | usable with clear fixes |
| 2 | major problems |
| 1 | wrong or missing |
| null | not assessed (say why) |

## What to check
| Area | What scores well |
|---|---|
| `messaging` | The image carries the deliverable's **key message** and **creative description**, and acts on each **open deck comment and client remark** that applies. A comment ignored scores low. Supers and other copy are added in layout: leave them out with the note "added in layout". |
| `brief_alignment` | The image serves the campaign and audience and realises the direction the person gave. "Asked for calm, got clinical" scores low even if the image is pretty. |
| `visual_execution` | **No added copy:** any text, badge, logo or graphic that isn't printed on the product packaging is a fail. Props and set dressing asked for are fine; judge only whether they look right. Composition, lighting, believable physics and anatomy, no artefacts. **Product fidelity:** the product is recognisably the real packaging (compare with its product shot), and label text matches the product's real name letter for letter. A near-miss wordmark ("BRAMD") fails: quote it. **Front facing:** each product's front (logo and label text) is visible unless the brief or a comment asks otherwise; a product turned away or with its logo hidden is a major issue. |
| `technical` | Pixel size and ratio match the requested format. Read them from `history` (files' width and height): 5 when the ratio matches, 1 when it doesn't. |
| `brand_alignment` | Palette, tone and do's and don'ts from approved brand rules (brand.md). Score null when there is none. |

For each area give a `score`, a one-sentence `note` about what is visible, and a `severity` (none / minor / major / critical). If you can't see something (tiny text, for example), score null and say why. Don't guess.

**Aesthetic grade (optional):** poor / competent / strong / exceptional, against premium commercial photography, naming what lifts or lowers it. It never decides the verdict.

## Overall and verdict (a fixed rule, so it means the same every time)
- **Overall:** the weighted mean of the scored areas, to one decimal: messaging 0.30, brief alignment 0.25, visual execution 0.25, brand alignment 0.15, technical 0.05. Areas scored null drop out. Any critical finding caps it at 2.
- **Meets the brief:** overall 4.0 or more, no area below 3, and nothing critical.
- **Needs changes:** anything else.
- **Can't check:** the image is corrupt, blank or the wrong file.

## Suggestions
Up to 3. Each is one concrete instruction under 25 words, phrased as **what to change**, so it can be pasted straight into Refine: *"Show the bottle's cap closed and add a soft contact shadow under it."*

## Labels and repeat failures
- **Label check:** compare visible label text against the product's real name, letter by letter. Report clean / wrong (quote it) / no text visible. A wrong label is a fail in `visual_execution`; suggest a new version, not a retouch.
- **Known product quirks:** when a product fails the same way every time (a word that always comes out misspelled), check it first and name it in the suggestion. Suggest it as client knowledge (a draft note in `clients/<client>/knowledge/` (`status: draft`), kind `products`) so it's remembered.
- **Stop-loss:** if this is the 5th version in one history and the same problem persists, say so and suggest a different route (a new reference, a different angle, compositing or a manual retouch) instead of another refine.

## Save it
Run `qa_basics` first (format, resolution, palette: measured, not judged) and use it for `technical` and `brand_alignment`. When done, call `qa_record` with the scores, the labels you read (`expected` from `product_list`, `read` letter by letter, `ok`), up to 3 suggestions and a one-line summary. The verdict and overall are computed from your scores by the rule above. Don't compute them yourself. The check then shows on the image in the Workbench.

## Reply
A short record: the verdict in plain words, the areas that scored below 4 with their notes, and the suggestions. Leave approving or rejecting to the person in the studio.

## Never
- approve or reject;
- invent problems to seem thorough. A high score with an honest summary is a fine answer.
