# Review deck slide types

Every slide is 10 × 5.625 in, white, with the same header (asset code, section · direction, products, key message) and footer (client · project · Review, "Updated <date>", which is when the slide was last redrawn). A sample of each, with made-up content: `docs/review-deck/sample.pptx`.

## Cover
Project name, client, updated date. Or a full-bleed image when `links.review_deck.cover` is set.

## Overview
One row per asset: code, products, key message, number of versions, status counts. Rejected versions are only counted.

## Scene guide / Chosen scene (per project look)
```
┌──────────────────────────────────────────────────────────┐
│ Scene   BEACH · CHOSEN SCENE        Applies to A1, A2     │
├───────────────────────┬──────────────────────────────────┤
│ THE SCENE             │ [scene image] [scene image]      │
│ Warm limestone cove   │                                  │
│ KEYWORDS              │                                  │
│ warm brown limestone  │                                  │
│ COLOURS ■ Sky #…      │                                  │
│         ■ Rocks #…    │                                  │
└───────────────────────┴──────────────────────────────────┘
```
Before a pick, "Scene options" slides show the options lettered A, B, C.

## Concept board
```
┌──────────────────────────────────────────────────────────┐
│ A1   SECTION · CONCEPT BOARD                              │
│ Directions before we generate. Comment by letter…         │
│ ┌ A  Name   [Liked] ┐ ┌ B  Name  [Maybe] ┐ ┌ C  Name ──┐ │
│ │ [ref][ref][ref]   │ │ [ref]            │ │ No refs   │ │
│ │ idea text         │ │ idea text        │ │ idea text │ │
│ └───────────────────┘ └──────────────────┘ └───────────┘ │
└──────────────────────────────────────────────────────────┘
```

## Versions (no shortlist)
```
┌──────────────────────────────────────────────────────────┐
│ A1   SECTION · DIRECTION                    KEY MESSAGE   │
├──────────────┬───────────────────────────────────────────┤
│ CREATIVE IDEA│ [Current]  [Option 1]  [Option 2]          │
│ CHANGES      │  Current    Option 1    Option 2           │
│ REQUESTED    │  In deck    Needs rev.  Needs rev.         │
│ 24 Nov       │  note       note        note               │
│ • change     │                                           │
│ ✓ done       │                                           │
│ PALETTE ■ …  │                                           │
└──────────────┴───────────────────────────────────────────┘
```
Up to a few images per slide (more spill onto "2 of 3" slides). One set of slides per `review_groups` direction.

## Selected (shortlist): `selected:` in deliverable.yaml
```
┌──────────────────────────────────────────────────────────┐
│ A1   SECTION · DIRECTION                    KEY MESSAGE   │
├──────────────────────┬───────────────────────────────────┤
│                      │ Selected                          │
│                      │ [Needs review] Option 1 · date    │
│     [image, large]   │ ───────────────────────────────── │
│                      │ COMMENTS                          │
│                      │ •  One change per point           │
│                      │ •  In simple English              │
└──────────────────────┴───────────────────────────────────┘
```
Title defaults to "Selected"; `title:` overrides it (e.g. "Second option", "Not working"). With no `notes`, the latest open changes requested are shown.

## Before / after: `compare:` in deliverable.yaml
```
┌──────────────────────────────────────────────────────────┐
│ A1   SECTION · NAME                         KEY MESSAGE   │
│ note                                                      │
│                  │ [opt 1]   [opt 2]   [opt 3]            │
│  [preferred,     │ Option 1  Option 2  Option 3           │
│   large]         │ – edit    – edit    – edit             │
│                  │           – edit    – edit             │
│ Preferred · id   │                                       │
└──────────────────┴───────────────────────────────────────┘
```
The grid picks the column count that makes the options largest, never larger than the preferred image. `edits` under each option list what changed in its prompt compared with the preferred one.
