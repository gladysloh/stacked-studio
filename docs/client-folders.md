# Client folders

Each client is one folder in `clients/`. It's private: never in Git, and shared only through the team's Drive. Everything about the client lives here, in folders named for people.

```
clients/<client>/
├── client.yaml        Who the client is, plus links: Drive folder, decks, Figma, Pinterest, competitors
├── brand/
│   ├── brand.md       The approved brand rules (palette, type, tone, do's and don'ts). The studio follows these.
│   ├── notes/         Drafts and unverified notes (from decks, feedback, research). Hints, not rules.
│   └── logos/
├── products/
│   ├── <product>/     One folder per real product: product.yaml (exact name, label text), photos/, cutouts/
│   └── _groups/       Duos, trios, line-ups: shots with several products together
├── library/
│   ├── references/    Other people's images to learn from, sorted by subject and tagged (angle, light, layout…)
│   ├── past-work/     The client's own finished campaigns
│   └── moodboards/    Research boards, one folder each
├── decks/             Google Slides decks: slide text, speaker notes, every comment thread
├── inbox/             New images waiting to be sorted (see below)
└── projects/
    └── <project>/                 One per brief, e.g. 2027-social-assets
        ├── brief.md               The project brief
        ├── references/<section>/  Mood and overview images shared by a section of the deck (e.g. "Gold series"), stored once
        ├── <CODE>-<name>/         One per deliverable, e.g. D01-night-serum-hero
        │   ├── brief.md           What this asset must say and show
        │   ├── references/        Inspiration from the deck (mood, lighting, overview)
        │   ├── versions/          Every image made for it: deck-NN (earlier rounds) and CODE_vN_… (made in the studio)
        │   ├── final/             Approved images only
        │   └── concepts/          Concept write-ups, when directions are developed
        └── _records/              The studio's history: every version's prompt, settings and approvals. Don't edit.
```

## Three kinds of things

- **The record:** `.yaml`, `.md` and `.jsonl` files. These are the truth. You can read them, and edit briefs, brand rules and notes freely. Don't edit `_records/`.
- **Images:** named copies of every image, placed where you'd expect them. They take no extra disk space on a Mac. The studio rebuilds them from the record (`studio organise <client>`), so renaming or deleting one doesn't lose anything.
- **Your own files:** anything you add yourself is never moved, renamed or deleted by the studio.

## Why an inbox?

The studio only knows about an image once it's recorded: which product it is, the exact label text, what it shows, which deliverable it's for. The inbox is the one place to drop images without deciding any of that yet:

1. Drop images into `inbox/` (Finder, or the Workbench upload).
2. Click **Organise with agent** (or ask your agent). Each image is looked at and filed: a product photo with its label text, a reference with tags, past work, or a deliverable's reference.
3. They then appear in the right folders, are searchable, and can be used in prompts.

If you already know where an image belongs, you can still drop it straight into that folder. The studio then treats it as your own file and won't touch it. It isn't recorded until it goes through the inbox.
