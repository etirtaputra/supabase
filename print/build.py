#!/usr/bin/env python3
"""
Build ICA's print collateral in the "Grid Spec" system.

    python3 print/build.py              # everything
    python3 print/build.py datasheet    # datasheets only
    python3 print/build.py brochure     # brochure only

Needs: Python 3.10+, `pip install playwright pikepdf`, Chromium (set
CHROMIUM=/path/to/chrome if it is not at the default below), Ghostscript (`gs`)
for the CMYK conversion, and `pdftoppm` (poppler) for the PNG previews.

Writes print/out/:
    <doc>-screen.pdf   RGB, A4 trim, for email and the website
    <doc>-print.pdf    CMYK, A4 + 3 mm bleed, crop marks, TrimBox/BleedBox set
    <doc>.html         the filled-in source the PDFs were rendered from
    previews/          one PNG per page, for checking
    datasheet-<slug>.values.csv  every catalog value next to what was printed

Datasheet rule (print/README.md): catalog values are only REFORMATTED here —
spacing, units, English thousands separators. A value is never changed, and a
field the catalog does not have stays empty.
"""
from __future__ import annotations

import csv
import html
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC, DATA, OUT = ROOT / 'src', ROOT / 'data', ROOT / 'out'
CHROMIUM = os.environ.get('CHROMIUM', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
MM = 72 / 25.4   # PDF points per mm

esc = html.escape


# ── Catalog value → print text (formatting only) ───────────────────────────

def _thousands(n: str) -> str:
    """'10.000' / '16.250' / '8125' / '54.4' → '10,000' / '16,250' / '8,125' / '54.4'."""
    if re.fullmatch(r'\d{1,3}(\.\d{3})+', n):
        n = n.replace('.', '')
    if re.fullmatch(r'\d+', n):
        return f'{int(n):,}'
    return n


def _units(s: str) -> str:
    s = re.sub(r'(\d)\s*(VA|Wp|W|V|A|Ah|kg|Kg|mm|ms|min|Hz|kVA|kW)\b',
               lambda m: f"{m.group(1)} {'kg' if m.group(2) == 'Kg' else m.group(2)}", s)
    return s


def fmt_capacity(v: str) -> str:
    parts = []
    for p in v.split('/'):
        m = re.match(r'\s*([\d.]+)\s*(VA|W)\s*$', p)
        parts.append(f'{_thousands(m.group(1))} {m.group(2)}' if m else p.strip())
    return ' / '.join(parts)


def fmt_range(v: str) -> str:
    v = re.sub(r'\s*–\s*', '–', v)
    return _units(v)


def fmt_input(v: str) -> str:
    v = v.replace('Single Phase', 'Single phase').replace('Three Phase', 'Three phase')
    v = re.sub(r'(\d) Wire', r'\1-wire', v)
    return fmt_range(v)


def fmt_thd(v: str) -> str:
    return v.replace(' THD', '').strip()


def fmt_battery(v: str) -> str:
    # Only an "x" BETWEEN figures is a multiplication sign — never the x in "External".
    v = re.sub(r'(?<=[\d\]])\s*x\s*(?=[\d\[])', ' × ', v)
    v = re.sub(r'\s*\((Internal|External)\)', lambda m: ', ' + m.group(1).lower(), v)
    v = re.sub(r'(\d)\s*V,', r'\1 V,', v)
    return _units(v)


def fmt_dims(v: str) -> str:
    v = v.replace('mm', '').strip()
    nums = [x.strip() for x in re.split(r'(?<=\d)\s*x\s*(?=\d)', v)]
    return ' × '.join(_thousands(n) for n in nums) + ' mm'


def fmt_weight(v: str) -> str:
    return _units(v)


def fmt_plain(v: str) -> str:
    return _units(v)


def fmt_tolerance(v: str) -> str:
    """'50 ± 5%Hz' → '50 Hz ± 5%' ; '220 ± 2%V' → '220 V ± 2%'."""
    m = re.fullmatch(r'\s*([\d.]+)\s*±\s*([\d.]+%)\s*(Hz|V)\s*', v)
    return f'{m.group(1)} {m.group(3)} ± {m.group(2)}' if m else v


def fmt_sentence(v: str) -> str:
    """'PULSE WIDTH MODULATION (PWM)' → 'Pulse width modulation (PWM)'."""
    words = v.split(' ')
    out = [w if re.fullmatch(r'\([A-Z]+\)', w) else w.lower() for w in words]
    s = ' '.join(out)
    return s[:1].upper() + s[1:]


def fmt_sts(v: str) -> str:
    """'2ms From Inverter To By-Pass, 0ms Back To Inverter' → '2 ms inverter to bypass, 0 ms back to inverter'."""
    v = v.replace('By-Pass', 'bypass').replace(' From ', ' ').replace(' To ', ' to ').replace(' Back ', ' back ').replace('Inverter', 'inverter')
    return _units(v)


def fmt_waveform(v: str) -> str:
    return 'Pure sine wave' if v.lower().replace(' ', '') == 'puresinewave' else v


def fmt_protection(v: str) -> str:
    return 'No-fuse breaker' if v == 'No Fuse Breaker' else v


def fmt_temp(v: str) -> str:
    return re.sub(r'\s*–\s*', '–', v).replace('°C', ' °C').replace('  ', ' ')


# Back page, table 01: one row per model, only what differs.
SPEC_COLS = [
    ('Capacity', 'Capacity', fmt_capacity),
    ('AC input', 'AC Input Voltage', fmt_input),
    ('Eff.', 'Inverter Output Efficiency', fmt_plain),
    ('THD', 'Inverter Output Distortion', fmt_thd),
    ('DC in', 'DC Input Voltage', fmt_plain),
    ('Battery', 'DC Input Internal Battery', fmt_battery),
    ('Float', 'Charger Floating Voltage', fmt_plain),
    ('Protection', 'AC Input Protection', fmt_protection),
]
# Table 02: values every model shares (checked at build time — a value that
# differs between models is refused here and must move to a per-model table).
COMMON = [
    ('AC input frequency', 'AC Input Frequency', fmt_tolerance),
    ('Output voltage', 'Inverter Output Voltage', fmt_tolerance),
    ('Output waveform', 'Inverter Output Waveform', fmt_waveform),
    ('Output frequency', 'Inverter Output Frequency', fmt_tolerance),
    ('Inverter topology', 'Inverter Output Topology', fmt_sentence),
    ('Charger topology', 'Charger Topology', fmt_sentence),
    ('Transfer time', 'Transfer Time', fmt_plain),
    ('Static transfer switch', 'Static Transfer Switch', fmt_sts),
    ('Backup time', 'Backup Time', fmt_plain),
    ('Operating temperature', 'Operation Temperature', fmt_temp),
]
# Table 03: dimensions and weight, with the external battery cabinet where one exists.
DIM_COLS = [
    ('UPS D × W × H', 'Dimension (D x W x H)', fmt_dims),
    ('Net weight', 'Net Weight', fmt_weight),
    ('Ext. battery', 'External Battery Type', fmt_plain),
    ('Ext. battery D × W × H', 'External Battery Dimension', fmt_dims),
    ('Ext. battery weight', 'External Battery Weight', fmt_weight),
]


NOWRAP = {'Capacity', 'Dimension (D x W x H)', 'External Battery Dimension'}


def cell(m: dict, key: str, f) -> tuple[str, str]:
    raw = m['catalog'].get(key, '')
    return raw, (f(raw) if raw else '')


# ── Datasheet ──────────────────────────────────────────────────────────────

def build_datasheet(path: Path) -> tuple[str, Path]:
    d = json.loads(path.read_text())
    models = d['models']
    audit: list[list[str]] = []

    def row_cells(m, cols):
        tds = []
        for label, key, f in cols:
            raw, txt = cell(m, key, f)
            audit.append([m['model'], key, raw, txt])
            nw = ' class="nowrap"' if key in NOWRAP else ''
            tds.append(f'<td{nw}>{esc(txt) if txt else "—"}</td>')
        return ''.join(tds)

    spec_rows = ''.join(f'<tr><td class="model">{esc(m["model"])}</td>{row_cells(m, SPEC_COLS)}</tr>' for m in models)
    dim_rows = ''.join(f'<tr><td class="model">{esc(m["model"])}</td>{row_cells(m, DIM_COLS)}</tr>' for m in models)

    common_rows = []
    for label, key, f in COMMON:
        vals = {f(m['catalog'][key]) for m in models if m['catalog'].get(key)}
        if len(vals) != 1:
            raise SystemExit(f'{d["series"]}: "{key}" is not the same on every model ({vals}) — it cannot go under "common to all models".')
        v = vals.pop()
        for m in models:
            audit.append([m['model'], key, m['catalog'].get(key, ''), v])
        common_rows.append(f'<div class="row"><span class="k">{esc(label)}</span><span class="v">{esc(v)}</span></div>')

    # Check the per-model protection columns agree (AC and DC are printed as one).
    for m in models:
        if m['catalog'].get('AC Input Protection') != m['catalog'].get('DC Input Protection'):
            raise SystemExit(f'{m["model"]}: AC and DC protection differ — print them as two columns.')

    n = len(models)
    tkdn = f'<span class="tag" style="margin-left:2mm">{esc(d["tkdn"])}</span>' if d.get('tkdn') else ''
    features = ''.join(
        f'<div class="feature"><div class="feature-num">{i + 1:02d}</div>'
        f'<div class="card-title" style="font-size:11.5pt;margin-top:3mm">{esc(t)}</div></div>'
        for i, t in enumerate(d['key_features']))
    common = {lab: row for (lab, _, _), row in zip(COMMON, common_rows)}

    def common_val(label):
        return re.search(r'class="v">([^<]*)<', common[label]).group(1)

    strip = ''.join(
        f'<div class="cell"><div class="numbers-figure" style="font-size:12.5pt;white-space:nowrap">{v}</div><div class="numbers-caption">{c}</div></div>'
        for v, c in [(common_val('Transfer time'), 'transfer time'), (common_val('Output voltage'), 'output voltage'),
                     (common_val('Output waveform'), 'output waveform'), (common_val('Backup time'), 'backup time')])

    th = lambda cols: ''.join(f'<th>{esc(c[0])}</th>' for c in cols)
    page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{esc(d["series"])} datasheet</title>
<link rel="stylesheet" href="../src/gridspec-print.css">
<style>
  .ds-specs {{ table-layout: fixed; }}
  .ds-specs td {{ font-size: 5.9pt; padding-top: 1.25mm; padding-bottom: 1.25mm; white-space: nowrap; letter-spacing: 0; }}
  .ds-specs th {{ font-size: 5.5pt; padding-top: 1.5mm; padding-bottom: 1.4mm; letter-spacing: .04em; }}
  .spec-pairs.compact > .row {{ padding: 1.4mm 0; }}
  .spec-pairs.compact .k {{ font-size: 6pt; }}
  .spec-pairs.compact .v {{ font-size: 6.8pt; }}
  .feature-grid {{ display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--gutter); row-gap: 5mm; }}
  .feature-grid .feature {{ border-top: var(--rule-2) solid var(--ink); padding-top: 2.5mm; }}
