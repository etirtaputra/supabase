# MANDA — Solar Design Knowledge Pack

> **Load this before any PV or mounting design task.** It is not a PV textbook.
> It is the transcription of the design rules ICAPROC actually runs, so that
> MANDA and the ERP produce the same numbers for the same inputs.
>
> **Source of truth:** `lib/systemDesign/` in `etirtaputra/supabase`.
> **Version:** written against `main` @ `b8954cb`, 2026-09-06. Engine v8.
> **Regenerate this file whenever `lib/systemDesign/*.ts` changes.**

>
> Part of the ICAPROC agent packs — `docs/agents/INDEX.md` names the current
> version of each. If this file is not the one the index names, it is stale.

---

## 0. The one rule

**MANDA does not invent PV design rules. ICAPROC already contains them.**

The two engines below are line-for-line ports of calculators ICA has used for
years — *"Kalkulator Pemasangan Solar ICA v11"* (mounting) and *"Smart Solar
BoM v7"* (whole system). Both are pinned by **golden tests**: the original HTML
apps were loaded in headless Chromium, their own functions were called, and the
rendered outputs captured as the expected values.

So there are only three legitimate things MANDA can say about a number:

1. **"The engine gives X"** — and she can show the formula and the constant.
2. **"The engine does not check that"** — see §9, the deliberate gaps. This is
   the most valuable thing she can say, and the one a generic PV assistant
   cannot.
3. **"The engine gives X and I believe X is wrong, because…"** — a finding,
   raised to a human, never silently corrected.

A fourth answer — a plausible number MANDA derived herself — is the failure
mode this document exists to prevent. If she cannot trace a figure to a rule
here, she says so.

---

## 1. Scope: what MANDA decides, and what she escalates

**She may decide alone**
- Running the engines and reporting their output, warnings included.
- Cross-checking a submitted design against the engine and listing the deltas.
- Flagging a spec that is missing, out of range, or internally inconsistent.
- Reading `3.0_components` specs and saying whether an item is design-ready.

**She must escalate to a human**
- Any change to a rule, constant, or golden-test number.
- Any design where the engine emits an error (not a warning).
- Anything structural or safety-bearing that the engine does **not** model
  (§9) — wind and snow load, roof structural capacity, earthing adequacy,
  cable voltage drop, arc-fault protection, PLN compliance.
- Writing a **spec value** into `3.0_components` that she inferred rather than
  read off a datasheet. Suggestions are shown and accepted by a person; see
  `lib/systemDesign/specSuggest.ts` — *"a spec nobody checked is worse than a
  spec that is missing, because the calculator would then size from it with
  confidence."*

**She never**
- Sees or quotes cost, supplier, or margin in a customer-facing context.
- Names the supplier's model to a customer. Only ICA's own
  `internal_description` is customer-facing.

---

## 2. The architecture MANDA must not break

```
  INPUT (answers)  →  ENGINE  →  generic BoM lines  →  RESOLVER  →  quote lines
                      pure         role + param + qty    catalog       item + tier price
                      arithmetic   "a 4850 mm rail"      + price       + stock
```

- **An engine is pure arithmetic.** It never touches the catalog, never sees a
  price, never knows a brand. That is what makes it testable against the
  standalone calculators.
- **A resolver** turns each generic line into a real item by matching
  `specifications.bom_role`, then prices it at the customer's tier.
- **Anything the catalog cannot satisfy survives as free text**, flagged *"Not
  in catalog — priced by hand"*. **A missing clamp must never block a
  quotation.**

If MANDA is asked to "pick a rail", the correct move is: run the engine to get
the generic line, then resolve it. Picking a part first and reverse-engineering
the quantity is the wrong order and will disagree with the ERP.

---

## 3. The mounting engine (v11)

`lib/systemDesign/mounting.ts` · `calculateMounting(input, options)`

### 3.1 Inputs

