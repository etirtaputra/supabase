/**
 * The priced Bill of Material — the 'BOM' sheet of the EPC workbooks, with
 * the rules the workbooks only followed by habit made into arithmetic:
 *
 *   material sell  = cost ÷ (1 − margin)          ONE place, every row
 *   material total = qty × material sell
 *   install total  = qty × install unit
 *   row total      = material total + install total;  per Wp = row total ÷ plant Wp
 *   totals         = Σ every row — there is no range to forget
 *
 * A row's quantity is either typed or LINKED to the calculation (e.g.
 * 'dc.cable.6' = metres of 6 mm² PV cable), with an optional factor and
 * addition for spares. Its cost can be linked the same way (costKey). A
 * link can only point at a value the calculation produced; an unknown key is
 * an error on the row, never a silent zero.
 *
 * What the checks catch were real money in the four workbooks (2026-10):
 * 1,159 m of cable tray with installation but no material price; a permit
 * row typed at Rp 250 m against its own Rp 28 m cost; subtotals that dropped
 * Rp 37–266 m of rows (docs/epc-bom/WORKBOOK_STUDY.md).
 */
import type { Check } from './dc.ts';

export interface BomRow {
  id: string;
  /** Category key — see the template (e.g. 'modules', 'ac_dc_cable'). */
  category: string;
  description: string;
  unit: string;
  qty: { mode: 'typed'; value: number | null } | { mode: 'link'; key: string; factor: number; add: number; roundUp: boolean };
  /** Material cost per unit, IDR. */
  cost: number | null;
  /**
   * Cost per unit READ from the calculation instead of typed (e.g.
   * 'rw.tray.costPerM', 'om.cleaning.perYear') — a copied figure goes stale
   * when the design changes, a linked one cannot. Absent / null = typed.
   */
  costKey?: string | null;
  /** Gross margin on the material price, fraction (0.11). Null = the project's default. */
  margin: number | null;
  /** Installation price per unit, IDR (sold as-is — the template prices labour without margin). */
  install: number | null;
  componentId: string | null;
  brand: string;
  remarks: string;
}

export interface BomCategory { key: string; label: string }

export interface PricedRow {
  id: string;
  category: string;
  qty: number;
  materialUnit: number;
  materialTotal: number;
  installTotal: number;
  total: number;
  perWp: number | null;
  margin: number;
  costTotal: number;
}

export interface BomTotals {
  material: number;
  install: number;
  total: number;
  cost: number;
  /** Blended gross margin over material + install. */
  grossMarginPct: number | null;
  ppn: number;
  totalInclPpn: number;
  perWp: number | null;
  perWpInclPpn: number | null;
  byCategory: Record<string, { material: number; install: number; total: number; perWp: number | null }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Resolve a row's quantity against the calculated values. */
export function rowQty(row: BomRow, values: Record<string, number>): { qty: number; error: string | null } {
  if (row.qty.mode === 'typed') return { qty: Math.max(0, row.qty.value ?? 0), error: null };
  const v = values[row.qty.key];
  if (v == null || !Number.isFinite(v)) return { qty: 0, error: `Linked to "${row.qty.key}", which this calculation does not produce.` };
  const raw = v * (row.qty.factor || 1) + (row.qty.add || 0);
  return { qty: Math.max(0, row.qty.roundUp ? Math.ceil(raw - 1e-9) : round2(raw)), error: null };
}

export function priceBom(rows: BomRow[], values: Record<string, number>, opts: { defaultMargin: number; plantWp: number; ppnPct: number }): { rows: PricedRow[]; totals: BomTotals; checks: Check[] } {
  const checks: Check[] = [];
  const priced: PricedRow[] = rows.map((r) => {
    const where = r.description || 'Row';
    const { qty, error } = rowQty(r, values);
    if (error) checks.push({ level: 'error', where, message: error });
    let linkedCost: number | null = null;
    if (r.costKey) {
      const v = values[r.costKey];
      if (v == null || !Number.isFinite(v)) checks.push({ level: 'error', where, message: `Cost linked to "${r.costKey}", which this calculation does not produce.` });
      else linkedCost = round2(v);
    }
    const margin = r.margin ?? opts.defaultMargin;
    if (!(margin < 1)) checks.push({ level: 'error', where, message: `Margin ${Math.round(margin * 100)} % is not possible — a margin must be below 100 %.` });
    const cost = Math.max(0, r.costKey ? linkedCost ?? 0 : r.cost ?? 0);
    const materialUnit = margin < 1 ? round2(cost / (1 - margin)) : 0;
    const install = Math.max(0, r.install ?? 0);
    const materialTotal = round2(qty * materialUnit);
    const installTotal = round2(qty * install);
    const total = round2(materialTotal + installTotal);
    if (qty > 0 && cost === 0 && install === 0) checks.push({ level: 'warn', tag: 'unpriced', where, message: `Not priced yet — ${qty} ${r.unit} that add nothing to the quote until they are.` });
    else if (qty > 0 && cost === 0 && install > 0) checks.push({ level: 'warn', where, message: `Installation is priced but the material is not. Supplied by the customer? Otherwise add the cost.` });
    if (qty === 0 && (cost > 0 || install > 0) && r.qty.mode === 'link') checks.push({ level: 'warn', where, message: `Priced, but its linked quantity is 0 — check the calculation it reads.` });
    return { id: r.id, category: r.category, qty, materialUnit, materialTotal, installTotal, total, perWp: opts.plantWp > 0 ? round2(total / opts.plantWp) : null, margin, costTotal: round2(qty * cost) };
  });

  const byCategory: BomTotals['byCategory'] = {};
  let material = 0, install = 0, cost = 0;
  for (const p of priced) {
    const c = (byCategory[p.category] ??= { material: 0, install: 0, total: 0, perWp: null });
    c.material = round2(c.material + p.materialTotal);
    c.install = round2(c.install + p.installTotal);
    c.total = round2(c.total + p.total);
    material += p.materialTotal; install += p.installTotal; cost += p.costTotal;
  }
  for (const c of Object.values(byCategory)) c.perWp = opts.plantWp > 0 ? round2(c.total / opts.plantWp) : null;
  const total = round2(material + install);
  const ppn = round2(total * opts.ppnPct / 100);
  const totals: BomTotals = {
    material: round2(material), install: round2(install), total, cost: round2(cost),
    // Installation is sold at cost in this template, so the margin is earned on material only.
    grossMarginPct: total > 0 ? round2((total - cost - install) / total * 100) : null,
    ppn, totalInclPpn: round2(total + ppn),
    perWp: opts.plantWp > 0 ? round2(total / opts.plantWp) : null,
    perWpInclPpn: opts.plantWp > 0 ? round2((total + ppn) / opts.plantWp) : null,
    byCategory,
  };
  return { rows: priced, totals, checks };
}