</style>
</head>
<body data-doc="ICA datasheet · {esc(d["series"])} · EN" data-rev="Rev. {esc(d["revision"])} · {esc(d["doc_code"])}">

<!-- FRONT -->
<div class="sheet"><div class="page">
  <div class="inner" style="bottom:42mm">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <img class="logo" src="../assets/img/logo2.png" alt="ICA">
      <div class="mono-label">Datasheet · {esc(d["doc_code"])}</div>
    </div>

    <div class="page-head" style="margin-top:14mm">
      <div class="breadcrumb">Products / {esc(d["family"])} / {esc(d["type"])}</div>
      <div><span class="tag">{esc(d["type_tag"])}</span>{tkdn}</div>
      <h1 class="display-title title" style="margin-top:4mm;margin-bottom:3mm">{esc(d["series"])}</h1>
      <div class="mono-line" style="margin-bottom:5mm;color:var(--ink)">{esc(d["range_line"])} · {n} models</div>
      <hr class="rule-2">
    </div>

    <div class="grid-12" style="margin-top:7mm">
      <div class="span-6">
        <div class="photo-tile white"><img src="../assets/img/{esc(d["image"])}" alt="" style="width:86%;height:86%"></div>
        <div class="photo-caption">{esc(d["caption"])}</div>
      </div>
      <div class="span-6">
        <p class="lead">{esc(d["description"])}</p>
        <div class="section-label" style="margin-top:9mm"><span class="num">01</span><span class="dash"></span><span class="name">Key features</span></div>
        <div class="feature-grid" style="margin-top:4mm">{features}</div>
      </div>
    </div>

    <div class="numbers-strip cols-4" style="margin-top:10mm">{strip}</div>
  </div>

  <div class="band-mist band-page" style="bottom:calc(-1 * var(--bleed));padding-top:7mm;padding-bottom:calc(9mm + var(--bleed))">
    <div class="grid-12" style="align-items:center">
      <div class="span-2"><div class="qr-box" style="width:24mm"><img class="qr" src="../assets/img/{esc(d["qr"])}" alt="QR code to the product page"></div></div>
      <div class="span-7">
        <div class="card-title">Request a quote · WhatsApp <span class="mono">0811-9761-110</span></div>
        <div class="mono-line" style="margin-top:1.5mm;font-size:7.5pt">{esc(d["product_url"].replace("https://", ""))} · contact@ica.id</div>
      </div>
      <div class="span-3" style="justify-self:end"><span class="button">Request a quote <span class="arrow">→</span></span></div>
    </div>
  </div>