| Field | Meaning |
|---|---|
| `panelCount` | modules in the array |
| `numberOfRows` | rail lines; **clamped down to `panelCount`** if larger, with a warning |
| `panelLengthMm` / `panelWidthMm` | module long / short side |
| `panelThicknessMm` | frame thickness — **this IS the clamp size** |
| `railLengthMm` | stock rail; the calculator offers **4850** and **3600** |
| `panelSpacingMm` | gap between modules (thermal expansion + mid clamp) |
| `mountType` | `roof` \| `ground` \| `flat` — changes the support's NAME only |
| `orientation` | `portrait` \| `landscape` |

### 3.2 Constants (v11's rules of thumb, overridable in options)

| Constant | Default | What it does |
|---|---|---|
| `supportSpacingMm` | **1700** | rafter/purlin spacing → supports per rail |
| `minEdgeSpacingMm` | **25** | below this the rail end is structurally risky |
| `overhangThreshold` | **0.3** | last rail used under 30 % = wasteful overhang |

### 3.3 The arithmetic, in order

```
orientation:   portrait  → effectiveWidth = min(L,W),  effectiveHeight = max(L,W)
               landscape → effectiveWidth = max(L,W),  effectiveHeight = min(L,W)
               (min/max, not the raw fields, so swapped inputs still behave)

panelsPerRow   = ceil(panelCount / numberOfRows)
arrayWidthMm   = panelsPerRow × effectiveWidth + (panelsPerRow − 1) × panelSpacing
railsPerLine   = ceil(arrayWidthMm / railLength)
edgeSpacingMm  = (railsPerLine × railLength − arrayWidthMm) / 2      ← spare at EACH end
railUtil%      = min(100, arrayWidthMm / (railsPerLine × railLength) × 100)

totalRails      = railsPerLine × 2 × numberOfRows          ← 2 rail lines per row
railJoints      = railsPerLine > 1 ? (railsPerLine − 1) × 2 × numberOfRows : 0
endClamps       = numberOfRows × 4
midClamps       = max(0, (panelCount − numberOfRows) × 2)
supportsPerRail = max(2, ceil(railLength / 1700) + 1)
supports        = totalRails × supportsPerRail
groundClips     = midClamps                                ← bonding scales with panels
groundingLugs   = ceil(endClamps / 2)
```

**Two warnings, and they are mutually exclusive (edge check wins):**
- `edgeSpacing < 25 mm` → *"structurally risky"*.
- else if `railsPerLine > 1` and the last rail is under 30 % used → *"large rail
  overhang — consider a cut-to-length rail to save material."*

**Bails out** (`ok: false`) when `effectiveWidth` or `railLength` is 0 — i.e.
the module has no dimensions on file. It does not guess.

### 3.4 Worked example — verify MANDA against this

`4 panels · 1 row · portrait · 2278×1134×35 mm · 4850 mm rail · 20 mm spacing · roof`

```
effectiveWidth = 1134            panelsPerRow  = 4
arrayWidth     = 4×1134 + 3×20   = 4596 mm
railsPerLine   = ceil(4596/4850) = 1
edgeSpacing    = (4850 − 4596)/2 = 127.0 mm      ✓ ≥ 25, no warning
railUtil       = 4596/4850       = 95 %
totalRails 2 · railJoints 0 · endClamps 4 · midClamps 6
supportsPerRail = max(2, ceil(4850/1700)+1) = 4  → supports 8
groundClips 6 · groundingLugs 2
```

Other pinned scenarios from `mounting.test.ts` (all read out of the HTML app):

| Scenario | rails | joints | end | mid | supports | edge mm | util |
|---|---|---|---|---|---|---|---|
| 12 panels, 2 rows, landscape, ground | 12 | 8 | 8 | 20 | 48 | 391.0 | 95 % |
| 9 panels, 3 rows, 3600 rail, flat, small panel | 6 | 0 | 12 | 12 | 24 | 637.5 | 65 % |
| 3 panels but 8 rows asked | 6 | 0 | 12 | 0 | 24 | 1924.0 | 21 % (rows→3) |
| 5 panels, 1 row (spills to rail 2) | 4 | 2 | 4 | 8 | 16 | 1975.0 | 59 % ⚠ overhang |

---

## 4. The system engine (v7)

`lib/systemDesign/system.ts` · `calculateSystem(input, candidates, options)`

Two paths. **The structure block is not re-derived — it calls the v11 mounting
engine above.** One set of mounting rules, one set of tests.

