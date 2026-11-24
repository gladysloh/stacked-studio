# Treatment template — `video-concept.md`

Fill this in during Phase B. It is the director's brief for the film: what it is, the one idea, the vibe the KVs lock, and the shot-by-shot storyboard. Keep it tight and decisive — it's a creative document, not a spec dump. Scale each section to the asset; a 6-second social reel does not need pages.

Copy the structure below into `clients/<client>/projects/<project>/concepts/<concept>-video.md`.

````markdown
---
type: video-concept
asset: "{Asset label — verbatim from shotlist/jobs spec}"
brief: {brief-slug}
format: {aspect-ratio} · ≤{N}s · {sound-off|sound-on} · subtle motion (Remotion on stills, no i2v)
status: draft
handoff: docs/superpowers/specs/2026-06-05-kv-to-video-handoff-design.md
---

# Video Concept — {Asset title}

## Logline
{One or two sentences: what the viewer watches, start to finish. Concrete, present-tense, no jargon.}

## Single idea
{The one thing this film proves, and HOW the edit proves it — i.e. what changes on each cut that
carries the message. This is the spine; every beat serves it.}

## Vibe (what the KVs lock)
{4–6 bullets: the set/world, the hero treatment, the light, the pace, the on-screen-copy register.
Pull palette/lighting/tone from brand-guidelines.md + generation-guide.md — do not invent a look.}

## Storyboard — {N} shots that cut together
{Designed for variety of shot + angle, not N look-alike heroes. Each beat names the vibe KV it is
built from; the editor animates the still rather than rendering new motion.}

| # | t (s) | Beat | Vibe KV | Shot · angle | Motion | Super |
|---|---|---|---|---|---|---|
| 1 | 0.0–{a} | {Establish} | `NN-{slug}` | {Wide, eye-level — …} | {Slow push-in} | **{super}** |
| 2 | {a}–{b} | {…} | `NN-{slug}` | {Low ¾ on …} | {Parallax + …} | — |
| … | … | … | … | … | … | … |
| N | {y}–{N} | {Lock-up} | `NN-{slug}` | {Hero, space for super} | {Settle + hold} | **{super} · {product name} · logo** |

**Connective motif:** {the one transition/idea that links the cuts — e.g. the tool swap, a match-cut
on the product body, a travelling clean-path. This is the brief's motion intent read as an edit.}

**{Map} covered:** {if the brief gives a surface/scenario/attachment map, show the full list is covered
across the beats — the proof of versatility/range.}

## What stays open (editor decides)
{The genuine choices left to the video-editor: alternate beats that exist, transition grammar,
any beat awaiting a missing asset. Keeps the handoff honest.}

## Handoff to video-editor
Per `docs/superpowers/specs/2026-06-05-kv-to-video-handoff-design.md`. See `handoff.json` in this folder.
````

## Notes on filling it in

- **Logline before storyboard.** If you can't say the film in two sentences, the storyboard will wander.
- **The storyboard table is the contract.** Each row maps 1:1 to a vibe KV you render in Phase C and to a beat in `handoff.json`. Keep the `NN-{slug}` references accurate as shot numbers settle.
- **Timing adds up to `seconds`.** Reserve ~1s for the establishing open and ~1s for the lock-up/super close; divide the rest across the action beats.
- **Supers are sparse and on-brand.** Sound-off means copy carries meaning — but two or three supers across the whole film, not one per beat.
