---
name: reference-decoding
description: Read a product, talent or style-reference image and describe it under the same five dimensions the prompt writer uses — camera, composition, lighting, surface and material, colour and mood — plus the hero element, so a reference's angle, light or framing can be carried into a new image on purpose. Use this whenever a reference or brand file needs to be "read" before making an image, when several references must be merged, or when images keep misreading a reference's material or angle.
metadata:
  area: image
  version: "1.0.0"
  tools: []
---

# Reference decoding

Open the reference image and look at it before you write a prompt from it. If you misread the material or the angle, every image made from it inherits the mistake. Describe what you see, plainly. Don't judge it, invent anything, or write a prompt yet.

## Describe under the shared dimensions
Use the same headings and the **same vocabulary** as the prompt files, so the words carry over unchanged: a reference's "low angle, rim light, left third" becomes the prompt's "low angle, rim light, left third".

| Heading | What to capture | Vocabulary |
|---|---|---|
| **Hero and material** | The main subject and its *true* material ("brushed gold metal", "wet glass", "long-exposure light trails"). The fact most often misread | [surface-and-material.md](../image-prompt-craft/references/surface-and-material.md) |
| **Camera** | Height, distance, orientation, lens look, depth of field, and the subject's **true stance** (upright, laid flat, tilted about 15°), kept separate from perspective tilt | [camera.md](../image-prompt-craft/references/camera.md) |
| **Composition** | Placement, balance, negative space, depth layers, format it was composed for | [composition.md](../image-prompt-craft/references/composition.md) |
| **Lighting** | Key light direction, hard or soft, source character, shadows (including contact shadows), highlights | [lighting.md](../image-prompt-craft/references/lighting.md) |
| **Surface and background** | Background type, surface material and finish, props and how they're arranged | [surface-and-material.md](../image-prompt-craft/references/surface-and-material.md) |
| **Colour and mood** | 3–6 named colours, temperature, contrast, grade style, grain, exactly five mood words | [colour-and-mood.md](../image-prompt-craft/references/colour-and-mood.md) |

One or two lines per heading. If something can't be seen, say "unclear" rather than guess.

**Style descriptor (for style references).** Finish with one 75–110-word paragraph in the order lighting, colour and grade, surface and background, camera, mood. It names no products, so it can sit in front of any prompt.

## By kind of image
- **Real photo:** camera position, whether the surface is visible, contact shadows, and tilt vs rotation. These geometric facts are what images get wrong.
- **Moodboard or illustration:** focus on the hero element's material and the lighting idea. The geometry is often impossible to reproduce literally.
- **Product shot:** also name visible branding and label text exactly as printed. QA compares labels against it.
- **Talent:** apparent age range, styling, expression and pose. Never guess identity.
- **Logo:** colours, wordmark text and shape only.

## Several references
Merge them into one spec per dimension. Note where they agree and where they conflict ("lighting conflicts: ref 1 hard side light, ref 2 soft overhead"), so you or the person decides, rather than averaging them into mush.

## Borrowing only some dimensions
You can take only some headings from a reference (say its camera and lighting, but not its surface). Use only the borrowed headings, and never the reference's subject: the deliverable's own product replaces it.

## Keep it
A reference's description doesn't change. Reuse it for every image in the same conversation. When a style reference defines a client's look, suggest its style descriptor as client knowledge (a draft note in `clients/<client>/knowledge/` (`status: draft`), kind `brand`) so it's kept as a draft for the person to approve.

Used by [image-prompt-craft](../image-prompt-craft/SKILL.md) and, for label checks, [creative-qa](../creative-qa/SKILL.md).
