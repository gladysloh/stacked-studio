# Visual Style Analysis Guide

## Purpose

When the user provides reference images showing a visual aesthetic they want for their products, use this guide to analyze those images systematically. The goal is not to copy what's *in* the reference — it's to extract *how* the image was made: its lighting logic, color grammar, spatial composition, surface choices, and atmosphere. That analysis becomes a Style Descriptor, which is then combined with the brand's actual product to generate new product photography in that aesthetic.

The user will tell you:
- One or more reference images (can be photography, editorial, brand campaigns, film stills, art direction mood boards — anything that communicates a visual feel)
- Which product(s) to generate, by name (cross-referenced against `products.json`)
- How many shots per product

Your output is `prompts.json` — one entry per shot, every entry using the edit endpoint since all shots include the real product.

---

## Step 1: Analyze the References

Work through every reference image the user provides and extract each of the following dimensions. Be specific and observational — describe what you actually see, not what you think it *should* be. If a dimension is ambiguous or absent, note that rather than guessing.

---

### 1. Lighting

**Quality**
Is the light hard (creating sharp-edged, defined shadows) or soft (gradual falloff, diffused shadows or none at all)? Hard light comes from a small or distant source — bare flash, direct sun. Soft light comes from a large or close source — large softbox, overcast sky, window.

**Direction**
Where is the main light coming from? Front-lit (flat, shadowless, graphic), side-lit (reveals texture and dimension, strong shadow on opposite side), backlit or rim-lit (glowing edge, moody, silhouette tendency), overhead (dramatic top shadow, editorial), underlighting (rare, unsettling). Many images use multiple sources — identify the key light and any fill or rim lights separately.

**Source character**
Does it look like natural window light (soft, directional, slightly warm or neutral), overcast daylight (flat, even, cool), studio strobe (clean, controlled, precise), continuous LED (often slightly blue or clinical), a practical source like a candle or lamp (warm, orange, flickering quality), or a mix? The source character sets the believability of the scene.

**Shadow behaviour**
Are shadows present at all? If yes: are they deep and dramatic, or barely visible? Are edges hard or feathered? Do they fall on a surface (ground shadow) or on the product itself? Are they warm, cool, or neutral? Long shadows suggest raking side or low-angle light. Short shadows suggest overhead or frontal light.

**Highlight behaviour**
Where are the brightest points? Are specular highlights (reflections in shiny surfaces) present and crisp, or softened and large? Are they blown out to white or retained with detail? On product packaging specifically: does the light wrap around curves, or does it hit flat planes? Highlight character tells you a lot about the studio setup even when you can't see it.

---

### 2. Color & Grading

**Overall temperature**
Warm (amber, orange, gold tones in the neutrals), cool (blue, cyan, grey tones in the neutrals), or neutral/balanced?

**Saturation level**
Fully desaturated (near black and white), muted/desaturated (present but pulled back), natural, or pushed (vivid, hyper-saturated)?

**Color palette**
List the 3-6 dominant colors across the image with specific descriptors — not "green" but "muted sage", not "brown" but "warm dark amber with red undertone". Include the dominant background/surface color, the dominant shadow color, and any accent colors.

**Tonal contrast**
High contrast (deep blacks, bright whites, narrow midtone band) or low contrast (lifted blacks / matte finish, compressed highlights, wide soft midtone range)?

**Color grade style**
- **Clean/digital**: no apparent grade, natural colors, even response
- **Film emulation**: slightly muted, grain present, color cross-contamination between channels (e.g. shadows going green or magenta), halation in highlights
- **Matte/fade**: blacks are lifted to grey, giving a flat painterly quality often seen in beauty and skincare
- **Crushed/moody**: deep blacks, high contrast, often cool shadows
- **Warm editorial**: pushed amber-gold in highlights, neutral or slightly cool shadows — common in food, wellness, lifestyle
- **Desaturated editorial**: minimal color, almost monochromatic, fashion/fragrance territory
- **Split-tone**: different colors in shadows vs. highlights (e.g. blue shadows + warm highlights)

