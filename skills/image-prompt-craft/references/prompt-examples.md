# Prompt examples — external corpus

Curated prompts collected from the wild — Midjourney showcases, Gemini showcases, SD/Flux galleries, articles on prompt engineering. Used as reference material by `/concept-generator` and `/reference-to-concept` Phase 1 ("Write the prompt") for compositional inspiration.

This is **not** a template library — entries are real prompts written for specific deliverables, kept verbatim. The agent reads them as canonical examples ("this is what good looks like for this composition / lighting / camera setup") and adapts the patterns for the active brief, never copy-pastes.

## How the agent uses this file

1. Scan the **Index by tag** below.
2. Pick 1–3 entries whose tags match the active brief (composition shape + camera angle + lighting register are the load-bearing axes).
3. Read those entries' prompts and the **Why exemplary** notes.
4. Lift the *technique* (e.g. triple-anchored camera angle, decoupled surface clause, verification phrase), not the vocabulary.
5. If the entry's `Original target model` differs from the model being used, consult the **Notes for Gemini adaptation** before adapting verbatim.

## Cross-model drift — important

A prompt that nails it on Midjourney v6 often flops on Gemini 3, and vice versa. Different models have different priors over composition, negative-prompt handling, aspect-ratio honouring, and how literally they read camera/lens vocabulary. Every entry tags its **Original target model** so the agent knows whether to use verbatim or adapt.

Common adaptation moves Midjourney → Gemini:
- Drop MJ-specific flags (`--ar`, `--v`, `--stylize`, `--chaos`).
- Convert "negative prompts" written as `--no` into explicit prohibition sentences ("No X. No Y.").
- Add explicit **verification phrases** for camera angles ("with the bottom of the bottle clearly visible") — Gemini commits to geometric tests far more than to abstract direction.
- Flatten compound modifier stacks ("ultra-realistic, sharp, 8k, hyperdetailed, masterpiece") to a single mood descriptor — Gemini reads stacks as noise.

Common moves SD/Flux → Gemini:
- Drop weight syntax `(token:1.3)`.
- Drop LoRA / model-name references.
- Convert technique words ("DSLR", "Sony A7", "85mm f/1.4") into structural cues — Gemini reads the *result* (shallow DOF, compression) better than the camera spec.

---

## Index by tag

Composition:
- product-still-life: 001
- single-hero: 001
- duo: _(none yet)_
- trio: 002
- multi-product: 002
- macro: _(none yet)_
- editorial-fashion: _(none yet)_

Camera:
- low-angle / worm-eye: 001
- top-down: _(none yet)_
- eye-level: 002
- elevated: 002

Surface / staging:
- decoupled-surface: 001
- glass-shelf: _(none yet)_
- floating: _(none yet)_
- on-stone / on-fabric: _(none yet)_

Lighting:
- soft-studio: 001
- dramatic-side: _(none yet)_
- backlit / rim: _(none yet)_

Backdrop:
- white-bg: 001
- gradient: 002
- bokeh: _(none yet)_

Technique:
- verification-phrase: 001
- triple-anchored-camera: 001
- liquid-droplets: 001
- iterative-nudge: 002
- relative-delta: 002
- vertical-axis-rotation: 002
- ancestor-anchoring: 002

---

## Entry template

When adding a new entry, use this exact shape so the agent can parse it consistently:

```markdown
### NNN — Short descriptive title

**Source:** <URL or attribution>
**Tags:** tag1, tag2, tag3
**Original target model:** Midjourney v6 / Gemini 3 / SD3 / DALL-E 3 / Flux / unknown
**Why exemplary:** one-line note on what makes this worth keeping

**Prompt:**

> Verbatim text. Multi-line if the original was multi-line. Don't paraphrase.

**Notes for Gemini adaptation:** _(optional, only if target ≠ Gemini)_

- Adaptation note 1
- Adaptation note 2
```

Numbering is monotonic (001, 002, 003 …). Don't reuse numbers; deletions leave gaps.

---

## Entries

### 001 — Beauty serum bottle, worm's-eye, decoupled glass