</div></div>

<!-- BACK -->
<div class="sheet"><div class="page">
  <div class="inner" style="bottom:12mm">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div class="breadcrumb">Products / {esc(d["family"])} / {esc(d["type"])} / <span style="color:var(--ink)">{esc(d["series"])}</span></div>
      <div class="mono-label">{esc(d["doc_code"])}</div>
    </div>

    <div class="section-label" style="margin-top:7mm"><span class="num">01</span><span class="dash"></span><span class="name">Specifications</span></div>
    <table class="spec-table ds-specs" style="margin-top:3mm">
      <colgroup><col style="width:8.5%"><col style="width:15.5%"><col style="width:19.5%"><col style="width:5%"><col style="width:4.5%"><col style="width:5%"><col style="width:23.5%"><col style="width:6.5%"><col style="width:12%"></colgroup>
      <thead><tr><th>Model</th>{th(SPEC_COLS)}</tr></thead>
      <tbody>{spec_rows}</tbody>
    </table>

    <div class="grid-12" style="margin-top:7mm">
      <div class="span-12">
        <div class="section-label"><span class="num">02</span><span class="dash"></span><span class="name">Common to all models</span></div>
        <div class="spec-pairs compact" style="margin-top:3mm;display:grid;grid-template-columns:1fr 1fr;column-gap:var(--gutter)">{"".join(common_rows)}</div>
      </div>
    </div>

    <div class="section-label" style="margin-top:7mm"><span class="num">03</span><span class="dash"></span><span class="name">Dimensions and weight</span></div>
    <table class="spec-table ds-specs" style="margin-top:3mm">
      <colgroup><col style="width:12%"><col style="width:22%"><col style="width:12%"><col style="width:14%"><col style="width:24%"><col style="width:16%"></colgroup>
      <thead><tr><th>Model</th>{th(DIM_COLS)}</tr></thead>
      <tbody>{dim_rows}</tbody>
    </table>

    <div class="footer-block" style="position:absolute;left:0;right:0;bottom:0">
      <hr class="rule-1">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:3mm">
        <div class="mono-label" style="color:var(--ink)">ICA management systems: ISO 9001 · ISO 14001 · ISO 45001</div>
        <div class="mono-label">Rev. {esc(d["revision"])}</div>
      </div>
      <p class="small-print" style="margin-top:2mm;max-width:150mm">Values are taken from the ICA product catalog and may change without notice. A dash means the catalog lists no value for that model. Check the current datasheet at {esc(d["product_url"].replace("https://", ""))} before you order. ICA · Komp. Ruko Glodok Plaza, Jl. Pinangsia Raya No.1 Blok B11, Mangga Besar, Jakarta Barat 11180 · contact@ica.id · WhatsApp 0811-9761-110 · ica.id</p>
    </div>
  </div>
