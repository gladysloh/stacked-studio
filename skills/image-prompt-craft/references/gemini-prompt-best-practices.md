# Gemini Image Generation — Prompt Best Practices

Reference for writing prompts in `prompts.json` that consistently produce high-quality, on-brief images from Gemini.

Sources: [Vertex AI image generation best practices](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/gemini-image-generation-best-practices) · [Gemini API image generation](https://ai.google.dev/gemini-api/docs/image-generation)

---

## Length rules — structure over length (READ THIS FIRST)

| Skill / scenario | Target prompt length | Why |
|---|---|---|
| **`/reference-to-concept`** (operator-supplied style ref in `references/`) | **<500 words**, structured | Reference is the spec; prompt adds direction. Rambling prose fights the reference — a structured spec doesn't. |
| **`/concept-generator`** (no operator style ref — brief + brand + product cutouts) | **<500 words**, structured | No reference to anchor composition, so the model needs verbal spec. Same structure rules apply. |
| **Pro / Nano Banana 2 multi-product compositions** (gemini-3-pro-image-preview with 2+ product cutouts + scene ref) | **≤200 words** | Pro/Nano Banana 2 attention degrades hard after ~80–120 words. With multi-image input + branded label text, the first 200 words carry the spec; everything after is fuzz. Anything over 300 words is doing too much — split into a compositing workflow instead. See [When to stop generative](#when-to-stop-generative--composite-instead) below. |

**Be direct. Structure over length.** An effective prompt names four dimensions, once each, without filler adjectives:

1. **Subject** — products + any hero non-product element, and the material/quality of each (e.g. "long-exposure golden light trails", not "polished metal rings")
2. **Environment** — background, surface, supporting elements, depth
3. **Lighting** — direction, quality, temperature, hero highlights
4. **Mood** — atmosphere, emotional register

Stop when those are covered. Don't restate what the reference already encodes. The word count is a ceiling, not a target — if you land at 120 words and all four dimensions are covered, you're done.

**Anti-patterns** (symptoms of padding rather than structuring — fix these whether you're at 100 words or 450):
- Same dimension described twice ("warm golden honey-coloured amber glow")
- Hex codes repeated for every visible element when the reference shows them
- Paragraph-long composition descriptions when the reference shows the composition
- Listing 8+ negative instructions when 2–3 cover the case
- Filler adjectives that don't change what the model produces ("beautiful", "stunning", "dramatic")

**History:** An earlier iteration capped reference-driven prompts at ≤100 words after 500-word rambling prompts destroyed reference fidelity. The root cause was rambling, not length — a structured <500-word prompt keeps the reference in the driver's seat; a rambling prompt doesn't, at any length.

---

## Attention budget — what to put first

Pro / Nano Banana 2 reads top-to-bottom and weights the front of the prompt more heavily. Lead with whatever's MOST FRAGILE in your generation. For branded skincare with readable product labels, that is almost always **product identity** — packaging shape, cap geometry, label text — not composition.

| Generation type | Lead with | Then | Then |
|---|---|---|---|
| **Branded product still with readable labels** (anniversary-trio, christmas-red-family, family-silk-luxe, etc.) | Product identity (each product's shape + label) | Layout / placement | Lighting / atmosphere |
| **Brand-anonymous concept exploration** (mood, composition study, no critical labels) | Composition / layout | Material / mood | Lighting |
| **Single-shot retouch / tweak via /tweak-prompt** | The clause being changed | (rest is inherited) | — |

**Why this matters:** If you open with "Place three products naturally on the stepped plinths in 9:16…" then describe products at word 250, the labels will drift. Lead instead with "Three the client products: (1) a gold metallic tube with brown V-chevron cap reading ACTIVE FORMULA / NIGHT REPAIR / CREAM, (2) a champagne-gold V-chevron-lid jar reading TOTAL V FIRMING CREAM, (3) a tall faceted-cap frosted serum bottle reading THE SERUM. Place them…". Identity gets the strong-attention window; placement gets the rest.

---

## Anchor naming — descriptive, not ordinal

**Don't** say "Image 1 / Image 2 / Image 3" and rely on the model to bind those to your multi-image input slots. Pro / Nano Banana 2 doesn't reliably honor ordinal labels — you'll get image-to-product mismatches where the long-label tube description ends up applied to the cream jar.

**Do** describe each product by its visible character: "the gold tube with the brown V-chevron cap", "the V-jar with the chevron lid and dark base", "the tall faceted-cap serum bottle". The descriptive anchor doubles as identity reinforcement and survives any reordering of the input slots.

---

## Prompt Structure

### Recommended order for product photography prompts

```
1. Photography style opener         — sets the aesthetic register immediately
2. Format / aspect ratio            — e.g. "9:16 vertical format"
3. Subject + product description    — exact packaging, materials, finish, details
4. Composition                      — angle, placement, arrangement, framing
5. Background                       — surface, colour (hex), texture, depth
6. Lighting                         — source, direction, quality, temperature
7. Brand constraints                — palette, hex values, mandatory visual elements
8. Negative instructions            — what to suppress (explicit > vague)
```

**Example (skincare client):**
```
Japanese luxury skincare editorial photography, 9:16 vertical format.
[Product: compact gold jar, V-wedge sides, tension band, fine relief lid]
[Composition: 3/4 front angle, centre-frame, complete product base to lid]
[Background: near-black (#0a0604), warm amber haze around product]
[Lighting: warm gold rim light on edges, single raking light from upper-left]
[Brand: warm champagne (#DFD4BD) and deep brown (#623B2A) colour world]
No background text, no floating copy, no watermarks — product labels on packaging are fine.
No models, no cool tones, no grey.
```

---

## Core Principles

### 1. Narrate, don't list keywords
Describe the scene as a sentence, not a tag list. The model's strength is language understanding.

- **Weak:** `dark background, gold rays, product centre, luxury`
- **Strong:** `The jar floats at centre-frame against a near-black background; warm gold metallic rays burst outward from behind it in all directions, filling the dark void with light`

### 2. Specificity = control
The more specific, the less the model guesses.

- **Weak:** `warm background`
- **Strong:** `warm polished amber stone surface (#623B2A), seamless warm champagne gradient (#DFD4BD) fading upward`

### 3. Positive description beats negative exclusion
Describe what IS in the scene rather than only what isn't.

- **Weak:** `no props, no botanicals`
- **Strong:** `clean warm champagne background, no surface props` (still include negatives, but lead with positives)

### 4. Describe light explicitly
Lighting is one of the highest-leverage variables. Always specify:
- **Direction** — upper-left, directly overhead, from behind
- **Quality** — raking, diffuse, directional, soft
- **Temperature** — warm gold, amber, cool — match to brand colour world
- **Effect** — rim light, specular highlight, halo pool, shadow

### 5. Name the camera
Photographic and cinematic terminology guides composition directly.

| Term | Effect |
|---|---|
| `3/4 front angle` | Sees packaging depth + front |
| `pure side profile` | Cleanest V-silhouette read |
| `worm's-eye, camera at base height` | Monumental, upward drama |
| `bird's-eye, directly overhead` | Flat-lay, symmetry |
| `45° three-quarter overhead` | Sees top + sides, no flat-lay |
| `low-angle, tilted slightly upward` | Product feels large, prestige |
| `macro / extreme close-up` | Surface texture as landscape |

---

## Reference Images

### Gemini 3.1 Flash supports up to 10 reference images
All `product_image_files` entries are passed before the prompt text, in order.

### Two roles: product reference vs style reference
When passing multiple reference images, explicitly label their roles in the prompt:

```
IMPORTANT: Reference image 1 (the cutout) is the PRODUCT REFERENCE — use its exact
packaging: [describe]. Reference image 2 is a STYLE AND LAYOUT REFERENCE ONLY —
match its [background / lighting / composition] but do NOT reproduce any text,
characters, logos, or graphics from it.
```

### Product cutout vs styled image vs KV
| Image type | When to pass | Risk if misused |
|---|---|---|
| `{product}-cutout.png` | Always — product fidelity reference | None |
| `{product}-styled.png` | When the scene styling should match | May constrain composition |
| `{product}-{campaign}-kv.png` | Style reference ONLY, never sole ref | Text/graphics bleed into output |

**Rule:** Always pass the cutout as image 1. If passing a KV for style, put it last and label it explicitly in the prompt.

---

## Negative Instructions

### What works
Be explicit and specific. Vague negatives are often ignored.

- **Weak:** `no text` → Gemini may still render product label text, which you want
- **Strong:** `No background text, no floating copy overlays, no watermarks — product packaging labels and branding on the jar are fine and should be visible`

### Standard negative block (skincare client)
```
No background text, no floating copy overlays, no watermarks — product packaging labels and branding on the jar are fine.
No models, no cool tones, no grey, no heavy drop shadows, no cluttered backgrounds, no cheap or over-saturated gold.
```

### When Gemini still adds unwanted elements
Add an explicit positive instruction for the negative you want:
- Instead of `no marketing text`: `The only text visible in the image is text physically printed on the product packaging itself`
- Instead of `no props`: `The product stands alone on a bare warm surface with no surrounding objects`

### Prune carry-forward negatives ruthlessly

A negative is worth including ONLY if the current model is actively producing that failure mode. Don't carry forward defensive negatives from past failed generations — they bloat the prompt, dilute the real instructions, and eat the Pro/Nano Banana attention budget that should be going to the product spec.

**Symptoms of carry-forward bloat:**
- 15+ negative clauses at the bottom of a prompt
- Negatives describing problems the current generation doesn't show ("no chrome reflections" when nothing in the prompt would induce chrome anyway)
- Multiple negatives describing the same failure mode in different words

**Rule:** Default to **zero** negatives. Add a negative only the second time a specific drift appears in actual output. Re-prune after every successful generation.

### Don't write contradictory clauses

A prompt that says both "PRESERVE the scene exactly" AND uses a generative i2i model is contradictory — generative models alter scene geometry by definition. So is "soft sunburst light flare … NO graphic sunburst rays" (a sunburst IS rays). Pick the intended visual once, describe it positively in plain language: "soft warm radial bloom in the upper-left of the back wall", not "sunburst minus its defining features".

### Don't repeat instructions

Repetition does not strengthen a signal in Pro / Nano Banana 2 — it eats the token budget. "Do NOT rotate products" once is enough. "Labels facing camera" once is enough.

---

## Composition Control

### Negative space for copy
If the output needs text overlay space, specify it explicitly with location:
- `Upper half of frame: deep dark negative space for headline copy`
- `Left side: generous clear space for copy overlay, at least one-third of frame width`
- `Lower third: clean champagne surface, no product elements, reserved for copy`

### Product completeness
Always specify when the full product must be shown — Gemini will crop if unconstrained:
```
Complete product shown from base to lid, nothing cropped out of frame.
```

### Multi-product arrangements
Name positions explicitly:
```
(1) MAIN — [product] at centre-left of frame, larger and dominant;
(2) SECONDARY — [product] at upper-right, smaller, partially overlapping the main
```

---

## Style Openers That Work

Tested openers that reliably set the correct aesthetic register for a premium skincare client:

| Opener | Best for |
|---|---|
| `Japanese luxury skincare editorial photography` | All hero product shots |
| `Japanese luxury skincare editorial photography, extreme close-up` | Macro / texture shots |
| `Japanese luxury skincare editorial, dark luxury still life` | Dark JP / near-black treatment |
| `Luxury product photography, warm champagne still life` | Light champagne world |
| `Japanese beauty brand campaign photography` | Lifestyle-adjacent shots |

---

## Technical Notes

### Models
| Model | Speed | Quality | Notes |
|---|---|---|---|
| `gemini-3.1-flash-image-preview` | Fast | Good | Default; supports up to 10 ref images, `thinkingLevel` control |
| `gemini-2.5-flash-image` | Fast | Good | Alternative; use for variant differentiation |
| `gemini-3-pro-image-preview` | Slow | Higher | Better for complex multi-product compositions |

### Same prompt → near-identical output
Running the same prompt twice on the same model produces nearly identical results. For genuine variants:
- Write a different concept prompt (different angle, composition, or lighting treatment)
- Use a different model (`gemini-2.5-flash-image` vs `gemini-3.1-flash-image-preview`)

### Aspect ratios supported
`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`, and more.

### No transparent backgrounds
Gemini cannot output transparent PNGs. Always specify a background colour or surface.

### Multi-turn editing
Images can be refined iteratively via conversation — pass the generated image back with a follow-up instruction: `"Make the lighting warmer"`, `"Move the jar slightly left"`.

---

## Known Gemini limitations and workarounds

Real failure modes observed across iteration sessions, with the workaround that consistently works. None of these are solved by "more prompt detail" — they're structural.

### Style-reference typo loop

**Failure:** when a parent shot has hallucinated text (typo in a product label, garbled wordmark, invented copy), passing it as a style reference reproduces the typo in the next generation. The error compounds across iterations because each new shot inherits the flawed text from its parent.

**Evidence:** observed in the trio shot session — the long-label tube tube label cycled through ACITVE / ACTVIE / AVTIVE / ACIVTE / SMOOTHINGS / SMOOTHNING / CKEAM / CRENM across iterations whenever a parent shot was passed as style ref. Pure-prompt + product cutouts gave clean labels every time.

**Workaround:** for text-sensitive iterations, pass ONLY product cutouts as `--product-ref` and describe everything else in the prompt. Do NOT pass the parent shot as `--style-ref`. If a deliverable lands with a typo, run `/retouch-image` with a delta like *"correct the [tube/jar/bottle] label so it reads '[exact canonical text]' clearly, no typos"* — non-destructive to composition.

### Dramatic camera angles need a visual anchor

**Failure:** Gemini won't commit to extreme camera angles (worm's-eye -45°, true bird's-eye, dramatic Dutch tilt, severe wide-angle perspective compression) from text prompts alone, no matter how explicit the language. The output reads as "moderate-low" or "slightly elevated" — the safe middle of the model's training distribution.

**Evidence:** trio session shots 03, 05, 19, 20 — multiple attempts at -45° worm's-eye via prompt-only path produced moderate-low results. The shot that finally locked the dramatic angle (shot 19) used a prior iteration as a style ref specifically because the visual anchor forced commitment.

**Workaround:** use a visual anchor for dramatic camera angles. Three reliable paths, in order of preference:
1. A prior generation that already nailed the angle, passed as style ref (when one exists)
2. A 3D-rendered pose proxy (Blender flat-shaded scene at the target perspective, see plan: `/reference-pose`)
3. A real photographic reference at the target angle, passed as style ref

If none of those are available and the angle is critical, accept that text-only iteration won't get there and propose a different camera direction.

### Depth ordering across multiple products

**Failure:** instructions like "product B stands behind product A on the same surface, with visible space between them" fail consistently. Single-pass Gemini renders the products as: stacked (B perched on A's lid), partially fused, or B floating in mid-air at A's height. It doesn't commit to "B is at greater Z-depth on the same plane."

**Evidence:** trio session — "the long-label tube behind cream jar on the glass" attempted across shots 14, 15, 16, 17. the long-label tube rendered as: stacked on cream jar's lid (15), floating beside cream jar (16), floating in mid-air (17). Never got clean "behind on same surface."

**Workaround:** composite path is the only reliable solve. Generate each product solo at the target angle (single product per generation = Gemini commits cleanly), then layer with a generated background. See plan: `/composite-shot`. As a less-good fallback, position the products laterally (left/center/right) instead of front/back — Gemini handles horizontal spread cleanly even when it won't do depth.

### Glass-as-perspective-anchor coupling

**Failure:** when the operator wants both "dramatic worm's-eye low angle" AND "no visible glass surface" simultaneously, removing the glass also softens the camera angle. The two are coupled in Gemini's reasoning — the visible glass shelf appears to act as a geometric anchor that locks the perspective; without it, the model defaults to a safer eye-level rendering.

**Evidence:** trio session shot 19 (worm's-eye on visible glass shelf) → shot 20 (same prompt, glass removed). Camera angle softened from true -45° to moderate-low, even though the perspective instructions in the prompt were unchanged.

**Workaround:** if you need both a dramatic angle AND no visible glass, generate the dramatic-angle-with-glass version first (shot 19's recipe), then `/retouch-image` to remove the glass edges from the rendered output. The retouch preserves the perspective Gemini already committed to. Trying to regenerate without the glass loses the angle.

### Text rendering is good, not solved

**Failure:** Gemini's text rendering is strong for simple, short labels but produces consistent hallucinations on:
- Multi-line product wordmarks with mixed-case typography (e.g. "ACTIVE FORMULA / NIGHT REPAIR / CREAM")
- Long brand-specific copy (any text >5 words on packaging)
- Specific product names that don't match Gemini's training-data distribution

**Evidence:** trio session — the client's the long-label tube tube label rendered correctly only ~30% of the time, and only when generated with bare-prompt + cutouts (no style ref). Other the client products (Serum, cream jar) rendered correctly far more reliably.

**Workaround:** track per-product text-rendering reliability in the client's `assess-guide.md` (see "Known generation quirks" section convention). For products that consistently misrender, default to: (1) bare-prompt + cutouts, never with style refs; (2) `/retouch-image` post-pass for any deliverable that goes to QA. Don't expect Gemini to render long the client-specific labels first-shot.

---

## When to stop generative — composite instead

Pro / Nano Banana 2 is the wrong final-mile tool for branded skincare stills where the deliverable demands BOTH (a) pixel-perfect readable label text AND (b) preservation of a specific prior scene's geometry. For that combination, the correct workflow is:

1. Generate the EMPTY scene with AI (no products), iterate until the scene reads right.
2. Generate or use existing PNG cutouts of each product (already pixel-perfect with correct labels).
3. **Composite the cutouts onto the rendered scene in Photoshop / Figma** — pixel-perfect labels, pixel-perfect scene, ~30 minutes of work.

Generative i2i blends everything. Pro will mangle long product-label text (`ACTIVE FORMULA / NIGHT REPAIR / CREAM` rendered correctly only ~30% of the time in the trio session, with consistent drift like `ECTINAL TONER`, `ESULSION`, `WRINKE EAOUTNON`, `IRKNAE`). No amount of prompt engineering closes that gap reliably.

### Signals to flag the compositing option

Stop iterating and surface the compositing option when ANY of:

- The same scene has accumulated **10+ generations** with persistent label drift.
- The prompt contains "PRESERVE the scene exactly" or "do NOT alter scene geometry" + a generative model is in use (this is a contradiction by definition).
- The same long product label has drifted in **3+ consecutive rolls** despite explicit text-accuracy clauses.
- The operator is rewriting the same prompt for the **5th time** chasing the same fix.
- Total session generation count on one composition has passed **~15**.

### How to surface it diplomatically

> "We're at N generations on this composition with label drift on `<product>`. For a branded deliverable, the pixel-perfect path is compositing the cutouts onto a rendered scene background in Photoshop / Figma — would you like me to lock the scene (e.g. shot 74) as the background and prep the cutouts for compositing instead of iterating further?"

### Tools

- For stills with critical brand-label fidelity → composite in **Photoshop / Figma**. Final mile, pixel-perfect.
- For video / motion needs → **Kling 3.0** is the best at preserving readable text from source images, but even there text preservation is imperfect.
- Generative AI's correct role on branded deliverables is the EMPTY scene render + the product PNG cutouts. The combine step is editorial, not generative.

---

## Quick Checklist

Before running generation, verify your prompt has:

- [ ] **For Pro / Nano Banana 2 multi-product**: ≤200 words, lead with product identity (not composition)
- [ ] Descriptive product anchors ("the gold tube with V-chevron cap"), NOT ordinal labels ("Image 1")
- [ ] Style opener naming photography genre
- [ ] Product described with specific packaging details (shape, material, finish, unique elements)
- [ ] Camera angle / framing named explicitly
- [ ] Background described with colour hex and surface texture
- [ ] Light source, direction, and temperature specified
- [ ] `Complete product shown from base to lid, nothing cropped` if full product required
- [ ] Negative space specified if copy overlay is needed
- [ ] Negative instructions specific (not just `no text`) AND only included for failure modes the current model is actively producing
- [ ] No contradictory clauses (e.g. "preserve exactly" + generative model; "sunburst" + "no rays")
- [ ] No instructions repeated for emphasis
- [ ] Pre-flight check: under ~15 generations on this composition? If over, surface the [compositing option](#when-to-stop-generative--composite-instead) instead.
