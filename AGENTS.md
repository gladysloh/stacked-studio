# stacked-studio — instructions for coding agents

stacked-studio is a local creative production toolkit: research, concepts, images, edits, product shots, video planning, format adaptations and review. You (Claude Code, Codex or another MCP client) are the interface. The studio gives you one MCP server (`stacked-studio`) and a library of skills. Read this file before doing anything here.

## How to work

1. **Find the capability.** Read `skills/studio/SKILL.md` first. It maps what the person wants to a skill. Then read that skill. Claude Code finds skills in `.claude/skills/` automatically. Other agents can call `studio_capabilities` to get the catalog, or a skill's full text by name.
2. **Start where the person is.** A prompt → make the image. An image plus a change → edit it. Don't make anyone go through research, a brief or concepts unless they ask for them.
3. **Client work:** call `client_context` first. Follow the **approved** rules, use **source** items as the client's facts, and treat **draft** and **unverified** items as hints. Without a client, work goes to `clients/_scratch/`.
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
| `drive_index`, `drive_fetch`, `drive_save` | The client's Google Drive folder: make it searchable, download a file once, save an image (link recorded) |
| `deck_import` | Import or re-sync a Google Slides deck: text, notes, every comment thread |
| `sheet_read`, `sheet_write` | Shot lists and batch inputs from Google Sheets; write status and links back |
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

```
clients/<client>/client.yaml          name, links (Drive folder, guidelines, decks, Figma, Pinterest), defaults
clients/<client>/brand.md             APPROVED brand rules only
clients/<client>/knowledge/*.md       drafts and unverified notes (frontmatter status: draft | approved | unverified)
clients/<client>/products/<p>/product.yaml   label text and cutouts (by sha)
clients/<client>/references/, past-work/, research/<board>/, decks/<deck>/
clients/<client>/projects/<project>/  project.yaml, brief.md, deliverables/<CODE>/, concepts/, generations/<id>.yaml, review.jsonl
```

- You may read and write these files directly (briefs, concepts, knowledge drafts, moodboards). Never edit `generations/*.yaml`, because records are never changed, and only append to `review.jsonl` through `review`.
- New brand facts go into `knowledge/` as drafts. Only the person promotes them to `brand.md`.
- Images live in `.cache/media/` by hash. Share a client with `studio client export <client>`.

## Cost
Real providers cost money: roughly $0.04–0.15 per image, and more at 4K. Explore at 1K. Say the cost before making more than 2 images at once, or anything at 2K or 4K. A daily cap (`studio config daily_cap_usd`) stops runaway spending. Never raise it unless the person asks.

## Rules for changing this repo
1. **This repo is public.** Never put client names, briefs, brand material, images, keys or personal paths into tracked files. Run `npm run check:private` before any commit; it must print `check-private: clean`.
2. **One core.** Every operation lives in `core/ops.mjs` and is shared by the MCP server, the CLI and the Workbench. Every model or API call goes through `core/providers/`. Python (`py/`) only does local media work: it never calls model APIs, and Node stores what it produces.
3. **Adding a provider:** write a module in `core/providers/` and add it to `PROVIDERS` in `core/providers/index.mjs`. Nothing else changes.
4. **Adding a capability:** a skill folder in `skills/` (or `pipelines/` for chains), with `name`, `description` and `metadata.area` and `metadata.tools`. Prefer a skill over a new tool. Add a tool only when an agent can't do the job with the existing ones.
5. **Tests never make paid calls.** They use the test provider and fake servers: `npm test` and `cd py && uv run --group dev pytest`.
6. Ask before pushing, publishing, adding a dependency, or anything that costs money. Commit only when asked.
7. **Words for the person:** Image, Version, History, Refine, New direction, Approved, Rejected, Needs review. Don't use generation, lineage or hash.