**Skin tones** (if skin is present)
Are they warm, cool, natural, heavily graded? Skin tones in a reference can tell you a lot about the overall grade even when the main subject is a product.

---

### 3. Composition & Framing

**Camera angle**
Overhead / flat lay (90 deg top-down, no perspective), high angle (camera above subject looking down, some perspective), eye level (camera at product height, natural perspective), low angle (camera below product height, heroic/dramatic perspective), 45 deg tabletop (the classic product photography angle, about 45 deg above eye level).

**Product placement in frame**
Centred and dominant, centred and small (product surrounded by negative space or environment), offset to one side (rule of thirds or extreme edge), deliberately cropped (only part of the product in frame — creates energy and scale). Does the product feel like the subject, or like part of a scene?

**Negative space**
Generous (lots of breathing room, minimal, premium feel), balanced, or tight (product fills most of the frame, busy)?

**Depth cues**
Is the image flat (all elements at similar depth, no foreground/background separation), or layered (distinct foreground, midground, background)? Are there elements placed deliberately in front of or behind the product to create depth?

**Crop / aspect feel**
Even if you don't know the intended format, does the image feel like it was composed for square, portrait, or landscape? Does it feel like a full frame or a tight crop?

**Symmetry vs. asymmetry**
Is the composition formally symmetrical (centred, balanced), or deliberately asymmetric (product offset, visual tension, more dynamic)?

---

### 4. Surface, Background & Environment

**Background type**
- Seamless / infinity curve (no visible horizon line, background blends into surface — studio standard)
- Environmental / location (an actual room, outdoor setting, contextual space)
- Textured flat (paper, fabric, stone, concrete — texture visible but clearly 2D backdrop)
- Gradient (smooth tonal shift, often used to give dimension to a seamless)
- Solid color (painted wall, color paper, digital)

**Surface material**
What is the product sitting on or near? Marble (which kind — white Calacatta, grey veined, black?), raw concrete, polished stone, white oak, dark walnut, linen, velvet, glass, acrylic, aged paper, ceramic tile, sand, wet stone, terrazzo. The surface material is often the single most important stylistic choice in product photography.

**Surface color and finish**
Light or dark? Matte, polished, or somewhere between? Does the surface reflect the product (wet-look stone, polished marble, glass) or absorb it (matte linen, rough concrete)?

**Props and styling elements**
What else is in the frame beyond the product? Natural props (botanicals, stones, water, fruit, flowers, ingredients), lifestyle props (cups, towels, books, tools), abstract forms (geometric shapes, cut paper, fabric folds), or nothing at all? How are props used — scattered loosely, arranged precisely, used to frame the product, or used to create a narrative context?

**Environmental depth**
If the environment extends beyond the immediate surface, what's in the background? Blurred architectural elements, window light casting on a wall, greenery, an out-of-focus room? Or is the background pure color with no spatial information?

---

### 5. Depth of Field & Focus

**Overall depth of field**
Shallow (only the product or a small plane of it is sharp, background and foreground dissolve into blur), moderate (most of the product is sharp, background softens), or deep (product and most of the environment are sharp throughout)?

**Bokeh character**
If background blur (bokeh) is present: is it smooth and creamy (fast lens, large aperture — 1.2-2.0), slightly nervous and textured (mid-range aperture — 2.8-4.0), or not really present? Are there specular bokeh balls visible?

**Focus precision**
Is there a very precise focus plane that renders one element razor-sharp and everything else soft? Or is the sharpness spread more generously?

**Lens character**
Clean and modern (sharp, low distortion, high contrast), slightly vintage (gentle softness, focus falloff at edges, subtle vignette), cinematic (low contrast but sharp, controlled barrel distortion)?

---

### 6. Texture, Grain & Finish

**Film grain**
Absent (clean digital), subtle (slight texture in shadows), moderate (visible across the whole image), heavy (dominant aesthetic choice — large format film look or deliberate noise)?

**Surface texture in frame**
Is texture celebrated in the image — rough stone, linen grain, brushed metal — or is the aesthetic smooth and clinical?

