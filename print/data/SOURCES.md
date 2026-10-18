# Sources — every sentence, number and name in the print files

Taken from ICA's own published pages on 2026-10-18. ica.id's product pages are
fed by the central catalog (katalog.ica.id, "pusat katalog produk"); its public
data was read through the ica.id site and its WordPress API
(`/wp-json/wp/v2/produk`, `/projects`, `/kategori-produk`). Nothing was added
that these pages do not say; where a page gives no value (a project's year,
a series' TKDN certificate) the print leaves it out.

| Where in print | Source |
|---|---|
| Cover headline, sub-line, "UPS · Solar · Battery storage", cover product captions | https://ica.id/ (hero) |
| About: intro, "Maximum uptime / Low lifetime cost / One partner", Design · Build · Install · Service texts, values, Jakarta sites | https://ica.id/about-us/ |
| Numbers: 1987, 18 service locations, 3,000+ projects, 60 MW+, 10K+ customers, 170+ models, ISO 9001 · 14001 · 45001 | https://ica.id/ ("ICA in numbers", hero strip) and /about-us/ |
| Who we power (01–04), Which UPS / On-grid · off-grid · hybrid, payback 6–10 years | https://ica.id/ (sections 01 and 08 FAQ) |
| 8 product families and their one-line descriptions | https://ica.id/ (section 02 "Our Products") |
| "N series · N models" per family; the every-series table | counted from https://ica.id/wp-json/wp/v2/produk (205 entries: 34 series, 171 models) |
| Series ranges | each series' `short_description` in the catalog; only number format changed (`15.000VA` → `15,000 VA`) |
| Solutions: UPS (hospitals, banks, manufacturing, transportation, data centers), Solar, Energy storage, Sheet metal | https://ica.id/kategori-solutions/ups-solution/, /solar-solution/, /energy-storage-solution/, /sheet-metal-fabrication/ and the home page section 06 |
| Projects: name, location, capacity, type, year | each project page under https://ica.id/projects/ ("Project details"); year printed only where the page gives one |
| Why ICA: TKDN ≥ 40% (stated once), three facts | https://ica.id/ (section 05) and /about-us/ |
| Contact block, WhatsApp | supplied in the brief; matches the ica.id footer |
| TP Series datasheet: description, key features, all 14 models' values | https://ica.id/produk/tp-series/ and each model's catalog entry (links in `datasheets/tp-series.json`) |

## Values worth checking at the source

Printed as the catalog has them — flagged here, not corrected:

- TP Series: SIN1000C to SIN6000C (1–6 kVA) all list the same 595 × 235 × 705 mm
  cabinet; SIN5000C and SIN6000C both 93 kg.
- TP Series: SIN103C31 (10 kVA three-phase, 107 kg) is lighter than SIN103C11
  (10 kVA single-phase, 125 kg), and SIN203C11 (20 kVA, 104 kg) is lighter than
  SIN103C11 (10 kVA, 125 kg).
- TP Series and SE Series carry the same description and the same four key
  features on ica.id.
- TP Series: no TKDN certificate found for this series, so the datasheet prints
  no TKDN tag. The site says ICA® UPS in general have at least 40% local content.
