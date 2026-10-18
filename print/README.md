# ICA print collateral — "Grid Spec"

The ica.id website's design system, adapted for A4 print: the company
brochure (12 pages) and product datasheets (2 pages, one series per sheet).
Same tokens and elements as the website — no new style.

```
print/
  src/gridspec-print.css   the system: tokens + one class per element (style map below)
  src/brochure.html        the brochure, copy inline — edit the words here
  src/sheet.js             page furniture: print/screen mode, crop marks, slug, folios
  data/datasheets/*.json   one file per series: catalog values exactly as published
  data/SOURCES.md          where every sentence and number comes from
  assets/img/              photos (SOURCES.json = original URL of each), QR codes
  assets/fonts/            Instrument Sans, JetBrains Mono (SIL Open Font License)
  build.py                 builds everything into print/out/ (not committed)
```

## Build

```
pip install playwright pikepdf        # plus Ghostscript (gs) and poppler (pdftoppm)
python3 print/build.py                # brochure + every datasheet
python3 print/build.py datasheet      # datasheets only
```

`CHROMIUM=/path/to/chrome` if Chromium is not at the default path. Output in
`print/out/`:

| file | for |
|---|---|
| `<doc>-screen.pdf` | email, WhatsApp, the website — RGB, A4 trim, images at 200 ppi |
| `<doc>-print.pdf` | the printer — CMYK, A4 + 3 mm bleed, crop marks, TrimBox/BleedBox set, Ink as K100 |
| `<doc>-print-rgb.pdf` | the printer, if they convert with their own profile (preferred) |
| `<doc>.html` | the filled-in source the PDFs came from |
| `datasheet-<slug>.values.csv` | every catalog value next to how it printed — for checking |
| `previews/*.png` | one image per page |

The build **refuses** a page whose content runs into its footer, and a spec
cell wider than its column. Fix the layout (or the data) rather than the check.

### A new datasheet

Copy `data/datasheets/tp-series.json`, fill it from the series' product page
on ica.id / katalog.ica.id, add the product photo to `assets/img/` and a QR
(`qrcode` in Python, as for `qr-tp-series.svg`), and build. Rules:

- Copy catalog values **exactly**. The build only reformats them (spacing,
  units, `10.000` → `10,000`); it never changes a value. Leave a field out if
  the catalog has none — the sheet prints a dash.
- A value under "Common to all models" must be identical on every model; the
  build stops if it is not.
- `tkdn`: a tag text **only** when this series has its own TKDN certificate.

## Style map

Each class is named after the element. A designer rebuilding the files in
InDesign or Figma uses these names for the paragraph / character / object styles.

**Tokens** — Ink `#0A0F1C` · ICA Blue `#0047D8` (the one accent) · Steel
`#4A5568` · Line `#DCE2EC` · Mist `#F3F5F9` · Night `#08142E` · Rail `#F8F9FB`
(alternate table rows). Rules: "2px" = 1.5 pt Ink, "1px" = 0.75 pt Line.
Corners: 1 mm (4px) buttons and boxes, 0.5 mm (2px) tags, photos never rounded.
Grid: A4, 3 mm bleed, 15 mm margins, 12 columns, 5 mm gutter.

| Style | Class | Spec |
|---|---|---|
| **Paragraph** | | |
| Cover title | `.cover-title` | Instrument Sans 600, 62 pt / 0.98, −4.5% |
| Display title (datasheet series) | `.display-title` | Instrument Sans 600, 54 pt / 1, −4.5% |
| Section title | `.section-title` | Instrument Sans 600, 30 pt / 1.08, −3.5% |
| Card title | `.card-title` | Instrument Sans 600, 13.5 pt / 1.2, −3% |
| Lead | `.lead` | Instrument Sans 400, 12 pt / 1.45 |
| Body | `.body` | Instrument Sans 400, 9.5 pt / 1.5, Ink |
| Body steel | `.body-steel` | as Body, Steel |
| Mono label | `.mono-label` | JetBrains Mono 500, 7.5 pt, UPPERCASE, +8%, Steel |
| Mono line | `.mono-line` | JetBrains Mono 500, 8.5 pt, Steel (e.g. "1,000–25,000 VA · 14 models") |
| Breadcrumb | `.breadcrumb` | JetBrains Mono 400, 7.5 pt, Steel |
| Photo caption | `.photo-caption` | JetBrains Mono 500, 7 pt, UPPERCASE, +8%, Steel |
| Numbers figure / caption | `.numbers-figure` / `.numbers-caption` | JetBrains Mono 500 22 pt / 400 7.5 pt Steel |
| Spec table head / cell | `.spec-table th` / `td` | JetBrains Mono 500 6.5 pt UPPERCASE / 400 7.6 pt (datasheet back: 5.5 / 5.9 pt) |
| Small print | `.small-print` | Instrument Sans 400, 6.5 pt, Steel |
| Contact block | `.contact-block` | Instrument Sans 400, 9 pt / 1.6 |
| **Character** | | |
| Mono | `.mono` | JetBrains Mono |
| Accent | `.accent` | ICA Blue |
| Steel | `.steel` | Steel |
| **Object** | | |
| Section label | `.section-label` | "01 —— NAME": Blue mono number, 8.5 mm line, Steel mono label |
| Page head | `.page-head` | breadcrumb, title, 2px Ink rule |
| Cells | `.cells` (`.ruled`) | grid of boxes sharing 1px Line borders (2px Ink top when ruled) |
| Feature list | `.feature-list` | 2px Ink top rule, numbered rows, 1px Line between |
| Photo tile | `.photo-tile` | cut-out on Mist (or white), 1px Line border, square |
| Numbers strip | `.numbers-strip` | cells split by 1px Line, figure + caption |
| Tag | `.tag` | Ink rectangle, white mono UPPERCASE 6.5 pt, 0.5 mm corners |
| Mist band / Night band | `.band-mist` / `.band-night` | at most one per spread |
| Call to action | `.cta-band` + `.button` | Mist band, title left, Blue button right |
| Spec pairs | `.spec-pairs` | label / value rows, 2px Ink top rule |

## Before it goes to the printer

1. **Logo as vector.** `assets/img/logo2.png` / `logo.png` are the 500 px
   PNGs from ica.id — fine on screen, soft in print. Replace with the EPS/SVG/AI.
2. **Product photos at print resolution.** The catalog's cut-outs are
   600 × 600 px: enough for the small brochure tiles (350+ ppi) but about
   200 ppi in the datasheet's large photo box. Print wants 300 ppi there — ask
   for the originals.
3. **Proof the blue.** ICA Blue `#0047D8` converts to about C87 M74 Y0 K0 with
   a standard profile; it is near the edge of CMYK. Ask for a hard proof, or
   send `-print-rgb.pdf` and let the printer convert with their profile.
4. **Paper and finish** are not set here; the files are A4, 3 mm bleed, crop
   marks 3 mm off the trim. The brochure is 12 pages (saddle-stitch ready).

## Not covered here

- **InDesign / Figma files.** This repository has no InDesign or Figma; the
  editable source is the HTML/CSS above, styled one class per element so it
  rebuilds 1:1 in either tool (style map). The PDFs open in Illustrator and
  InDesign (place) with live text.
- **Indonesian edition.** The same files with the copy translated (EYD) and
  Indonesian number format (`25.000 VA`); not built yet.
