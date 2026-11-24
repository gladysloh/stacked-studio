# Camera & framing vocabulary — shared reference for image generation

A precise vocabulary for directing the camera in image-gen prompts (Gemini / Nano Banana / Pro). **Shared across all image tools** — `/concept-generator`, `/video-concept-generator`, `/reference-to-concept`, `/iterate-shot`, `/generate-image-gemini`. Use the exact terms below; they're unambiguous to the model in a way that "nice angle" is not.

## How to use it (the part that actually changes the output)

- **Lead with the camera.** Put the height + distance + angle at (or near) the *start* of the shot description, before the subject and scene. Models weight early tokens; a camera term buried at the end gets ignored.
- **State it on every shot — and vary it deliberately.** A storyboard or a multi-shot set should change the camera between shots (a wide establish → a low heroic → an overhead macro reads as *directed*; six eye-level ¾ shots read as a contact sheet). Pick from the menu per shot.
- **A style reference (e.g. a hero-anchor) overrides composition.** If you anchor shots on one frame for *product/colour* consistency, that anchor will also flatten every shot to the anchor's angle unless you state a different camera explicitly and strongly. The explicit camera term beats the anchor; the anchor still holds the product. (Same trap as repeating the room — see each client's `generation-guide.md`.)
- **Combine one term per axis.** A good camera line picks ~3: a *height* + a *distance* + an *orientation/lens* — e.g. "low angle, medium close-up, three-quarter" or "overhead top-down, wide, macro perspective."

---

## 1. Camera height / vertical position (the Y-axis)
- **high angle** — looking down from above the subject.
- **low angle** — looking up; subject becomes dominant.
- **eye level** — neutral, human perspective.
- **chest level** — slightly below eye level; intimate mid shot.
- **ground level** — camera touching or nearly touching the floor.
- **ultra-low angle / worm's-eye** — extreme low perspective, exaggerated scale.
- **overhead / top-down** — directly above the subject at 90°.

## 2. Camera distance / framing (how much enters frame)
- **extreme close-up (ECU)** — eyes, mouth, texture detail.
- **close-up (CU)** — head and neck.
- **medium close-up (MCU)** — shoulders to head.
- **medium shot (MS)** — waist up.
- **medium wide shot (MWS)** — knees up.
- **wide shot (WS)** — full body / full object.
- **long shot** — subject small in frame.
- **extreme long shot (ELS)** — mostly environment, subject tiny.
- **establishing shot** — context, architecture, space dominating.

## 3. Camera orientation / angle (how the lens is aimed)
- **straight-on** — neutral orientation.
- **three-quarter angle** — 45° from front.
- **profile / side-view** — 90°.
- **back-view / rear angle** — camera behind the subject.
- **dutch angle / tilt** — rotated horizon for tension.
- **top-lit vertical perspective** — above, slight tilt down.
- **low tilt-up** — camera low, lens pointed upward.

## 4. Camera position relative to subject
- **over-the-shoulder (OTS)** — from behind one subject toward another.
- **point-of-view (POV)** — as seen through the subject's eyes.
- **reverse angle** — opposite side of an OTS.
- **close-profile** — side view, tight framing.
- **back-to-camera** — subject facing away.
- **frontal symmetrical shot** — centered, Kubrick-style geometry.

## 5. Camera perspective / lens behaviour (distortion & compression)
- **wide-angle perspective** — expanded space, foreground exaggerated.
- **ultra-wide perspective** — strong distortion.
- **normal focal length** — human perspective, minimal distortion.
- **telephoto compression** — background pulled forward, shallow DOF.
- **macro perspective** — extreme close detail, miniature depth.
- **anamorphic perspective** — horizontal stretch, oval bokeh.
- **fisheye perspective** — curved edges, 180° field.

## 6. Camera position in 3D space (where the camera sits)
- **front-facing** — centered in front.
- **off-axis left / off-axis right** — slightly left / right of subject.
- **high vantage point** — elevated, overlooking.
- **balcony-level viewpoint** — mid-level high angle.
- **rooftop vantage** — very high but not top-down.
- **close foreground placement** — very near an object in the foreground.
- **distant observation point** — far back, detached.

## 7. Camera movement (continuity / motion intent — useful even for stills)
Direction of implied motion shapes the perspective and is the right field to hand the video-editor per beat:
- **push-in** — moving forward.
- **pull-back** — retreating.
- **lateral tracking left / right** — horizontal motion.
- **arc shot** — rotating around the subject.
- **tilt-up / tilt-down** — vertical rotation of the lens.
- **slow dolly toward subject** — controlled cinematic move.
- **handheld wobble** — micro-shake, documentary feel.

---

*Source: operator-supplied cinematography vocabulary, 2026-06. Keep terms exact when adding to a prompt.*
