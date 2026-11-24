# stacked-studio — instructions for coding agents

stacked-studio is a local creative production toolkit: research, concepts, images, edits, product shots, video planning, format adaptations and review. You (Claude Code, Codex or another MCP client) are the interface. The studio gives you one MCP server (`stacked-studio`) and a library of skills. Read this file before doing anything here.

## How to work

1. **Find the capability.** Read `skills/studio/SKILL.md` first. It maps what the person wants to a skill. Then read that skill. Claude Code finds skills in `.claude/skills/` automatically. Other agents can call `studio_capabilities` to get the catalog, or a skill's full text by name.
2. **Start where the person is.** A prompt → make the image. An image plus a change → edit it. Don't make anyone go through research, a brief or concepts unless they ask for them.
3. **Client work:** call `client_context` first. The client's **working deck** (Google Slides, linked in `client.yaml`) is the source of truth for deliverables, messaging and comments: re-sync it before deliverable work, and when a local file disagrees with it, the deck wins. New images are always generated new (never by editing, unless the person explicitly asks for an edit) from a full written description plus the front product packshots as the only image inputs; the old visual and slide references are studied and described in words, not passed in: see "Making a deliverable's image" in `skills/studio/SKILL.md`. Follow the **approved** rules, use **source** items as the client's facts, and treat **draft** and **unverified** items as hints. Without a client, work goes to `clients/_scratch/`.
4. **Images only through the studio:** use `image_generate`, `image_edit`, `image_upscale` and `image_compare`. Never call image APIs directly or save images some other way, because only these tools record the history.
5. **Approval is the person's decision.** Use `review` with approve or reject only when they say so.

## Tools (MCP `stacked-studio`, also `studio run <tool> '<json>'`)

| Tool | For |
|---|---|
| `studio_status` | Checks setup, keys, providers and spending |
| `studio_capabilities` | The skill catalog, or one skill's instructions |
| `client_list`, `client_context` | Clients and projects; the brand rules plus the relevant knowledge for a request |
| `search` | Keyword + semantic search over briefs, decks, comments, products, references, past images, and Drive files once they're indexed |
| `image_generate` | New images: text-to-image, references with roles (product, reference, style, person, layout), variations |
| `image_edit` | Changes to an image: mode `edit` makes the next version, mode `branch` starts a new direction |
| `image_upscale`, `image_compare` | A bigger version; a side-by-side comparison with a prompt diff and the pick |
| `history`, `review` | Every version of an image; approve, reject, rate, like, comment |
| `review_notes` | An asset's "changes requested" list: list, add, mark done, remove (shown on the review deck and in the Workbench) |
| `review_deck`, `prune_rejected` | Keep the project's review deck up to date in place (comments stay attached; `paused` and `shortlist` in project.yaml); free disk space from rejected images kept on Drive |
| `drive_index`, `drive_fetch`, `drive_save` | The client's Google Drive folder: make it searchable, download a file once, save an image (link recorded) |
| `deck_import` | Import or re-sync a Google Slides deck: text, notes, every comment thread |
| `deck_import_file` | File a downloaded deck's (.pptx) images: asset slides → their deliverables, section mood/overview → the project's sections, the rest → library references |
| `sheet_read`, `sheet_write` | Shot lists and batch inputs from Google Sheets; write status and links back |
| `product_list`, `product_add` | The client's products: exact label text, photos and cutouts to use as `product` inputs |
| `qa_basics`, `qa_record` | Measured checks (format, resolution, brand palette), and saving a creative-qa review (verdict computed by a fixed rule) |
| `shot_library` | The shared vocabulary of angles, placements, poses, hands, lighting, surfaces, motion and framing, with the team's tagged examples |
| `research_plan`, `image_search` | Targeted reference searches per subject (product, model, texture…) and shot type; optional image-search key (Brave or SerpAPI) |
| `moodboard_save`, `reference_tag`, `pinterest_board` | Boards with downloaded references tagged by shot id; a public Pinterest board's pins (no login) |
| `adapt_plan` | Per-size plan for adapts: pixels, safe box, archetype, and resize / crop / recompose / Figma layout |
| `client_sync` | Two-way sync of a client with the team Shared Drive |
| `media_run` | Optional local Python tools (cutout, palette, image_info) |

