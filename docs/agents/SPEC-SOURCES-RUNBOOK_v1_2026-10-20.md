# Spec sources — four places that state a product's numbers, and which one wins

> Part of the ICAPROC agent packs — `docs/agents/INDEX.md` names the current
> version. If this file is not the one the index names, it is stale.
>
> **v1 (2026-10-20), owner's rule:** *"We have updated the ICAPROC JSON tech
> spec, and the tech spec on ica.id and icasolar.com. We also have the
> DATASHEET ALL folder to triangulate from. Make sure MANDA has access to all
> these, so he gives the most accurate calculations."* The order of authority
> in §2 was proposed on 2026-10-20 and the owner agreed: *"yes, agree with
> that order."*

**Who:** MANDA, for every design and every spec question. Any other agent that
quotes a product's technical value to a person follows §2 and §4 too.

This runbook decides WHICH number is right. The solar design pack decides what
the engines DO with it. Nothing here changes an engine rule or a constant.

---

## 1. The four sources

| # | Source | What it is | How you read it |
|---|---|---|---|
| 1 | **Datasheet folder** — Google Drive `(DATASHEET ALL)`, folder id `1KGN2jbYlm8nVBYIgWiEdeVYysMDzQk9r` | the manufacturer's PDFs. 200+ files named `<Category>_<BRAND>-<model or series>_[lang]_<DS\|MN>[ _R<n>].pdf` — `DS` = datasheet, `MN` = manual, `R2` = revision 2. Subfolder `Archived` holds superseded files | the Drive service-account file in your container (reader access) |
| 2 | **ICAPROC tech specs** — `3.0_components.specifications` (JSON), edited on the Tech Specs page | the RECORD. The design endpoints (`/api/agent/design/system`, `/api/agent/design/mounting`) compute from these values and nothing else | your ICAPROC login; the endpoints |
| 3 | **icasolar.com** | the store website (WordPress, kept by staff). 114 products on 20 Oct | public: `GET https://icasolar.com/wp-json/wp/v2/products?per_page=100&page=N` — spec text in `meta.technical_specifications`, datasheet links in `meta._datasheet_amp_collateral` |
| 4 | **ica.id** | the corporate website (WordPress, kept by staff), fed by the central catalogue katalog.ica.id | public: `GET https://ica.id/wp-json/wp/v2/produk` (the site's firewall may answer 403 to a server — then use https://katalog.ica.id/ and say which one you read) |

## 2. The order of authority

```
1. DATASHEET  (manufacturer, latest revision, not Archived)   — the truth
2. ICAPROC    (3.0_components.specifications)                — what is computed
3. WEBSITES   (icasolar.com, ica.id / katalog.ica.id)         — checked, never trusted
```

- **The datasheet is the final word.** Of several files for one product, the
  newest revision wins (`R2` over `R1`, `REVISED` over plain); a `DS` beats an
  `MN` for a number they both state; nothing in `Archived` counts. A series
  datasheet covers several models — read the column or row for the EXACT model.
- **ICAPROC is what the calculation uses.** The engines read ICAPROC and only
  ICAPROC, so every number in a result can be traced. Never feed a datasheet
  or website value into a calculation in its place.
- **The websites are checked, never trusted.** Both are typed by staff
  separately from ICAPROC, so they are the first to drift. A website value is
  never a source for a calculation and never "confirms" anything on its own.

## 3. Before a calculation goes to a person

For every item the engine chose (panel, inverter, battery, charge controller),
compare the values the engine used with the item's datasheet:

| Item | Fields the engine reads |
|---|---|
| PV module | `power_stc_w`, `voc_stc_v`, `temp_coeff_voc_percent_per_c`, `dimensions_l_w_h_mm` |
| On-grid inverter | `rated_output_power_kw`, `nominal_ac_voltage_vac`, `pv_max_voltage_vdc`, `no_of_mppts`, `strings_per_mppt` |
| Hybrid inverter | `rated_output_power_w`, `battery_nominal_voltage_vdc`, `battery_voltage_range_vdc` |
| Battery | `battery_type`, `nominal_voltage_v`, `energy_wh`, `rated_capacity_ah` |

- **All agree:** give the result, and name the datasheet file you checked
  against.
- **ICAPROC ≠ datasheet:** give the result AND the mismatch, before anything
  else — the result was computed from a number the datasheet contradicts:

  ```
  ⚠ Spec mismatch — this result uses ICAPROC's value.
  SNV-SP4533 · pv_max_voltage_vdc · ICAPROC 800 · datasheet 1000
    (Inverter_ICASOLAR-SNV-SP-series-15~75kW-380V-3phase_R2_DS.pdf, p. 2)
  A person must correct ICAPROC (Tech Specs page), then run the design again.
  ```

  (Example layout only — not a real finding.)
- **No datasheet in the folder:** say so. The result stands on ICAPROC alone;
  do not use a website value as if it were a datasheet.
- **ICAPROC has no value** (the engine warns): say which field, and quote the
  datasheet value for a person to enter. Do not enter it yourself.

## 4. Website checks

When asked about a product, or when you read its datasheet anyway, compare the
website's value too. A website value that differs from the datasheet is a
finding for the staff who keep the site:

```
icasolar.com · <product> · <field> · site <value> · datasheet <value> (<file>)
```

Report it; never treat it as a reason to doubt the datasheet.

## 5. Never

- Never write a spec value into ICAPROC yourself — not from a datasheet, not
  from a website (solar design pack §1, §10). Show it; a person enters it.
- Never use a datasheet or website value in place of the ICAPROC value in a
  calculation.
- Never write to the datasheet folder or to either website.
- Never quote a supplier's model or a datasheet file name to a CUSTOMER — file
  names carry the supplier's model; they are for the team.