</div></div>

<script src="../src/sheet.js"></script>
</body></html>
'''
    OUT.mkdir(exist_ok=True)
    name = f'datasheet-{d["slug"]}'
    out_html = OUT / f'{name}.html'
    out_html.write_text(page)
    with open(OUT / f'{name}.values.csv', 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['model', 'catalog field', 'catalog value (as published)', 'printed as'])
        w.writerows(audit)
    return name, out_html


# ── Rendering ──────────────────────────────────────────────────────────────

LAYOUT_CHECK = """() => {
  const out = [];
  document.querySelectorAll('.sheet').forEach((sheet, i) => {
    const page = sheet.querySelector('.page').getBoundingClientRect();
    const foot = sheet.querySelector('.footer-block, .folio');
    const limit = foot ? foot.getBoundingClientRect().top : page.bottom;
    const inner = sheet.querySelector('.inner');
    if (!inner) return;
    for (const el of inner.querySelectorAll('*')) {
      if (foot && (foot.contains(el) || el.closest('.footer-block, .cta-band'))) continue;
      if (getComputedStyle(el).position === 'absolute') continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > limit + 0.5) { out.push(`page ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> ends ${((r.bottom - limit) / (96 / 25.4)).toFixed(1)} mm into the footer`); break; }
    }
    // A table cell whose text is wider than its column overprints its neighbour.
    sheet.querySelectorAll('.spec-table td, .spec-table th').forEach((td) => {
      const pad = parseFloat(getComputedStyle(td).paddingRight) || 0;
      const range = document.createRange(); range.selectNodeContents(td);
      const w = range.getBoundingClientRect().width;
      if (w > td.clientWidth - parseFloat(getComputedStyle(td).paddingLeft) - pad + 0.5) out.push(`page ${i + 1}: "${td.textContent.trim()}" is wider than its column`);
    });
  });
  return out;
}"""


def check_layout(pg, name: str) -> None:
    """Refuse a page whose content runs into its footer — it happened, on the TP back page."""
    problems = pg.evaluate(LAYOUT_CHECK)
    if problems:
        raise SystemExit(f'{name}: layout overflow\n  ' + '\n  '.join(problems))


# Ink #0A0F1C comes out of a plain conversion as a four-colour black
# (≈ 80/73/58/78). Small text and hairline rules in four inks blur when the
# plates are a fraction out of register, so Ink is set to pure K100 — what a
# prepress operator would do. Large Night areas keep their rich black.
INK_CMYK = (0.80, 0.73, 0.58, 0.78)


def ink_to_black(path: Path) -> None:
    import pikepdf
    num = rb'(\d*\.?\d+)'
    pat = re.compile(num + rb'\s+' + num + rb'\s+' + num + rb'\s+' + num + rb'\s+(k|K)(?=\s)')

    def swap(m):
        vals = [float(x) for x in m.groups()[:4]]
        if all(abs(v - t) < 0.025 for v, t in zip(vals, INK_CMYK)):
            return b'0 0 0 1 ' + m.group(5)
        return m.group(0)

    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        streams = []
        for page in pdf.pages:
            c = page.obj.get('/Contents')
            streams += list(c) if isinstance(c, pikepdf.Array) else [c]
            for _, x in (page.Resources.get('/XObject') or {}).items():
                if x.get('/Subtype') == '/Form':
                    streams.append(x)
        for st in streams:
            if st is None:
                continue
            data = st.read_bytes()
            new = pat.sub(swap, data)
            if new != data:
                st.write(new)
        pdf.save(path)


def render(name: str, html_path: Path) -> None:
    from playwright.sync_api import sync_playwright
    url = html_path.resolve().as_uri()
    tmp = OUT / f'{name}-print.rgb.pdf'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROMIUM)
        pg = b.new_page()
        for mode, w, h, dst in (('screen', '210mm', '297mm', OUT / f'{name}-screen.pdf'),
                                ('print', '230mm', '317mm', tmp)):
            pg.goto(f'{url}?mode={mode}')
            pg.evaluate('document.fonts.ready')
            pg.wait_for_load_state('networkidle')
            if mode == 'screen':
                check_layout(pg, name)
            pg.pdf(path=str(dst), width=w, height=h, print_background=True, margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
        b.close()

    # Screen: same pages, images recompressed for email (RGB kept).
    screen = OUT / f'{name}-screen.pdf'
    if shutil.which('gs'):
        small = OUT / f'{name}-screen.small.pdf'
        subprocess.run(['gs', '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite', '-dPDFSETTINGS=/ebook',
                        '-dColorImageResolution=200', '-dAutoRotatePages=/None', f'-sOutputFile={small}', str(screen)], check=True)
        small.replace(screen)

    # CMYK: Ghostscript's default conversion. The printer should still run
    # their own profile and PROOF THE BLUE — #0047D8 is near the edge of what
    # CMYK can print (README, "Before it goes to the printer").
    final = OUT / f'{name}-print.pdf'
    if shutil.which('gs'):
        subprocess.run(['gs', '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite',
                        '-sColorConversionStrategy=CMYK', '-sProcessColorModel=DeviceCMYK',
                        '-dPDFSETTINGS=/prepress', '-dAutoRotatePages=/None',
                        f'-sOutputFile={final}', str(tmp)], check=True)
        ink_to_black(final)
    else:
        print('  ! gs not found — only the RGB print PDF is written', file=sys.stderr)
    # The RGB print file is kept as well: the printer converts it with their
    # own profile (owner's brief: "have the printer convert to CMYK").
    rgb = OUT / f'{name}-print-rgb.pdf'
    tmp.replace(rgb)

    # Page boxes: media 230 × 317, bleed 216 × 303, trim 210 × 297.
    import pikepdf
    for f in (final, rgb):
        if not f.exists():
            continue
        with pikepdf.open(f, allow_overwriting_input=True) as pdf:
            for page in pdf.pages:
                page.MediaBox = [0, 0, 230 * MM, 317 * MM]
                page.BleedBox = [7 * MM, 7 * MM, 223 * MM, 310 * MM]
                page.TrimBox = [10 * MM, 10 * MM, 220 * MM, 307 * MM]
            pdf.save(f)

    prev = OUT / 'previews'
    prev.mkdir(exist_ok=True)
    if shutil.which('pdftoppm'):
        subprocess.run(['pdftoppm', '-png', '-r', '80', str(OUT / f'{name}-screen.pdf'), str(prev / name)], check=True)
    print(f'  {name}: screen + print PDFs written')


def main(argv: list[str]) -> None:
    what = set(argv) or {'brochure', 'datasheet'}
    OUT.mkdir(exist_ok=True)
    if 'brochure' in what:
        shutil.copy(SRC / 'brochure.html', OUT / 'brochure.html')
        # The copy in out/ points back at src/ for its CSS and script.
        p = OUT / 'brochure.html'
        p.write_text(p.read_text().replace('href="gridspec-print.css"', 'href="../src/gridspec-print.css"')
                     .replace('src="sheet.js"', 'src="../src/sheet.js"'))
        render('brochure', p)
    if 'datasheet' in what:
        for f in sorted((DATA / 'datasheets').glob('*.json')):
            name, html_path = build_datasheet(f)
            render(name, html_path)


if __name__ == '__main__':
    main(sys.argv[1:])
