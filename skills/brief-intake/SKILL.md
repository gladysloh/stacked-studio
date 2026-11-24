---
name: brief-intake
description: Turn a brief (PDF, Google Slides or Docs, email, pasted text, deck comments) into a project folder — brief.md with objective, audience, message, mandatories and deliverables, plus one folder per deliverable with its own brief. Use when the person shares a new brief, asks to "set up a project", or wants the deliverables listed before production.
metadata:
  area: concepts
  version: "1.0.0"
  tools: [client_context, search, client_list]
---

# Brief intake

1. **Read the brief fully.** PDF or file → read it. Google Slides → `deck_import` (text, speaker notes and every comment thread land in `decks/<deck>/`), then read `slides.md` and `comments.jsonl`. Google Docs or Drive PDFs → `drive_fetch` (exports to PDF) and read it. Pasted text → use it as is. Don't guess missing facts; list them as open questions.
2. **Client:** confirm the client folder (`client_list`). Unknown client → ask, then `studio client new "<name>"`. No client → `_scratch`.
3. **Write `clients/<client>/projects/<project>/brief.md`** with these sections (omit empty ones):
   `## Objective` · `## Audience` · `## Key message` · `## Mandatories` (logos, claims, legal lines, product list) · `## Tone` · `## Deliverables` · `## Timing` · `## Open questions`.
   Quote claims and legal lines exactly. Mark anything you inferred with "(inferred)".
4. **Deliverables:** one folder each, named `deliverables/<CODE>-<short-name>/` (for example `D01-night-serum-hero`; the code comes first and is the id), containing `brief.md` with `## Product`, `## Key message`, `## Format` (sizes, aspect ratios, duration for video), `## Copy` (headline/super/claims verbatim), `## Notes`. Use the brief's own codes; otherwise `D01`, `D02`… Classify each as key visual, product shot, adapt set, video, social post, or other.
5. **project.yaml:** `name`, `status: active`, and `links` to the source deck/docs (Drive URLs or ids).
6. **Summarise** in a few lines: what's being asked, the deliverables, and the open questions. Then ask where to start — don't start production automatically.

New brand facts found in the brief (colours, tone, product claims) go to `clients/<client>/knowledge/<topic>.md` with `status: draft` and `source:` — never straight into brand.md.
