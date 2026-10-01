#!/usr/bin/env node
'use strict';

/**
 * build-single-file.js — regenerate `tm-offline.html` from the split sources.
 *
 * WHY THIS EXISTS
 * ---------------
 * This project ships the same game twice:
 *   - the split build  : src/index.html + css/style.css + js/game.js
 *   - the single build : tm-offline.html (self-contained, no network, no deps)
 * Those two drifted apart before: the single-file build had the tutorial modal,
 * the verifier guide, ARIA labels and the full i18n set, while the split build
 * was missing them. Drift between two copies of the same source of truth is
 * silent, invisible in review, and expensive.
 *
 * RULE
 * ----
 * `tm-offline.html` is GENERATED, not hand-edited. Any commit that touches
 * src/index.html, css/style.css or js/game.js MUST regenerate it with:
 *
 *     node tools/build-single-file.js
 *
 * and commit the regenerated tm-offline.html in the same commit. The script
 * reports whether the file it wrote is byte-identical to what was already on
 * disk; a "DIFFERS" report means either real source drift you just introduced,
 * or a stale generated file from an earlier commit. Both must be resolved in
 * the same commit — never hand-edit tm-offline.html.
 *
 * Inlining rules (these reproduce the existing file byte-for-byte):
 *   - `<link rel="stylesheet" href="../css/style.css">`
 *       becomes `<style>\n` + css/style.css + `</style>`
 *   - `<script src="../js/game.js"></script>`
 *       becomes `<script>\n` + js/game.js + `</script>`
 * The CSS and JS files each end with a trailing blank line, so the closing
 * `</style>` / `</script>` lands on its own line at column 0, exactly as the
 * checked-in single-file build has it.
 * The generated file also ends WITHOUT a trailing newline, matching the
 * committed tm-offline.html byte-for-byte. src/index.html keeps its own final
 * newline; the script drops exactly one, and only one.
 *
 * REQUIREMENTS: Node.js only. Zero dependencies, no package.json, no install
 * step. The game itself must stay playable by simply opening a file.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SRC_HTML = path.join(ROOT, 'src', 'index.html');
const CSS_FILE = path.join(ROOT, 'css', 'style.css');
const JS_FILE = path.join(ROOT, 'js', 'game.js');
const OUT_FILE = path.join(ROOT, 'tm-offline.html');

const CSS_LINK = '<link rel="stylesheet" href="../css/style.css">';
const JS_SCRIPT = '<script src="../js/game.js"></script>';

function readUtf8(file) {
  return fs.readFileSync(file, 'utf8');
}

/** Replace exactly one occurrence of `needle`, or fail loudly. */
function replaceOnce(haystack, needle, replacement, label) {
  const first = haystack.indexOf(needle);
  if (first === -1) {
    throw new Error(`${label}: marker not found in src/index.html: ${needle}`);
  }
  if (haystack.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(`${label}: marker found more than once in src/index.html: ${needle}`);
  }
  return haystack.slice(0, first) + replacement + haystack.slice(first + needle.length);
}

function countLines(text) {
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/**
 * Cheap structural diff summary: trims the identical prefix and suffix, then
 * reports where the two texts start to diverge and how many lines each side
 * has in the differing region. Good enough to point a human at `git diff`.
 */
function diffSummary(a, b) {
  if (a === b) return null;
  const aLines = a.split('\n');
  const bLines = b.split('\n');

  let head = 0;
  while (head < aLines.length && head < bLines.length && aLines[head] === bLines[head]) head++;

  let tail = 0;
  while (
    tail < aLines.length - head &&
    tail < bLines.length - head &&
    aLines[aLines.length - 1 - tail] === bLines[bLines.length - 1 - tail]
  ) tail++;

  return {
    firstLine: head + 1,
    removed: (aLines.length - tail) - head,
    added: (bLines.length - tail) - head,
  };
}

function main() {
  const html = readUtf8(SRC_HTML);
  const css = readUtf8(CSS_FILE);
  const js = readUtf8(JS_FILE);

  let out = replaceOnce(html, CSS_LINK, '<style>\n' + css + '</style>', 'CSS inline');
  out = replaceOnce(out, JS_SCRIPT, '<script>\n' + js + '</script>', 'JS inline');

  // The committed single-file build has no trailing newline after </html>.
  // Drop exactly one so the generated file stays byte-identical.
  if (out.endsWith('\n')) {
    out = out.slice(0, -1);
  }

  // Guard the invariant .gitattributes relies on: LF endings, no BOM.
  for (const [label, text] of [['css/style.css', css], ['js/game.js', js]]) {
    if (/\r/.test(text)) {
      throw new Error(`${label} contains CR characters; convert it to LF before building`);
    }
    if (text.charCodeAt(0) === 0xfeff) {
      throw new Error(`${label} starts with a BOM; remove it before building`);
    }
  }
  if (/\r/.test(out)) {
    throw new Error('refusing to write: built output contains CR characters (expected LF only)');
  }
  if (out.charCodeAt(0) === 0xfeff) {
    throw new Error('refusing to write: built output starts with a BOM');
  }

  const previous = fs.existsSync(OUT_FILE) ? readUtf8(OUT_FILE) : null;

  fs.writeFileSync(OUT_FILE, out, 'utf8');

  const bytes = Buffer.byteLength(out, 'utf8');
  console.log('build-single-file: wrote tm-offline.html');
  console.log(`  sources   : src/index.html (${Buffer.byteLength(html, 'utf8')} B), css/style.css (${Buffer.byteLength(css, 'utf8')} B), js/game.js (${Buffer.byteLength(js, 'utf8')} B)`);
  console.log(`  output    : ${bytes} bytes, ${countLines(out)} lines, LF, no BOM`);

  if (previous === null) {
    console.log('  match     : no previous tm-offline.html on disk (first build)');
    return;
  }
  if (previous === out) {
    console.log('  match     : identical to the previous tm-offline.html (0 lines changed)');
    return;
  }
  const d = diffSummary(previous, out);
  console.log(`  match     : DIFFERS from the previous tm-offline.html`);
  console.log(`             divergence starts at line ${d.firstLine}: -${d.removed} / +${d.added} line(s)`);
  console.log('             Review with: git diff tm-offline.html');
}

try {
  main();
} catch (err) {
  console.error('build-single-file: ' + err.message);
  process.exit(1);
}