### 4.1 Constants

| Constant | Default | Used for |
|---|---|---|
| `continuousSafetyFactor` | **1.25** | margin over running load |
| `assumedSurgeMultiple` | **2** | surge headroom when the datasheet lists none |
| `dodLithium` | **0.8** | depth of discharge, LiFePO4 |
| `dodLeadAcid` | **0.5** | depth of discharge, lead-acid |
| `systemEfficiency` | **0.8** | wire-to-load losses |
| `vocRule` | **`'temperature'`** | how cold-morning Voc rise is answered (§5) |
| `minCellTempC` | **18** | coldest site temperature strings are sized for (§5) |
| `vocMarginFactor` | **0.95** | the OLD flat margin; used by `vocRule: 'flat'` and as the fallback when a module has no β |
| `cableMetresPerPanel` | **6** | string cabling |

### 4.2 ON-GRID path

```
1. The PLN connection caps the inverter.
   viable = inverters where phase == gridPhase AND rated_kW × 1000 ≤ gridVA
   → pick the LARGEST.  No viable inverter is an ERROR, not a warning.
2. targetDC = rated_kW × 1000 × dcAcRatio
   numPanels = ceil(targetDC / panel.power_stc_w)
3. Size the strings (§5), then build structure + balance of system.
```

Phase is read off the text: `nominal_ac_voltage_vac` containing `3L` or
`3-phase` → 3-phase, else single.

**Balance of system, on-grid:** `solar_cable` 6 mm² × (panels × 6 m) ·
`mc4_pair` × (strings × 2 + 2) · `ac_distribution` × 1 (`single`/`triple`).
**No combiner box on the on-grid path** — v7 does not emit one.

### 4.3 OFF-GRID / HYBRID path

```
1. LOAD TABLE
   runningW = Σ watts × qty
   totalWh  = Σ watts × hours × qty
   surgeW   = Σ (watts × qty × (inductive ? 2 : 1))     ← motors/pumps counted twice
   requiredContinuousW = runningW × 1.25
   No loads → ERROR.

2. INVERTER
   candidates must declare battery_nominal_voltage_vdc.
   An inverter is eligible only if the CATALOGUE can build its bus in the
   chosen chemistry — asked of the battery pool, never a hard-coded list.
   Two passes: inverters bankable in the REQUESTED chemistry first; only if
   there are none does lead-acid stand in for lithium.
   surgeCapacity = surge_power_va, else rated_output_power_w × 2
   Pick the SMALLEST unit meeting continuous AND surge.
   If none: take the largest and parallel them —
     qty = ceil(max(requiredContinuousW, surgeW / 2) / rated_output_power_w)

3. BATTERY BANK
   dod = lithium ? 0.8 : 0.5
   requiredWh = totalWh × autonomyDays / dod
   candidate = right chemistry (case-insensitive) AND seriesOnBus() ≠ null
     (no battery of that chemistry builds the bus → fall back to lead-acid,
      WITH a warning, because it halves usable depth of discharge)
   series   = seriesOnBus(busV, battery)      ← a whole number, or no candidate
   parallel = ceil(requiredWh / (series × battery.energy_wh))
   total    = series × parallel

4. ARRAY
   requiredPVW = totalWh / (psh × 0.8)
   numPanels   = ceil(requiredPVW / panel.power_stc_w)
```

**Balance of system, off-grid/hybrid:** cable and MC4 as above, plus
`combiner_box` × inverters · `dc_breaker` × inverters · `ac_distribution` × 1.

### 4.4 Worked examples — verify MANDA against these

**On-grid, 5500 VA single-phase, DC/AC 1.2, ICA100-36M (100 W, 26.91 Voc):**
inverter `SNV-GT5023DSC` · 60 panels · 6.00 kWp · 3 strings × max 21 in series ·
**warns**: the inverter supports only 2 strings (2 MPPT × 1) → needs a combiner
or a second inverter. Structure: 16 rails, 12 joints, 64 hooks, 8 end / 116 mid
clamps, 360 m cable, 8 MC4 pairs.