**Overall finish**
Polished and refined, raw and organic, clinical and minimal, warm and tactile? This is the gestalt impression of the image's physical quality.

---

### 7. Mood & Atmosphere

**Energy**
Calm, meditative, slow / Bright, energetic, immediate / Moody, intimate, withdrawn / Luxurious, aspirational, restrained / Playful, expressive, spontaneous

**Time-of-day feel** (even in studio shots, light has a temporal quality)
Early morning (soft, directional, slightly golden or neutral), midday (flat, bright, clinical), late afternoon / golden hour (warm, raking, long shadows), evening / dusk (dim, tungsten, intimate), or timeless / no time association?

**Intimacy vs. scale**
Does the image feel close and personal (macro or tight crop, shallow DOF, warm light), or does it have spatial grandeur (environmental context, cool light, depth)?

**Adjectives**
Choose exactly 5 adjectives that describe the mood. Be precise — not "nice" or "clean" but "austere", "luminous", "earthy", "clinical", "meditative", "decadent", "brutalist", "intimate", "raw", "curated".

---

## Step 2: Write the Style Descriptor

Once you have analyzed the reference(s) across all 8 dimensions, distil everything into a **Style Descriptor** — a single dense paragraph of 75-110 words written to be prepended to every product photography prompt. This paragraph is what the image model reads first. Its job is to set the visual parameters for the entire image before any product-specific detail is introduced.

**A good Style Descriptor:**
- Specifies the lighting setup precisely (quality, direction, source character, shadow and highlight behaviour)
- Names the color grade or palette (with specific color descriptions where useful)
- Describes the surface and background
- Gives a camera / depth-of-field specification (e.g. "85mm f/2.0, shallow depth of field, creamy bokeh")
- States the mood in 2-3 adjectives
- Does not mention any specific product

**A weak Style Descriptor:**
- Uses vague language ("beautiful lighting", "clean look", "minimalist")
- Mixes contradictory elements from different references
- Describes content rather than craft ("a bottle on a surface")
- Exceeds 120 words (too long degrades coherence)

**Format:**
```
[LIGHTING]. [COLOR/GRADE]. [SURFACE AND BACKGROUND]. [CAMERA SPEC]. [MOOD ADJECTIVES].
```

These don't need to be five separate sentences — a flowing paragraph is fine — but each element should be present.

**Example Style Descriptors:**

*Dark studio / luxury fragrance editorial:*
> Hard single-source side lighting from camera left, creating a defined shadow plane across 60% of the image. Deep tonal contrast with near-black shadows — blacks are fully crushed, no lift. Color palette: near-black background, warm amber specular highlights on any reflective surface, minimal midtones. Matte seamless background with no visible texture. Shot at 85mm f/2.8, moderate depth of field, full product sharp, background pure black. Austere, precise, covetable.

*Warm morning lifestyle / wellness brand:*
> Soft directional window light from camera right, warm and natural with a gentle golden bias. Shadows are present but feathered and low-contrast, never deep. Color grade: lifted blacks (matte finish), warm cream and honey tones dominating, slight fade in highlights. Surface is raw white oak or light linen, slightly textured. Background soft and out of focus — warm interior space, no hard details. Shot at 50mm f/2.0, shallow depth of field, bokeh is smooth and warm. Intimate, tactile, unhurried.

*Flat overhead / editorial beauty:*
> Overhead 90 deg shot, soft diffused studio light from directly above, essentially shadowless. Color palette is controlled and graphic — one dominant background color (matte surface, no texture), product and any props rendered with full detail and even exposure. No depth of field effect — flat lay, all elements in focus from edge to edge. Color grade is clean and neutral, no film emulation, saturation slightly below natural. Shot at 50mm f/8 equivalent, crisp, no aberration. Considered, graphic, controlled.

