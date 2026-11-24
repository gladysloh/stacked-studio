---
name: sheet-batch
description: Run a batch of images from a Google Sheet — one row per shot (code, product, prompt or description, format) — make each, and write status and links back to the sheet. Use when the person shares a shot list or deliverables tracker and wants images for many rows.
metadata:
  area: campaign
  version: "1.0.0"
  steps: [image-generate, product-shot, compare-and-select]
---

# Shot list from a Sheet

1. `sheet_read` the sheet. Map columns to: code / deliverable, product, prompt or description, aspect, status, link. Ask if the mapping isn't obvious, and say which rows you'll do (skip rows marked done).
2. **Cost check first:** rows × variations × price (about $0.04–0.15 per image). Get a yes before starting. Start with 2–3 rows so the person can check the direction.
3. Per row: `client_context` (query: the row's product and description), write the prompt (`image-prompt-craft`, `product-shot` for products), `image_generate` with `deliverable` = the row's code, `aspect` from the row, and `request_id` = `<sheet id>:<row>` so a rerun never pays twice.
4. Write back only to the columns the person agreed to: `sheet_write` with e.g. `Status = "Made v1"` and the image id, or the Drive link after `drive_save`.
5. End with a short summary: rows done, rows that failed and why, total cost.