**On-grid, 23000 VA three-phase, DC/AC 1.3, ICA200-72M:** `SNV-GT1033DT`
(10 kW) · 65 panels · 13.00 kWp · 4 strings × 18 · `ac_distribution` = `triple`.

**Off-grid, lithium, 1 day, with an inductive pump** — loads 6×100 W×8 h,
1×750 W×4 h *inductive*, 10×40 W×12 h:
running **1750 W**, surge **2500 W** (pump doubled), required continuous
**2188 W** → `SNV-GH3041`, 1 unit. Bank `LIP48100LF` ×4 = 1 series × 4 parallel,
**19.20 kWh** usable. Array 40 panels at PSH 4.0.

**Off-grid, lead-acid, 2 days** — 1×1500 W×2 h *inductive*, 3×200 W×10 h:
running **2100 W**, surge **3600 W**, continuous **2625 W** → `SNV-GH3041`,
bank `LIP12100D` **4 in series** (12 V → 48 V bus) × **8 parallel**.

### 4.5 Battery bus arithmetic — read this before checking any bank

**A bank is a WHOLE number of packs in series.** The engine enforces it; MANDA
must too.

**Voltage is a CLASS, not a literal.** A LiFePO4 cell is 3.2 V, so every
lithium pack reads 6.67 % above its bus: `12.8 → 12`, `25.6 → 24`,
`51.2 → 48`, `409.6 → 384`. ICAPROC's catalogue types the class on most rows
and the literal on some — `EPEVER LR51100A` states **51.2** where every other
51.2 V pack states 48. Both describe the same 48 V bank and both now size it
identically.

```
BATTERY_VOLTAGE_CLASSES = [12, 24, 36, 48, 96, 192, 384]
VOLTAGE_CLASS_TOLERANCE = 0.10        ← covers the 6.67 %; classes are an
                                        octave apart, so nothing is ambiguous

voltageClassOf(51.2) = 48       voltageClassOf(30) = null   ← nothing standard
seriesOnBus(48, 12)  = 4        seriesOnBus(48, 36) = null  ← 1.333 is not an answer
seriesOnBus(48, 51.2)= 1        seriesOnBus(24, 48) = null  ← pack bigger than bus
```

A pack with no class, or one that does not divide the bus, **is not a
candidate**. It is refused with a message. It is never rounded into place.

**Chemistry matching is case-insensitive.** v7's fixture says
`"Lead-Acid (Deep Cycle)"`; ICAPROC says `"Lead-acid (deep cycle)"`. Matching
the exact string found the test data and never the real data.

**If MANDA ever sees a non-integer battery quantity, something is wrong
upstream of the engine — stop and report it. The engine cannot produce one.**

---

## 5. String sizing — MANDA's core cross-check

`sizePvStrings(panel, inverter, numPanels, category, options)`

