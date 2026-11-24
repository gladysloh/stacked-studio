---
name: organise-inbox
description: File uploaded images from a client's inbox to where they belong — product photos into the product library (with exact label text), references and logos, past work, moodboards, or a deliverable's references — named, tagged with shot-library ids and described. Use when the person uploads images, drops files into clients/<client>/inbox/, or asks to "organise", "sort" or "file" images.
metadata:
  area: clients
  version: "1.0.0"
  tools: [inbox_list, inbox_file, product_list, shot_library, client_context]
---

# Organise the inbox

1. `inbox_list` for the client. Read the uploader's notes ("product shots of the new serum", "refs for D01"): they override your guesses.
2. `product_list` so you know the product names already in use, and `client_context` if you need the projects and deliverable codes.
3. **Open every image**, then decide where it goes:

| It is | File as | Give |
|---|---|---|
| A clean photo of one of the client's products (packshot, cutout, angle) | `product` | `product`: the existing product name if it matches, else a clear new one; `label_text`: the label exactly as printed, lines joined with " / " (only what you can read); `style` |
| The client's logo or a brand asset | `logo` | `title` |
| Someone else's image to learn from (competitor, campaign, mood) | `reference` | `shots`, `subject`, `take` (what to borrow, ≤15 words), `title` |
| The client's own finished campaign work | `past_work` | `shots`, `subject`, `take`, `title` |
| Material for a specific deliverable (note mentions a code, or it's clearly for one) | `deliverable` | `project`, `deliverable` (code), `role` (reference, visual, mood, lighting) |
| A set of research for a theme | `board` | `board` name, `take`, `shots` |
| A duplicate, a blank, a screenshot of nothing | `discard` | |

4. Tag what you can see: 2–5 shot-library ids (`shot_library` to look them up). Never invent label text. If you can't read it, leave `label_text` out.
5. File everything in one `inbox_file` call when you can. Report a short summary: how many went where, new products created, and anything you weren't sure about. Unsure items: file them as `reference` and say so, rather than guessing a product.
