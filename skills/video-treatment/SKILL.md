---
name: video-treatment
description: Plan motion from a brief or an approved image — a short treatment, a shot list with timing, keyframes made as images, and prompts ready for image-to-video. Use when the person wants a video, an animated version of a key visual, a storyboard, or a shot list.
metadata:
  area: video
  version: "0.9.0"
  tools: [client_context, image_generate, image_edit, image_compare]
---

# Video treatment and storyboard

1. **Treatment:** follow [treatment-template.md](references/treatment-template.md). Keep it to one page: idea, mood, duration and formats (9:16, 16:9, 1:1), music feel, end frame (logo/super).
2. **Shot list:** 3–8 shots for 6–15 s. For each: number, duration, framing, camera move (from [director-shots.md](references/director-shots.md)), action, what must stay fixed (product, label), transition.
   Write it to `clients/<client>/projects/<project>/concepts/<concept>-video.md`.
3. **Keyframes:** one image per shot with `image_generate` (start frame), at the video's aspect ratio. Reuse the approved key visual as an input (role `reference` or `layout`) so the look holds. For an approved image becoming a video, that image *is* shot 1's keyframe.
4. **Motion prompts:** per shot, describe only motion and change over time ("slow push-in, petals drift down left to right, light warms slightly; product stays still and sharp"). Keep the product static or slow — fast moves break labels.
5. **Rendering:** a `video_generate` tool (Veo, Kling via fal) is coming in the studio; until then, hand the keyframes and motion prompts to the person's video tool and record the result back as a reference.
