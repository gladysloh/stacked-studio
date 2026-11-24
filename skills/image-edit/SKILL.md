---
name: image-edit
description: Change an existing image without regenerating everything — natural-language edits ("softer lighting", "remove the reflection"), targeted fixes, swapping or correcting a product, compositing new elements, branching a new direction from any version, and upscaling. Use whenever the person points at an image and asks for a change, a fix, a new direction from it, or a bigger version.
metadata:
  area: iteration
  version: "1.0.0"
  tools: [image_edit, image_upscale, history, image_compare]
---

# Change an image

## Pick the move
| Request | Call |
|---|---|
| Change something, keep the rest ("warmer", "lose the prop") | `image_edit`, mode `edit` → next version |
| Keep the idea, explore elsewhere ("same but on a beach") | `image_edit`, mode `branch` → new direction |
| Product looks wrong | `image_edit` with the product cutout as an input, role `product` (see `product-shot`) |
| Add an element from another image | `image_edit` with that image as an input and a note saying where it goes |
| Bigger file for print/final | `image_upscale` |

The source image is passed automatically — don't add it again. Pick the output with `output` when the image had variations.

## Write the edit prompt
- Say **only the change**, then lock the rest: "Make the key light softer and wider, from the upper left. Keep composition, product position, label text, palette and background exactly the same."
- One or two changes per edit. Big changes in one step drift the whole image; chain small edits instead.
- Name things by what they are ("the amber jar on the left"), not "image 2".
- If an edit keeps failing, branch from the last good version rather than editing the broken one.
- `what_changed`: one line for the history ("Softer key light, upper left").

## After
Open the result. If the person is weighing old vs new, call `image_compare` with both. Use `history` to show every version of an image.
