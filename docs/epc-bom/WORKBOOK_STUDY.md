# EPC BOM workbooks — how they work, where they break (study, 2026-10-11)

The owner uploaded the four Bill-of-Material workbooks the engineers build big
EPC quotes in, and asked for a web calculator that ends hand-linking between
sheets ("my engineers often missed linking to the right formula or even missing
rows or columns"). This is what reading them found. It is the design basis of
`lib/bomCalc/` and the BOM Calculator page (`/proposals/bom`).

| Workbook | Plant | Layout |
|---|---|---|
| Bill of Material – Hon Chuan R1 | 3,523.5 kWp rooftop, 4,860 × Trina 725 W, 9 × Huawei 330 kW, 3.5 MVA step-up | **Template S** |
| Bill of Material DMST 1 & 3 Rev 2 "Bottom Price 2 Okt" | DMST 1 ≈ 2.0 MWp, DMST 3 ≈ 0.37 MWp | Template X |
| Appendix A – Mulia Part 6 (8 / 10.2 MWp) | Xurya RFQ, Mulia Industrindo | Template X |
| Bill of Material Foxconn | 1.24 MWp, 1,890 × Longi 655 W, 7 × 150 kW | Template X |

## 1. The two layouts

**Template S (Hon Chuan)** — 11 numbered categories (Modules, Inverters,
Mounting, AC and DC Cable, AC Switchgear, Grounding, Cable Raceway, Monitoring,
O&M, Project Works, Miscellaneous). Per row: Qty (D, often linked to a
calculation sheet) · Unit · Material unit price F (= Q = cost O ÷ (1 − margin P),
P5 = 0.11 global, some rows hard-code 0.12/0.15) · G = D×F · Installation unit
price H (typed, no margin) · I = D×H · J = G+I · K = J / plant Wp. Total row
sums every row. 'Jasa' rolls installation up per category and costs the same
work again bottom-up as manpower (Rp 1,841 m per item vs Rp 1,762 m per
manpower — a cross-check, not linked). '17Y OnM' prices 17 years of O&M flat
(no escalation) at Rp 195 m/yr.

**Template X (Xurya RFQ — DMST, Mulia, Foxconn)** — sections A–P each closed by
a sub-total; one combined unit price G = P = N ÷ (1 − O); installation is its
own section in man-days driven by the site-manager days × fixed ratios; a
"Responsibility" column (Xurya / EPC); 'TOP' (terms of payment: 25 % DP, 10 %
per milestone, 5 % COD, 5 % PR test, 3.5 % + 1.5 % retention); 'Rekap'
(customer summary, four priced lumps); 'FS' (25-year NPV/IRR/LCOE/payback).
The hidden 8.1 MWp / TOP / Warranty sheets in DMST and Foxconn are copies from
the Mulia job and are dead.

## 2. The calculation sheets — the method behind them

- **Strings** — one row per inverter, modules per string typed per input;
  strings = COUNT, modules = SUM, DC/AC. **No workbook checks Voc at cold
  temperature, the MPPT window or MPPT current.**
- **DC cable** — per roof: cable = (distance to string start + average string
  run) × 2 × strings, split 4 / 6 / 10 mm² by distance with the 4 % rule
  Lmax = 0.04·N·Vmp/(R·Imp) (R = 5.09 / 3.39 / 1.95 Ω/km); connectors =
  strings × (1 + jumpers). DMST typed run = width/2 (exact geometry); the others
  type the full run (one run of hidden slack per string).
- **AC cable** — inverter → combiner → service breaker → transformer /
  interconnection. Ampacity = runs × catalogue rating × k1·k2·k3 against 1.25 ×
  current; voltage drop √3·I·(R cosφ + X)·L/(V·runs) (sinφ left off X; only the
  short inverter cable was ever checked, never the long feeder). Lengths = route
  × runs × 3 + neutrals + tails. Lugs = conductors × 2.
- **Tray** — fill ratio Σ n·π(OD/2)² ÷ (W×H) ≤ ~0.40; pieces = ROUNDUP(m/3),
  covers, clamps, joints, bolts; a blended Rp/m becomes the BOM cost.
- **Walkway / lifeline / plumbing** — metres per roof typed off the layout
  × 1.01; per-metre recipes (ZAM panel ÷ 2.4 m + supports; anchors built up from
  parts — Mulia derives anchor counts from length: end = L/30, intermediate =
  L/6 − end); water pipe accessories spread per metre.
- **O&M** — per-visit IDR/Wp rates × visits × years; site works = man-days ×
  day rates, months × rentals.

## 3. What was wrong (cost unless marked selling)

**Hon Chuan R1**
- NIDI/SLO row 131: material price typed **Rp 250 m**; its own cost gives Rp 28.1 m.
- Cable tray: rows 74–75 (1,159 m + 40 m) have installation but **no material
  price**, and the same DC run is also row 76 (`'Kabel DC'!V5` 1,165 m at the
  legacy Rp 310,864/m) — quantified twice; ≈ Rp 166 m selling too high. Row 77
  prices 185 m of AC tray; the tray sheet's AC section is DMST's copied data.
- AC cable: the sizing sheet designs **NA2XY (aluminium)**, the BOM prices **NYY
  (copper)** — about **Rp 2.06 billion** selling either way.
- Feeder ampacity: 5 × NYY 300 at 587 A × 0.91 = 2,670.85 A against 2,679.75 A
  needed — typed "sufficient", 0.3 % short.
- 'Kabel DC' row 12 re-cables 18 strings on 6 mm² that are already on 4 mm²
  (+3,960 m, ≈ Rp 100 m); 4 mm² connectors count all 180 strings (+294 pairs).
- 'String' lists INV 1–9 twice (360 strings for 180) → conduit and glands doubled.
- Cleaning sold 4×/yr, costed 2× (≈ Rp 293 m over 3 years); pump + tank promised
  not costed (Rp 28.9 m selling); CAR insurance and temporary warehouse at 0;
  grounding accessories bypass the margin; ladders unpriced.
- Lugs per inverter empty (≈ Rp 22 m); labels use DMST's 96 strings, not 180.

**Mulia 8 MWp (submitted; the TOP schedule inherits it)** — sub-totals drop
NYA 70, NYA 16, connectors and the 9 grounding pits: **−Rp 266 m**. Lifeline
costed on 3,008 m but divided by 4,361 m (≈ −Rp 160 m selling). Text "6,5" in
SUM ranges ignored (≈ −Rp 70 m).

**DMST 1** — cable sub-total omits NYA 35 + AC lugs: **−Rp 36.5 m**; walkway
969 m computed but qty blank (Rp 409 m selling) in the bottom-price version;
BOS divisor 6 for 12 inverters (+Rp 15.6 m).

**Foxconn** — sub-totals omit rows (−Rp 39.5 m); DC tray 524 m has no cost
(≈ −Rp 153 m selling); cable from the superseded 630 W layout (+7 %); O&M at
1.35 % of the grand total is a circular reference; FS payback divides by the
wrong column (6.57 yr, correct ≈ 5.62).

## 4. What the calculator does about it

1. **One source of truth per fact.** Strings live on the inverters; roofs must
   add up to them (checked). The BOM reads quantities by key, never by cell.
2. **Margin once, by one rule**: material sell = cost ÷ (1 − margin), per row or
   the project default. Installation is sold as typed (Template S).
3. **Totals sum every row** — there is no range to forget.
4. **Checks**: cold string voltage vs inverter and module limits; MPPT window
   and current; DC voltage drop per roof (auto-size 4 → 6 → 10 → 16 mm²); AC
   ampacity with derating and the 125 % factor; AC voltage drop with X·sinφ;
   rows with quantity but no price; installation without material; links to a
   value that does not exist; a row whose text names one cable while the design
   uses another (Cu/Al); distance from a target Rp/Wp.
5. **Cable resistance from IEC 60228**, temperature-corrected (reproduces the
   sheets' 0.325 Ω/km for NA2XY 120 at 90 °C). **Ampacity is an input** from the
   maker's catalogue — never invented.
6. **Prices from the catalogue** with the EPC proposals' own cost rule (TUC from
   paid POs, then the latest supplier quote, with the Cost Basis buffer).
7. **Export** in the customer's layout without cost or margin.

## 5. Roadmap (one step per thread)

1. ✅ Electrical core — strings, DC cable, AC cable, the priced BOM in the Hon
   Chuan layout, checks, Excel export (2026-10-11).
2. ✅ Raceway — tray sizing by fill ratio and a stick-price table; conduit, glands,
   labels, ties, clips from string and inverter counts (2026-10-12,
   `lib/bomCalc/raceway.ts`). Labels per inverter (10), per AC circuit (2) and
   ties per module (2) were not recorded from the sheets — working figures the
   engineers must confirm; the tests are the recorded rules applied to the
   recorded quantities, to be checked cell by cell when the workbooks are back.
3. ✅ Civil / O&M — walkway, lifeline, water cleaning, grounding pits, inverter
   stations from per-metre recipes; O&M years with escalation (no double count
   with a long-term O&M contract) (2026-10-15, `lib/bomCalc/civil.ts`).
   Supports per panel (2), pump sets (1), pits per inverter (1) and inverters
   per station (1) are working figures the engineers must confirm; tests are
   the recorded rules on the recorded quantities, to be checked against the
   sheets when the workbooks are back.
4. ✅ Project works and manpower (Jasa) as the cross-check on installation
   (2026-10-16, `lib/bomCalc/works.ts`). Duration 4 months × 26 working days
   are starting figures; the crew in the tests is a test crew built to cost
   the recorded Rp 1,762 m.
5. Template X (Xurya): sections A–P, responsibility column, man-day installation,
   TOP schedule and FS (reuse `lib/energyEconomics.ts`).
6. "Make a proposal from this" — write a normal 10.0/10.1/10.2 proposal from a
   calculation, once the owner is happy with it.