**Source:** unknown — found on the internet (TODO: add URL when remembered)
**Tags:** product-still-life, single-hero, low-angle, worm-eye, decoupled-surface, soft-studio, white-bg, verification-phrase, triple-anchored-camera, liquid-droplets, beauty
**Original target model:** unknown (likely Midjourney or Gemini — the structure reads as Gemini-friendly)
**Why exemplary:** anchors the camera angle in three independent ways — explicit position ("from below"), explicit tilt ("looking upward"), and a geometric verification phrase ("with the bottom of the bottle clearly visible") the model can concretely test. Then uses a photographic-setup analogy ("perspective mimics a shot taken through glass from below") and immediately decouples it ("but without any glass present"), preserving the geometry without committing to the literal surface. The redundancy is what makes the model commit to the dramatic angle instead of softening to its eye-level prior.

**Prompt:**

> Create a highly realistic beauty product photoshoot of a serum bottle. Camera angle from below, looking upward, with the bottom of the bottle clearly visible.
> The perspective mimics a shot taken through glass from below, but without any glass present. Maintain correct proportions with no perspective distortion.
> Surround the serum bottle with realistic liquid droplets, preserving their natural shape and placement. Focus on fine details and textures of the serum packaging Soft studio lighting with gentle shadows, high contrast detail clarity. Use a clean, solid white background. Ultra-realistic, sharp, premium beauty photography.

**Techniques to lift:**

| Phrase | Role |
|---|---|
| "Camera angle from below" | Explicit camera position. |
| "looking upward" | Camera tilt — distinct from position (camera can be below with lens horizontal vs lens tilted up). |
| "with the bottom of the bottle clearly visible" | **Verification phrase** — gives the model a concrete geometric test. Far more reliable than abstract "low angle". |
| "perspective mimics a shot taken through glass from below" | Photographic-setup analogy — anchors to a known studio convention. |
| "but without any glass present" | **Decoupling clause** — separates camera position from surface visibility. Keeps the geometry, drops the literal glass. |
| "Maintain correct proportions with no perspective distortion" | **Counter-default clause** — fights the wide-angle distortion (curved verticals, bulging) that low-angle shots usually produce. |

**Generalisations:**

- The verification-phrase technique transfers to other angles: top-down → "with the lid's full top surface clearly visible"; macro → "with surface texture readable at thread-by-thread detail".
- The decouple-the-surface trick transfers anywhere the operator wants the geometric effect of a setup (glass shelf, mirror, water surface) without the literal surface in frame.

**Notes for Gemini adaptation:**

- "Ultra-realistic, sharp, premium beauty photography" reads cleanly on Gemini — keep verbatim.
- Drop "Ultra-realistic, sharp" if the entry is being adapted to Midjourney; MJ reads stacks of modifiers as a stylise nudge, which can over-process.
- For Gemini specifically, consider explicitly suppressing perspective distortion AND barrel-distortion separately: "no fisheye warping, no curved verticals, no edge distortion." Gemini sometimes interprets "no perspective distortion" as a soft suggestion.

---

_Add entries below this line. Keep the template shape exact._

### 002 — Iterative-nudge rotation on a multi-product trio

