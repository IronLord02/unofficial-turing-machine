# Attribution, Credits, and Legal Scope

This file is the authoritative statement on who owns what in this project, and on what the MIT license does and does not cover.

---

## Le Scorpion Masqué — designer and publisher

**Turing Machine** was designed and published by **Le Scorpion Masqué**.

- Official page: <https://www.scorpionmasque.com/en/turingmachine>
- Official online level generator: <https://turingmachine.info/>

Everything that makes this game *this game* belongs to them:

- The name **Turing Machine**.
- The game design and all of its rules.
- The original puzzle content and level design.
- Their artwork, card layout, and branding.
- Their trademark and associated rights.

This project is an independent, unofficial, fan-made reimplementation. It is **not affiliated with, endorsed by, licensed by, or sponsored by Le Scorpion Masqué**. No permission or approval of any kind has been granted, requested, or implied.

If you enjoy this adaptation, buy the physical game from Le Scorpion Masqué.

---

## No original artwork or assets were used

Le Scorpion Masqué's artwork, card design, and branding belong to them, and **none of it is present in this repository**. This is not a courtesy — it is a factual description of what the repository contains.

Verified contents of this repository:

- **No image files at all.** No `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.ico`, `.bmp`, or `.avif`. No scanned card images, no photographs of the board, no logo, no icon set.
- **No embedded images.** Zero `base64` data URIs, zero `url(...)` references in CSS, zero `<img>` elements, zero `background-image` declarations.
- **No raster or vector drawing surface.** Zero `<canvas>` elements and zero WebGL contexts.
- **No fonts taken.** Zero `@font-face` rules and zero remote font requests.
- **No external resources.** Zero `http://` or `https://` references in any source file. The single-file build makes no network requests of any kind.

Every visual element is drawn with plain CSS — borders, background colours, and simple shapes. The binary puzzle data is presented as `1` and `0` **text characters**, not as images of the physical cards. The layout is this project's own, arranged for a browser; the original card layout was not traced, replicated, or derived from.

Verifier card states are communicated through **colour plus explicit glyphs**, so that no state depends on colour perception alone.

In short: no asset belonging to Le Scorpion Masqué was copied, scanned, extracted, traced, or recreated. What remains recognisable from the original is the concept of the game itself, and that credit is theirs.

---

## Mathieu Lamarche — prior art

A pre-existing third-party web implementation of Turing Machine exists:

- **Author:** Mathieu Lamarche
- **Repository:** <https://github.com/amoshk/turing-web>

That repository was consulted as **prior art** during research: to understand the shape of the problem, the general approach, and what an existing attempt looked like.

That repository has **no license file**. Without an explicit grant of rights, its code is all rights reserved by default. **No code from it was copied into this project.** There are no shared dependencies, no vendored files, and no derived modules between the two projects.

The implementation in this repository is independent, written from scratch by IronLord02, and shares no code with `amoshk/turing-web`. This is stated plainly because it is the honest position: prior art was learned from, code was not taken.

---

## The level-generation algorithm

This project ships a level generator that builds playable puzzles with a unique solution.

It is **not the official algorithm**. It is **not an original invention** by this project's author. It is a reimplementation of publicly known behaviour, written independently.

Stated without hedging: the algorithm works perfectly and reliably, and it is neither official nor original.

The official level generator lives at <https://turingmachine.info/> and belongs to Le Scorpion Masqué.

---

## Scope of the MIT license

The MIT license in this repository (`LICENSE`) covers **this repository's own source code**, authored by IronLord02.

MIT grants rights to the code. It grants **no rights** to any of the following:

| Element | Owner |
| --- | --- |
| The name "Turing Machine" | Le Scorpion Masqué |
| The Turing Machine trademark | Le Scorpion Masqué |
| The game design and rules | Le Scorpion Masqué |
| Original puzzle and level content | Le Scorpion Masqué |
| Artwork and card design | Le Scorpion Masqué |

Redistributing this code does **not** entitle anyone to publish, sell, or commercially exploit the Turing Machine game, its name, or its content. Anyone who wants to do that must go to Le Scorpion Masqué.

---

## In plain language

If you are not a lawyer, here is the whole thing:

1. Le Scorpion Masqué made Turing Machine. The name, the design, and the puzzles are theirs.
2. Someone else built a web version first. It has no license, so its code could not be legally copied, and was not.
3. This project was written from scratch, independently. It is a fan tribute.
4. The MIT license lets you use and modify the code in this repository. That is all it does.
5. The code is free. The game is not. Please buy the real game.
