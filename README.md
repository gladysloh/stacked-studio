# stacked-studio

An AI creative production toolkit you use through **Claude Code**, **Codex** or any MCP client. It covers research, concepts, image generation, iteration, product photography, video planning, campaign adaptations and creative review. Say what you want in plain language, and the studio picks the right skill and keeps the full history of every image.

- **Local-first.** Everything runs on your computer. There's no cloud service to run.
- **Start anywhere.** Start from a prompt, an image, a brief or a reference. Each capability works on its own or chained with others.
- **Every version is kept.** That includes prompts, references, settings, versions, comments and approvals.
- **Client work stays private.** Client folders are gitignored. You share them as zips through your team's Google Drive.
- **Swappable models.** Gemini (Nano Banana) and fal.ai are built in, and adding a provider means writing one file.

## Start

```sh
git clone <this repo> stacked-studio && cd stacked-studio
./setup.sh                    # Node 22.13+; safe to re-run
studio keys set gemini        # or: node bin/studio.mjs keys set gemini (hidden prompt)
```

Then open Claude Code (or Codex) in this folder and ask, for example:

> Make three variations of a glass serum bottle on wet stone, morning light.
>
> Use Acme's brand guidelines and references to generate four product visuals, refine the second with softer lighting, compare the results and save the approved version.

Without a key the studio makes free placeholder images, so you can try every flow first.

## Optional

| | |
|---|---|
| `./setup.sh --with-media` | Local Python media tools (palette, image info, cutouts). Needs [uv](https://docs.astral.sh/uv/) |
| `studio team import team-pack.zip` | Shared team defaults: models, spending caps, the Drive root |
| `studio client import acme.zip` | A client folder a teammate shared |
| `studio ui` | The Workbench: view, compare, refine and approve in the browser |

## Layout

```
skills/        creative capabilities (SKILL.md, plain markdown)
pipelines/     chains of skills (brief → concepts, KV → adapts, product visual sets)
agents/        two subagents: creative-director (review), researcher
core/          the shared core: records, media, search, providers, MCP, CLI operations
py/            optional Python media tools (uv)
apps/workbench the browser Workbench
clients/       your private client folders (gitignored)
```

`studio help` lists every command. `studio doctor` checks everything.

## Develop

```sh
npm test                      # no paid calls
cd py && uv run --group dev pytest
npm run check:private         # must be clean before committing
```
