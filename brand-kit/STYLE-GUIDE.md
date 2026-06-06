# The Match — Document Style Guide

All Match-branded documents (decks, briefs, one-pagers) follow the look of
`the-match-brief.pages`. Deliverables are produced as native **`.pages`** files.

## Palette
- Cream background: `#F6F1E6`
- Forest green (serif headings, pull quotes, stat numbers): `#16402A` (lighter `#1C5234`)
- Gold (rules, eyebrows, accents, monogram): `#A8863C`; eyebrow text `#957526`
- Body charcoal: `#2B2A26`
- Muted gold (header/footer): `#8C7A45`
- Cover gold gradient: light `#F0E3B8` → `#E2CD92` → `#D2B569` → deep `#C2A04E`
- "Match" wordmark gradient: `#FBF1CE` → `#E7C878` → `#C49A3C` → `#9C7A2A`

## Type
- Display / headings / pull quotes / stat-strip values: **Didot** (serif), forest green
- Body, eyebrows, labels, tables, stat numbers: **Helvetica Neue** (sans)
- Eyebrows & labels: UPPERCASE, bold, letter-spaced, gold

## Signature components
- Gold-gradient **cover** (full-bleed image) with thin gold frame, "M" monogram,
  eyebrow + short rule, giant "The Match" wordmark (gold gradient on "Match"),
  italic green subhead, stat strip (green numbers / gold labels), footer lines.
- Interior pages: cream, running header (gold small-caps left + right, hairline rule),
  gold eyebrow → green Didot section heading → short gold rule → body.
- Italic Didot **pull quotes** bracketed by hairline gold rules.
- Refined **tables**: gold small-caps headers with a gold bottom rule, hairline rows,
  green bold first column (no heavy fills).
- Two-column **feature grid**: gold top rule per item, green serif title, gold index, body.
- Footer: "THE MATCH · 2026" left, page number right, hairline rule above.

## How to regenerate
1. `npm install docx` (once).
2. Render `cover.html` / `banner.html` with Chrome headless (uses the Mac's Didot):
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
     --force-device-scale-factor=2 --screenshot=cover.png --window-size=816,1056 file://.../cover.html`
3. `node build-pages-docs.js out-strategy.docx out-onepager.docx` (edit copy/sections as needed;
   shared styling lives in `brandkit.js`).
4. Convert each `.docx` → native `.pages` via Pages (AppleScript):
   `tell application "Pages" to save (open POSIX file "in.docx") in POSIX file "out.pages"`.

The docx is only an intermediate; gradients/wordmark come from the rendered cover/banner images.