**Changed 2026-09-06 (engine v8, owner's decision).** v7 sized every string on
a flat 0.95 of the inverter maximum. The engine now corrects each module's own
Voc by its own temperature coefficient to the site's coldest expected
temperature — what IEC 62548 and NEC 690.7 actually ask for.

### 5.1 The inverter's limits (unchanged)

```
on-grid : maxVoltage = pv_max_voltage_vdc              || 1000
          mppt       = no_of_mppts                     || 1
          perMppt    = strings_per_mppt                || 1
hybrid  : maxVoltage = pv_max_open_circuit_voltage_vdc || 600
          mppt       = no_of_mpp_trackers              || 1
          perMppt    = 1        ← the hybrid data does not state strings/tracker
```

**Note the fallbacks.** A missing `pv_max_voltage_vdc` silently becomes
**1000 V** and a missing `no_of_mppts` becomes **1**. MANDA must say whether a
value was READ or DEFAULTED — a default that happens to be generous is the
quietest way to over-length a string.

### 5.2 The rule (default: `temperature`)

```
Voc(T)          = Voc_STC × (1 + β/100 × (T − 25))     β = temp_coeff_voc_percent_per_c, NEGATIVE
maxSeriesLength = max(1, floor(maxVoltage / Voc(minCellTempC)))
numStrings      = max(1, ceil(numPanels / maxSeriesLength))
maxAllowed      = mppt × perMppt
```

β is negative, so **below 25 °C the voltage RISES**. That rise on a cold clear
dawn is what destroys an inverter, and it is why string length is a temperature
question rather than a fixed percentage.

**`minCellTempC` is an INPUT, not a constant** — a field on the designer,
stored with the design so a quote records the temperature it was sized for.

| Site | Use roughly |
|---|---|
| Jakarta / Surabaya lowland | **18 °C** (the default) |
| Bandung and similar highland | ~14 °C |
| Dieng plateau | 0 °C or below |

**Lower is always the safe direction** — it shortens strings. If MANDA does not
know the site, she says so and asks; she does not assume the default fits.

### 5.3 Two warnings, and neither is noise

- **String longer than the old rule allowed.** The flat 0.95 was equivalent to
  designing for **3–9 °C** depending on β (−0.24 → 3.1 °C, −0.27 → 5.5 °C,
  −0.29 → 6.9 °C, −0.32 → 8.6 °C), which is conservative for most of Indonesia.
  So correcting properly usually makes strings **LONGER**. The engine says so,
  naming the per-module voltage at that temperature. **This is correct, not a
  fault** — but MANDA must confirm the site really cannot get colder than the
  temperature used.
- **No temperature coefficient on file.** The module falls back to the flat
  margin and the engine names the missing spec. **3 of 13 catalogue modules are
  in this state** (JINKO JKM575N and two ICA rows). A design sized this way is
  not wrong, but it is sized by the old rule — MANDA must say so rather than
  report it as temperature-corrected.
- **Exceeded MPPT capacity** (unchanged): `numStrings > maxAllowed` warns, never
  errors — add a combiner or a second inverter.

### 5.4 What `StringConfig` reports

`rule` (`'temperature'` | `'flat'`) · `vocAtMinTempV` · `minCellTempC` ·
`maxSeriesLength` · `numStrings` · `flatRuleMaxSeriesLength` (what v7 would
have allowed, for comparison) · `warnings`.

**MANDA quotes `rule` on every string report.** "19 in series" means nothing
without saying which rule and which temperature produced it.

### 5.5 Worked example — verify MANDA against this

TRINA TSM-620NEG19RC.20 (Voc 49.6 V, β −0.24 %/°C) on a 1000 V inverter:

```
at 18 °C : Voc = 49.6 × (1 + (−0.24/100) × (18 − 25)) = 50.43 V → floor(1000/50.43) = 19
at  0 °C : Voc = 52.58 V                                        → floor(1000/52.58) = 19
at 25 °C : Voc = 49.60 V                                        → floor(1000/49.60) = 20  ⚠ warns
v7 flat  : floor(1000 × 0.95 / 49.6)                            = 19
```

---

## 6. The catalog contract — how a generic line becomes a part

`lib/systemDesign/resolve.ts`

### 6.1 The `bom_role` vocabulary (`lib/specSchema.ts`)

| Role | Discriminating spec (`BOM_ROLE_PARAMS`) |
|---|---|
| `rail` | `rail_length_mm` |
| `rail_joint` | — |
| `mid_clamp` | `clamp_thickness_mm` |
| `end_clamp` | `clamp_thickness_mm` |
| `roof_hook` | `roof_type` (`metal` \| `tile` \| `concrete`) |
| `grounding_clip` | — |
| `grounding_lug` | — |
| `solar_cable` | `cable_cross_section_mm2` |
| `mc4_pair` | — |
| `combiner_box` | — |
| `dc_breaker` | — |
| `ac_distribution` | `phase` |

### 6.2 Selection, in order

1. Candidate declares the role in `specifications.bom_role` **and** matches the
   discriminating parameter. *A 35 mm mid clamp is not a 30 mm one.*
2. Candidate must pass `specReadiness` and must be **offerable** —
   `isOfferable()`: neither Cost-Basis **Hidden** nor **archived**. (Archiving
   was added in 2026-09-03 and every picker had been written before it existed,
   so archived items went on being offered until 2026-09-06. If MANDA sees a
   retired item in a design, that class of bug is why.)
3. Among survivors: **in stock** beats out of stock → **priced** beats unpriced
   → **cheapest** wins. Ties break on `component_id` so two runs agree.
4. Nothing matched → free text, `resolved: false`, *"Not in catalog — priced by
   hand"*.

### 6.3 Parameters are FIT RANGES, not single sizes — `specCovers()`

Real parts are sold to span a range. A "MIBET MD U20 Inter Clamp 35-39" takes
any frame from 35 to 39 mm.

| Spec value | Covers |
|---|---|
| `35` | exactly 35 |
| `35-39` | 35 … 39 inclusive |
| `30/33` | 30 **or** 33 (a list, not a span) |
| `30-34/50` | 30 … 34, or 50 |

Matching these exactly would silently drop the right clamp and hand-price a
line instead — *the failure that hides until site.*

### 6.4 Mounting systems must not be mixed — `mountingSystem.ts`

A kit is only valid within one family. **MIBET MD clamps ride MIBET MD rails,
and an MD T-slot rail takes the T-slot splice, not the symmetric one.**
ICA quotes **MIBET MD with T-slot rail** (owner, 2026-08-06).

Series comes from `specifications.mounting_series` when declared, otherwise
from brand + a whole-word model token (`MD`, `MA`, `Mini` — "MD" must not match
inside "MODULE"). Profile comes from `rail_profile`, else the text (`t-slot` /
`symmetric`). Only `rail` and `rail_joint` are profile-sensitive.

**MANDA must check series consistency on any BoM she reviews.** The engine does
not enforce it — `shortlist()` is offered to the designer as a choice, and an
unshortlisted run can mix families.

---

## 7. Data contracts

| Table | What it holds |
|---|---|
| `3.0_components` | items. `category`, `internal_description`, `specifications` jsonb, `norm_value`, `selling_price_idr` |
| `22.0_sales_quotes` | quote header; `system_design` jsonb stores the reproducible run |
| `22.1_sales_quote_line_items` | lines; `design_role` stamps engine-owned lines |
| `21.0/21.1` | price tiers and per-item overrides |
| `30.1_stock_balances` | live stock, per (item, warehouse) |

**`SystemDesign` (stored on `22.0.system_design`)** — `engine`
(`mounting`\|`system`), `version`, `input` (the answers, verbatim), `warnings`,
`generated_at`. This is what makes a REGENERATE possible and an old quote still
explicable after a rule changes.

**`design_role`** is stamped on every generated line as `role` or
`role:param`. **REGENERATE replaces only lines that carry one — a line typed by
hand has no role and is never touched.** MANDA must preserve this.

---

## 8. Cross-check protocol

When handed a design to verify, work in this order and report each step:

1. **Inputs.** Are panel dimensions, `voc_stc_v`, `power_stc_w` present on the
   actual catalog row — or were they defaulted? Name the source.
2. **Re-run the engine** with those inputs. Report every warning it raises,
   including the ones the salesperson dismissed.
3. **Diff.** List every line where the submitted BoM differs from the engine's,
   with the delta and the likely cause. Do not "correct" the submission.
4. **String check.** Recompute §5 independently. State `maxSeriesLength`,
   `numStrings`, `maxAllowed`, and whether any inverter limit was defaulted.
5. **Series consistency** (§6.4) — is every mounting part from one family and
   one rail profile?
6. **Battery bank** (§4.5) — is the series count a whole number, does the pack's
   voltage CLASS divide the bus, and is the depth of discharge the one for the
   chemistry actually chosen (0.8 lithium / 0.5 lead-acid)? A cross-chemistry
   fallback must appear as a warning; if the bank is lead-acid and no warning
   was raised, ask why.
7. **The gaps** (§9) — say explicitly which checks were *not* performed by
   anyone, so nobody assumes they were.
8. **Verdict**: matches / differs / cannot verify, plus what would settle it.

---

## 9. What the engines deliberately do NOT check

**This section is the reason MANDA is useful.** Everything below is outside the
engine. If a design depends on it, a human engineer must answer it.

**Electrical**
- ~~**Temperature-corrected Voc.**~~ **CLOSED 2026-09-06 (v8)** — see §5. What
  remains of it: the correction uses the site temperature a person typed, so it
  is only as good as that number; and 3 of 13 modules still have no β and fall
  back to the flat margin.
- **MPPT lower bound.** Only the maximum voltage is checked. A string too
  SHORT to start the tracker passes silently.
- **Isc and string fusing.** `max_series_fuse_a` is declared on the module and
  never read. No parallel-string overcurrent check.
- **Cable sizing and voltage drop.** Cable is a flat **6 m per panel at
  6 mm²**, regardless of run length, current or drop.
- **AC-side protection sizing**, RCD/AFCI selection, earthing adequacy.
- **Inverter oversizing on-grid.** The rule is strictly `rated_kW × 1000 ≤
  gridVA`; it never allows the export-limited oversize a real PLN design may.

**Structural**
- **Wind and snow load, roof capacity, purlin condition.** `supportSpacingMm`
  1700 is a rule of thumb, not an engineered span. The 25 mm edge check is
  geometric, not structural.
- **Row-to-row shading, tilt, azimuth, inter-row pitch.** Not modelled at all.
  `numberOfRows` is a layout answer, not a shading calculation.
- Roof penetration detailing and waterproofing.

**Energy**
- **PSH is an input, not a lookup.** No irradiance database, no soiling,
  degradation, or seasonal variation. `systemEfficiency` 0.8 absorbs all losses.

**Battery bank — three defects FIXED 2026-09-05 (`4146b29`)**

Recorded because MANDA will meet older quotes and older conversations that
carry the old numbers, and because they show what this class of bug looks like.

1. **Fractional battery counts.** `series = busV / nominal_voltage_v` had no
   integer guard. A 25.6 V pack on a 48 V bus gave **series 1.875, qty 3.75**.
   Now: voltage classes and `seriesOnBus()` (§4.5) — whole numbers only.
2. **Hard-coded lithium buses.** `isLithium && bus !== 48 && bus !== 384`
   excluded all five 24 V inverters on the shelf, though the catalogue carries
   five 25.6 V LiFePO4 packs for them. Now: compatibility is asked of the
   battery pool.
3. **Lead-acid never matched.** The code tested `includes('Lead-Acid')` while
   the catalogue writes `"Lead-acid (deep cycle)"`, so a lead-acid design found
   nothing and fell through to the first row in the list — quite possibly
   lithium — sizing the bank at the wrong depth of discharge in silence. Now:
   case-insensitive, and any cross-chemistry fallback warns.

All 10 v7 parity tests still pass, so no existing design number moved. No
stored quote carried a `system_design`, so nothing already written needed
repair. **All three were found by reading the code against the real catalogue,
not by a failing test — which is the work MANDA is for.**

---

## 10. Prohibitions

- Never change a **golden test** number to make a build pass. Those numbers are
  the calculators' answers. Change one only when the rule deliberately changed,
  and say so out loud.
- Never write an inferred spec into `3.0_components` without a human accepting
  it.
- Never present an engine default as a datasheet value.
- Never let a missing part block a quotation — flag it, price it by hand.
- Never quote a customer the supplier's model or description. ICA's
  `internal_description` only.
- Never report a figure MANDA cannot trace to a rule in this document.

---

## 11. Where to look in the code

| File | What it owns |
|---|---|
| `lib/systemDesign/types.ts` | `BomLine`, `ResolvedLine`, `SystemDesign`, `designRoleOf` |
| `lib/systemDesign/mounting.ts` | the v11 mounting engine + its constants |
| `lib/systemDesign/system.ts` | the v7 system engine, both paths, `sizePvStrings`, `voltageClassOf` / `seriesOnBus` / `isChemistry` |
| `lib/systemDesign/resolve.ts` | role → catalog item, `specCovers`, ranking |
| `lib/systemDesign/mountingSystem.ts` | series / rail-profile families |
| `lib/systemDesign/specSuggest.ts` | spec suggestions, and why they need a human |
| `lib/systemDesign/v7Fixture.ts` | v7's own component database, verbatim |
| `lib/specSchema.ts` | `BOM_ROLES`, `BOM_ROLE_PARAMS`, `specReadiness` |
| `*.test.ts` alongside each | the golden numbers |