## Setup ("Set up this studio for me")

1. Run `./setup.sh --dry-run`. It changes nothing. Tell the person in a few lines what it will do, and ask before going ahead.
2. Run `./setup.sh`. Add `--with-media` only if they want the Python media tools (this needs `uv`), and `--link-codex` for Codex (ask first, because it changes Codex's settings).
3. Claude Code asks the person to approve the `stacked-studio` server from `.mcp.json`. Tell them to approve it.
4. **Keys:** the person runs `studio keys set gemini` (or `fal`) **in their own terminal** and pastes the key at a hidden prompt. Teams share billing but give each person their own key. **Never ask for a key in chat, and never read, print or store one yourself.** Without a key, the studio makes free test images.
5. **A team pack:** `studio team import <team-pack.zip>`. **A client a teammate shared:** `studio client import <client.zip or Drive link>`.
6. **Google (optional):** the person runs `studio connect google` in their own terminal (browser sign-in). Setup for the team owner: `docs/google-setup.md`.
7. Report the final `studio doctor` result in plain words.

## Clients (private: `clients/` is gitignored)

The full layout and what each folder is for: `docs/client-folders.md`. In short:

```
clients/<client>/client.yaml, brand/{brand.md, notes/, logos/}, products/{<p>/, _groups/}, library/{references, past-work, moodboards}, decks/, inbox/
clients/<client>/projects/<project>/brief.md, <CODE>-<name>/{brief.md, references/, versions/, final/, concepts/}, _records/
```

- Briefs, brand rules, notes, concepts and moodboards are plain files: read and write them directly. Never edit `_records/` (records are never changed), and only add approvals through `review`.
- New brand facts go into `brand/notes/` as drafts. Only the person promotes them to `brand/brand.md`.
- Images live in `.cache/media/` by hash. The readable copies in client folders are rebuilt by `organise_folders`. Files people add themselves are never touched.
- New images people drop in `inbox/` get filed with the `organise-inbox` skill.

## Cost
Real providers cost money: roughly $0.04–0.15 per image, and more at 4K. Explore at 1K. Say the cost before making more than 2 images at once, or anything at 2K or 4K. A daily cap (`studio config daily_cap_usd`) stops runaway spending. Never raise it unless the person asks.

## Rules for changing this repo
1. **This repo is public.** Never put client names, briefs, brand material, images, keys or personal paths into tracked files. Run `npm run check:private` before any commit; it must print `check-private: clean`.
2. **One core.** Every operation lives in `core/ops.mjs` and is shared by the MCP server, the CLI and the Workbench. Every model or API call goes through `core/providers/`. Python (`py/`) only does local media work: it never calls model APIs, and Node stores what it produces.
3. **Adding a provider:** write a module in `core/providers/` and add it to `PROVIDERS` in `core/providers/index.mjs`. Nothing else changes.
4. **Adding to the shot library:** an entry in `library/shots/<category>.yaml` (unique `id`, short concrete `prompt`, `search` terms). Example images never go in the repo: they're tagged references in client folders.
5. **Adding a capability:** a skill folder in `skills/` (or `pipelines/` for chains), with `name`, `description` and `metadata.area` and `metadata.tools`. Prefer a skill over a new tool. Add a tool only when an agent can't do the job with the existing ones.
6. **Tests never make paid calls.** They use the test provider and fake servers: `npm test` and `cd py && uv run --group dev pytest`.
7. Ask before pushing, publishing, adding a dependency, or anything that costs money. Commit only when asked.
8. **Words for the person:** Image, Version, History, Refine, New direction, Approved, Rejected, Needs review. Don't use generation, lineage or hash.