*Raw concrete / streetwear product:*
> Hard overhead or 45 deg light, industrial quality — single-source flash or bare strobe. Deep, hard-edged shadows. Color grade: cool, slightly desaturated, grey-blue cast in neutrals, shadows almost black. Background and surface are rough poured concrete or dark aggregate stone — texture is prominent and celebrated, grain is heavy. No props. Product rendered sharply with specular highlights clipping white. Shot at 35mm f/5.6, everything in focus, no bokeh. Gritty, stark, uncompromising.

*Soft studio / skincare hero:*
> Large softbox from upper-left, wrapping around the subject with gentle shadow falloff and no hard edges. Highlights are soft and retained — not blown. Color grade: cool-neutral, slightly desaturated, clean digital — no film grain, no color cast. Background is pure white or very pale grey seamless. Surface is white acrylic or pale marble — slightly reflective, giving a gentle mirror reflection of the product base. Shot at 100mm macro equivalent, f/4.0, product sharp throughout, background clean and featureless. Clinical, precise, trustworthy.

---

## Step 3: Write the Shot Prompts

Each shot prompt combines three things:
1. The **Style Descriptor** (prepended — sets the entire visual context)
2. The **product description** (from `brand-dna.md` — exact physical description, color, label, packaging details)
3. The **shot variation** (what makes this specific shot different from the others)

**Shot prompt structure:**
```
[Style Descriptor]. [Product description — be specific: shape, color, label, material, finish, any distinctive packaging details]. [Shot variation — angle, surface detail, any props, product orientation, whether lid is on or off, whether contents are shown, etc.]. Use the attached reference image to match the product packaging exactly — do not alter product colors, label text, typography, or packaging design.
```

The final instruction ("Use the attached reference image to match the product packaging exactly...") should always be included and always be the last sentence.

### Shot Variation Strategies

When generating N shots of the same product in the same style, vary the following to ensure each image is distinct:

**Angle variations**
- Overhead flat lay (90 deg)
- 45 deg tabletop (front-facing, classic product angle)
- Eye-level / straight-on (frontal, packaging-forward)
- Low angle looking up (heroic, dramatic)
- Three-quarter angle (shows depth and form)
- Extreme close-up or partial crop (abstract, textural)

**Composition variations**
- Product centered, generous negative space
- Product offset left or right, breathing room on one side
- Multiple units — two or three of the same product arranged in a group
- Product with minimal prop (one botanical, one piece of ingredient, one small object that signals use context)
- Product partially out of frame (only bottom 70% visible — creates scale)
- Product with cap/lid off or open (shows interior, signals use)

**Surface and staging variations**
- Change the surface material within the style (e.g. pale marble vs. dark marble if style permits dark surfaces)
- Add a small water drop or light mist on the product for skincare/beauty
- Add ingredient or hero element (e.g. hemp leaf, coffee grounds, raw cocoa) as a single prop near the product
- Show the product in context (on a bathroom shelf edge, next to a glass of water, on a folded towel) vs. pure isolation

**Lighting micro-variations**
- Increase shadow depth for drama
- Add a backlight rim on one edge
- Shift the dominant light source slightly — same quality, slightly different direction

---

## prompts.json Output Format

```json
{
  "brand": "Brand Name",
  "product": "Product Name (as in products.json)",
  "style_reference": "Brief description of the style references provided",
  "generated_at": "ISO timestamp",
  "prompts": [
    {
      "shot_number": 1,
      "shot_name": "overhead-marble-isolation",
      "prompt": "Full prompt text: Style Descriptor + product description + shot variation...",
      "aspect_ratio": "1:1",
      "needs_product_images": true,
      "product_image_files": ["product-filename.jpg"],
      "notes": "What this shot is going for — angle, any specific details to check"
    }
  ]
}
```

`shot_name` should be a short slug describing the specific shot (e.g. `overhead-dark-concrete`, `45-degree-warm-window`, `flatlay-with-botanical`, `closeup-label-detail`). Shot numbers are sequential starting at 1 across all products if multiple products are requested.

**Important:** `product_image_files` must only reference filenames that exist in `products.json`. Never invent filenames. If a product from `products.json` has multiple images saved, include all relevant ones (up to 3) for better product fidelity.
