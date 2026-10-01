# Turing Machine — Web Adaptation

An unofficial, fan-made web adaptation of the **Turing Machine** logic-puzzle board game.

**Play it in your browser:** <https://ironlord02.github.io/turing-machine-web/>

> [!IMPORTANT]
> **This is an unofficial fan project.**
> It is not affiliated with, endorsed by, licensed by, or sponsored by Le Scorpion Masqué, the designer and publisher of Turing Machine.
> All credit for the game, its name, its design, and its puzzle content belongs to them.

---

## Please buy the real game

**Turing Machine** is a physical board game. Cards, pencil, table, friends across the table. The pleasure of the real thing is tactile and social: you slide a card, you argue with your opponent about what it means, you scratch your head together.

Playing it here will **never be the same**. No screen replaces that.

This project exists so you can learn the rules, practise deduction, or play a quick round on a laptop in a train. That is all. If you have not bought the game, please buy it. It deserves your money far more than any fan adaptation does.

---

## Credits

| Who | What |
| --- | --- |
| **Le Scorpion Masqué** | Designer and publisher of Turing Machine. The game, the name, the design, and the original puzzle content are theirs. |
| **Mathieu Lamarche** | Author of [`amoshk/turing-web`](https://github.com/amoshk/turing-web), consulted as prior art during research. Not a code source — see below. |
| **[IronLord02](https://github.com/IronLord02)** | Author of this independent implementation. |

Full legal scope, disclaimers, and licensing boundaries: see [ATTRIBUTION.md](ATTRIBUTION.md).

---

## No original artwork was used

> [!NOTE]
> This repository contains **no artwork from the game**. Nothing was copied, scanned, traced, or recreated from the physical product.

- **Image files: zero.** No `.png`, `.jpg`, `.svg`, `.webp`. No scanned cards, no board photos, no logo, no icon set.
- **Visuals: drawn entirely with CSS.** Borders, background colours, and simple shapes.
- **Puzzle data: text, not pictures.** The binary sequences are `1` and `0` characters on a plain background, standing in for physical cards rather than depicting them.
- **Fonts: none taken.** No `@font-face`, no web fonts, no CDN, no Google Fonts.
- **Card layout: this project's own.** Arranged for a browser. The original layout was not traced or replicated.
- **Network: zero external requests** in the single-file build. No analytics, no trackers, no remote assets.

The verifier cards deliberately do not rely on colour alone: colourblind mode adds **explicit glyphs** on top of the recoloured palette, so every card state is readable without colour vision.

The only thing shared with the original product is the *idea* of the game. All credit for that belongs to Le Scorpion Masqué.

---

## What it is

A browser version of the Turing Machine deduction game. The machine hides a secret binary pattern. You write a short three-slot program, then test it against verifier cards to narrow the pattern down until you are sure of it.

Runs entirely in the browser. No server, no account, no network calls.

---

## Features

| Feature | Details |
| --- | --- |
| Languages | 5: English, Español, Français, Deutsch, Русский |
| Difficulties | 3: Easy, Medium (default), Hard |
| Verifiers | 3 to 7, selectable. Default 4. |
| Program slots | 3 (A, B, C), each accepting `x`, `1`, `2`, `3`, `4`, or `5` |
| Cheat mode | Optional checkbox. Reveals the hidden pattern plus extra analysis. |
| Tutorial | Built-in "How to play" |
| Verifier guide | In-app help view explaining the verifier cards |
| Themes | Dark (default), light, and a colorblind-friendly mode |
| Accessibility | ARIA labels on interactive controls |
| Dependencies | None. No build step. No jQuery. |

The colorblind mode is not just a palette swap. It replaces red/green with blue/orange **and** puts explicit glyphs on the verifier cards, so the state of every card is readable without relying on colour at all.

There is also a legacy CSS compatibility layer for browsers without CSS custom properties (old WebKit, Android 4.4 stock browser).

---

## Running it

Two builds ship in this repository. Both are the same game.

### Single-file portable build (recommended for playing)

```
tm-offline.html
```

About 200 KB, fully self-contained. CSS and JS are inlined, there are zero external requests, and it includes the tutorial.

**Double-click it.** Open it from disk, on a USB stick, on a shared computer, anywhere. No internet connection, no web server, no install step. Nothing to break, nothing to configure.

### Split build (recommended for reading and contributing)

```
index.html
css/style.css
 js/game.js
```

| File | Size | Role |
| --- | --- | --- |
| `index.html` | 5.4 KB | Markup |
| `css/style.css` | 17.7 KB | Styles |
| `js/game.js` | 96 KB | All game logic, level generation, and i18n strings |

You need a static file server for this one, because browsers block `file://` script loads in some configurations:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/index.html>.

Changes made in the split build have to be mirrored into the single-file build by hand — there is no bundler doing it. If you forget, the portable file ships stale behaviour.

---

## How to play

A secret three-digit code is hidden somewhere in a set of binary sequences. Your job is to find it.

You write a short program in three slots, labelled **A**, **B**, and **C**. Each slot takes either a digit from `1` to `5`, or `x` for "I don't know yet".

You then test your guess against **verifier cards**. Each card checks one condition about the hidden sequence and answers YES or NO. A verifier only runs when all three slots hold a real digit — that is why `x` is useful: it lets you run the card instead of guessing.

Use the YES and NO answers to eliminate what cannot be true, repeat until only one code is left, and submit it. Each turn you may reveal up to three verifiers, then pass to reactivate them.

The built-in tutorial covers the interface element by element if you want a guided start.

---

## Contributing

Contributions are welcome. This is a small vanilla JavaScript project, so the barrier is low:

- No dependencies to install.
- No build step. Edit and reload.
- No framework conventions to learn.

If you send a pull request:

- Keep the split build as the source of truth.
- Regenerate `tm-offline.html` from it before submitting.
- Keep the unofficial fan-project notice in place. It is not decoration; it is the point.

---

## License

MIT. See [LICENSE](LICENSE).

**The MIT license covers this repository's own source code only**, written by IronLord02. It grants no rights whatsoever to the Turing Machine name, trademark, game design, or the original puzzle content. Those belong to Le Scorpion Masqué.

[ATTRIBUTION.md](ATTRIBUTION.md) explains exactly what the license does and does not cover, and is the authoritative statement on that question.

The single-file build needs no internet, no server, and no installation. That is a design goal, not a convenience.