**Source:** internal — the client trio iteration session, 2026-05-05 (`a packaging iteration session` shots #44–#61)
**Tags:** trio, multi-product, vertical-axis-rotation, iterative-nudge, relative-delta, ancestor-anchoring, eye-level, gradient, beauty
**Original target model:** Gemini 3 Pro (production tier, 4K)
**Why exemplary:** documents a hard-won pattern for overriding a stubborn pose on one product within a multi-product composition. After 8+ failed attempts using **absolute rotation targets** ("rotate 45°", "rotate to opposite direction", "mirror the reference") — all of which Gemini ignored in favour of matching the visual reference — a series of **small relative deltas** (+10° per iteration) anchored on the closest-correct ancestor finally landed. The lesson: style references in image-conditioned generation operate as strong visual priors that text can *nudge* but not *override*. Crossing too far from a reference's pose triggers the model to "snap back" to the reference. The right pattern is iterative refinement, not one-shot absolute targets.

**Prompt** (the +10° iteration that succeeded — parented on the closest-correct ancestor):

> Match the reference image's composition, palette, lighting, and product placement EXACTLY — same descending diagonal of three cream jar jars, same hero front-square in foreground, same back-right gentle 3/4 turn, same warm-black background, same champagne-gold swirl, same floor reflection treatment.
>
> The ONLY change from the reference: the BACK-LEFT cream jar jar (the most-back, upper-left of the descending diagonal) is rotated 10 DEGREES MORE about its vertical axis than the reference shows for that jar — same direction as the reference's existing rotation, just pushed 10 degrees further. The jar stays upright with the same forward lean / camera angle as the reference; only the vertical-axis rotation increases by 10 degrees.
>
> Visual outcome of this 10-degree-more rotation:
> - The lid's V WEDGE FACET LINES — the parallel etched groove lines that fan out from the V-form crown across the lid surface — become MORE VISIBLE than in the reference. The 10-degree-stronger turn exposes more of these lines to the camera.
> - The label is angled slightly steeper than in the reference, with more of the jar's side-body surface visible.
> - Same direction of rotation as the reference. Do NOT flip the direction. Do NOT tilt or lean the jar more than the reference already does.
>
> HERO JAR (foreground centre): unchanged from the reference.
> BACK-RIGHT JAR (upper right): unchanged from the reference.
> Background, lighting, swirl, floor: unchanged from the reference.

**Techniques to lift:**

| Phrase | Role |
|---|---|
| "Match the reference image's composition … EXACTLY" | Locks every property except the named delta. Gives Gemini one variable to change, everything else preserved. |
| "10 DEGREES MORE about its vertical axis than the reference shows" | **Relative delta** — small enough to interpolate, not large enough to trigger "snap back" to the reference. |
| "same direction as the reference's existing rotation, just pushed 10 degrees further" | **Direction-preserve clause** — removes the model's ability to flip direction, which it does by default when text contradicts the visual reference. |
| "Do NOT flip the direction. Do NOT tilt or lean the jar more than the reference already does." | Anti-pattern callout — names the wrong outcomes that Gemini gravitated to in earlier attempts. |
| Visual outcome described as "MORE visible" / "slightly steeper" / "more of the side-body surface visible" | Relative descriptors anchored on the reference, not absolute targets. The model can render "more X than the reference" by interpolating; it can't reliably render "X" in isolation. |

**Why absolute targets failed (8+ attempts) and relative deltas worked:**

Earlier attempts used absolute targets:
- *"Rotate 45 degrees clockwise"* → ignored, model matched the reference's ~25° in the opposite direction
- *"Rotate to opposite direction from the reference"* → produced a mirror, but the visual content was still pulled toward the reference
- *"Pushed close to a 90-degree profile"* → model interpreted as a forward tilt instead of vertical-axis rotation, because tilting was the "easier" way to expose the lid

The successful pattern was a chain of small relative pushes anchored on the closest-correct ancestor:
1. Find or generate a baseline that has the right *direction* (even if under-rotated). For this case: shot #57.
2. Parent the next attempt on that baseline, push +10° in the same direction.
3. If still under-rotated, parent on the new attempt and push another +10°.
4. Each step's small enough that the model interpolates rather than fights the reference; the cumulative push gets you to the absolute target without ever asking for it directly.

**Generalisations to other axes:**

The iterative-nudge pattern transfers to any property where Gemini resists absolute targets:
- **Palette shifts**: instead of "make the background pure red," anchor on a warmer baseline and ask for "10% more saturation toward red than the reference."
- **Crop tightening**: "5% tighter crop than the reference" rather than "tight crop."
- **Lighting changes**: "slightly more dramatic side-lighting than the reference" rather than "high-key dramatic side-light."

The technique is essentially Newton's method for image generation: iterate small steps toward the target, anchoring each step on the previous result.

**Notes for Gemini adaptation:**

- Pro tier (`gemini-3-pro-image-preview`) follows relative-delta language much more reliably than Flash. The pattern works on Flash but tends to need 2–3× as many iterations. Default to Pro when iteration cost is acceptable.
- Always parent on the *previous result* in the chain, not on the original target reference. The chain converges; restarting from the original target restarts the fight with the reference's prior.
- Stop-loss: if 3+ relative-delta iterations haven't moved the result, the property may not be controllable via text alone — escalate to `/composite-shot` or accept that some other property has to change to make the desired one possible (e.g., camera angle reposition).
