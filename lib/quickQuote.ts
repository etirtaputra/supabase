/**
 * Residential quick quote — the engineer surveys, the quote comes out
 * (owner, 2026-11-22: "the engineering will survey, check, input variables
 * and a quote immediately comes out"). Rules agreed 2026-11-23:
 *
 *   SIZE from the PLN bill — monthly kWh (or bill ÷ the VA class's tariff,
 *   lib/energyEconomics PLN_TARIFFS) × the share to cover × 12 ÷ 1,440 kWh
 *   per kWp per year (the yield the proposal's savings page uses, so the two
 *   agree). Owner: "60% for on-grid… higher with a battery" — and "prefer one
 *   inverter installation, as more than one inverter system requires other
 *   permits… it's better to slightly downsize than too much": panels round
 *   DOWN, ONE inverter, never above the PLN connection, DC/AC at most 1.3.
 *
 *   TEMPLATE from the 13 residential proposals of Jul–Nov 2026: the sections
 *   and lines every one of them carries, with quantities that scale (cable
 *   from the survey's runs, crew days from kWp, NIDI + SLO by size band).
 *   Owner: concrete / flat roofs and sites outside Jabodetabek "need more
 *   time" — those lines are created WITHOUT a price and flagged for a person.
 *
 * Pure: no I/O. The screen (app/proposals/quick) supplies the catalogue and
 * the costs; every number here is a default the owner can change in
 * Settings › Quick quote (AppSettings.quickQuote).
 */

import { PLN_TARIFF_OPTIONS } from './energyEconomics.ts';

/** Rp/kWh of a household connection — the savings page's PLN tariff list. */
export function tariffForVa(va: number): number {
  const pick = (prefix: string) => PLN_TARIFF_OPTIONS.find((o) => o.label.startsWith(prefix))?.value ?? 1699.53;
  if (va <= 900) return pick('R-1/TR 900');
  if (va <= 2200) return pick('R-1/TR 1.300');
  if (va <= 5500) return pick('R-2/TR');
  return pick('R-3/TR');
}

// ── Settings (owner-editable) ────────────────────────────────────────────────

export interface PermitBand { upToKwp: number; cost: number }

export interface QuickQuoteSettings {
  /** Share of the monthly usage the array is sized to cover, %. */
  sharePctOnGrid: number;
  sharePctHybrid: number;
  /** kWh per kWp per year — the savings page's specific production. */
  yieldKwhPerKwpYear: number;
  /** Most DC per AC kW one inverter carries. */
  dcAcMax: number;
  /** Battery depth of discharge (lithium) — the design engine's 0.8. */
  batteryDod: number;
  /** Margin on every line: sell = cost ÷ (1 − margin). */
  marginPct: number;
  /** Panels per string, by the inverter's phase (≈ 600 V vs 1,000 V inputs). */
  panelsPerString1p: number;
  panelsPerString3p: number;
  /** NIDI + SLO by array size; above the last band = the last band's cost. */
  permitBands: PermitBand[];
  /** Fixed costs (Rp) for lines without a catalogue item. */
  cost: {
    mountingMetalPerWp: number; mountingTilePerWp: number;
    dcCablePerM: number; earthCablePerM: number; mc4Set: number; conduitPerM: number;
    acCable1pPerM: number; acCable3pSmallPerM: number; acCable3pLargePerM: number; cableDuctPerM: number;
    panelBox: number; mcb1p: number; mcb3p: number; acSpd2p: number; acSpd4p: number; dcFuseSpdSet: number;
    batteryMccb: number; electricalInstrument: number;
    batteryJumper: number; batteryBox: number;
    survey: number; design: number; commissioning: number;
    technicianDay: number; installerDay: number; foodDay: number; localTransport: number;
    mobilisation: number; scaffolding: number; equipmentTransport: number;
  };
}

export const QUICK_QUOTE_DEFAULTS: QuickQuoteSettings = {
  sharePctOnGrid: 60,
  sharePctHybrid: 80,
  yieldKwhPerKwpYear: 1440,
  dcAcMax: 1.3,
  batteryDod: 0.8,
  marginPct: 30,
  panelsPerString1p: 12,
  panelsPerString3p: 18,
  // From the November quotes: 6.2 kWp → 15 M, 14.3 → 20 M, 24.8 → 30 M.
  permitBands: [{ upToKwp: 6.5, cost: 15_000_000 }, { upToKwp: 15, cost: 20_000_000 }, { upToKwp: 25, cost: 30_000_000 }],
  // The November Jakarta-area quotes (Q-20261116-O3X6-REV, Q-20261119-5Y9I, Q-20261111-1420).
  cost: {
    mountingMetalPerWp: 400, mountingTilePerWp: 1_100,
    dcCablePerM: 16_000, earthCablePerM: 21_000, mc4Set: 15_000, conduitPerM: 100_000,
    acCable1pPerM: 85_000, acCable3pSmallPerM: 90_000, acCable3pLargePerM: 160_000, cableDuctPerM: 85_000,
    panelBox: 2_000_000, mcb1p: 165_000, mcb3p: 400_000, acSpd2p: 80_000, acSpd4p: 160_000, dcFuseSpdSet: 215_000,
    batteryMccb: 680_000, electricalInstrument: 1_500_000,
    batteryJumper: 75_000, batteryBox: 5_500_000,
    survey: 500_000, design: 750_000, commissioning: 2_000_000,
    technicianDay: 400_000, installerDay: 350_000, foodDay: 80_000, localTransport: 2_000_000,
    mobilisation: 500_000, scaffolding: 1_000_000, equipmentTransport: 2_000_000,
  },
};

const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

/** Settings as stored (any shape) → complete, sane settings. */
export function coerceQuickQuote(raw: unknown): QuickQuoteSettings {
  const d = QUICK_QUOTE_DEFAULTS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const c = (r.cost && typeof r.cost === 'object' ? r.cost : {}) as Record<string, unknown>;
  const bands = Array.isArray(r.permitBands)
    ? (r.permitBands as unknown[]).map((b) => b as Record<string, unknown>)
        .filter((b) => num(b?.upToKwp, NaN) > 0 && num(b?.cost, NaN) >= 0)
        .map((b) => ({ upToKwp: Number(b.upToKwp), cost: Number(b.cost) }))
        .sort((a, b) => a.upToKwp - b.upToKwp)
    : [];
  const pct = (v: unknown, fb: number) => Math.min(100, Math.max(1, num(v, fb)));
  return {
    sharePctOnGrid: pct(r.sharePctOnGrid, d.sharePctOnGrid),
    sharePctHybrid: pct(r.sharePctHybrid, d.sharePctHybrid),
    yieldKwhPerKwpYear: Math.max(500, num(r.yieldKwhPerKwpYear, d.yieldKwhPerKwpYear)),
    dcAcMax: Math.min(2, Math.max(1, num(r.dcAcMax, d.dcAcMax))),
    batteryDod: Math.min(1, Math.max(0.3, num(r.batteryDod, d.batteryDod))),
    marginPct: Math.min(90, Math.max(0, num(r.marginPct, d.marginPct))),
    panelsPerString1p: Math.max(2, Math.round(num(r.panelsPerString1p, d.panelsPerString1p))),
    panelsPerString3p: Math.max(2, Math.round(num(r.panelsPerString3p, d.panelsPerString3p))),
    permitBands: bands.length ? bands : d.permitBands,
    cost: Object.fromEntries(Object.entries(d.cost).map(([k, v]) => [k, Math.max(0, num(c[k], v))])) as QuickQuoteSettings['cost'],
  };
}

// ── The survey ───────────────────────────────────────────────────────────────

export type QqSystem = 'on_grid' | 'hybrid';
export type QqRoof = 'metal' | 'tile' | 'concrete' | 'flat';

export interface QqSurvey {
  customerName: string;
  location: string;
  /** Inside Jabodetabek: the house transport and labour rates apply. */
  jabodetabek: boolean;
  system: QqSystem;
  plnVa: number;
  plnPhase: 1 | 3;
  /** Rp per month — or kWh per month, which wins when both are given. */
  billRp: number | null;
  kwhMonth: number | null;
  /** Rp/kWh for the VA class (lib/energyEconomics PLN_TARIFFS). */
  tariff: number;
  /** null = the settings' default for the system type. */
  sharePct: number | null;
  /** Hybrid: what must keep running in an outage, and for how long. */
  backupKw: number;
  backupHours: number;
  roof: QqRoof;
  storeys: number;
  /** How many panels fit on the usable roof; null = not limited. */
  maxPanels: number | null;
  /** Metres, one way: array → inverter, inverter → PLN panel. */
  dcRunM: number;
  acRunM: number;
}

// ── The catalogue, as the sizing sees it ────────────────────────────────────

export interface QqPanel { componentId: string; name: string; brand: string; wp: number }
export interface QqInverter { componentId: string; name: string; brand: string; kw: number; phase: 1 | 3; kind: QqSystem; cost: number | null }
export interface QqBattery { componentId: string; name: string; brand: string; kwh: number }

/** Rated kW and phase from a catalogue item's specifications (both inverter families). */
export function inverterSpec(specs: Record<string, unknown> | null | undefined): { kw: number; phase: 1 | 3 } | null {
  if (!specs) return null;
  const kw = Number(specs.rated_output_power_kw) || (Number(specs.rated_output_power_w) || 0) / 1000;
  if (!(kw > 0)) return null;
  const text = `${specs.phase ?? ''} ${specs.nominal_ac_voltage_vac ?? ''} ${specs.nominal_output_voltage_vac ?? ''}`.toLowerCase();
  const phase: 1 | 3 = /3-phase|3l|400|380/.test(text) ? 3 : 1;
  return { kw, phase };
}

/** kWh of a battery: nominal V × rated Ah ÷ 1000. */
export function batteryKwh(specs: Record<string, unknown> | null | undefined): number | null {
  const v = Number(specs?.nominal_voltage_v ?? specs?.battery_nominal_voltage_vdc);
  const ah = Number(specs?.rated_capacity_ah);
  return v > 0 && ah > 0 ? (v * ah) / 1000 : null;
}

// ── Sizing ───────────────────────────────────────────────────────────────────

export interface QqNote { text: string; vars?: Record<string, string | number> }

export interface QqSize {
  monthlyKwh: number;
  sharePct: number;
  targetKwp: number;
  panel: QqPanel;
  panels: number;
  kwp: number;
  inverter: QqInverter | null;
  strings: number;
  battery: QqBattery | null;
  batteries: number;
  kwh: number;
  notes: QqNote[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The size: panels (rounded DOWN), ONE inverter (the smallest that carries the
 * array at the DC/AC limit, the backup load with 25 % headroom, and fits the
 * PLN connection), and for a hybrid the battery modules the backup needs.
 */
export function sizeSystem(s: QqSurvey, cat: { panel: QqPanel; inverters: QqInverter[]; battery: QqBattery | null }, cfg: QuickQuoteSettings): QqSize {
  const notes: QqNote[] = [];
  const monthlyKwh = s.kwhMonth && s.kwhMonth > 0 ? s.kwhMonth : (s.billRp && s.tariff > 0 ? s.billRp / s.tariff : 0);
  const sharePct = s.sharePct ?? (s.system === 'hybrid' ? cfg.sharePctHybrid : cfg.sharePctOnGrid);
  const targetKwp = (monthlyKwh * (sharePct / 100) * 12) / cfg.yieldKwhPerKwpYear;
  const wp = cat.panel.wp;

  let panels = Math.floor((targetKwp * 1000) / wp);
  if (s.maxPanels != null && panels > s.maxPanels) {
    panels = s.maxPanels;
    notes.push({ text: 'Capped by the roof: {n} panels fit.', vars: { n: s.maxPanels } });
  }

  // One inverter, on the PLN phase, never above the connection.
  const plnKw = s.plnVa / 1000;
  const fits = cat.inverters
    .filter((i) => i.kind === s.system && i.phase === s.plnPhase && i.kw <= plnKw + 1e-9)
    .sort((a, b) => a.kw - b.kw || (a.cost ?? Infinity) - (b.cost ?? Infinity));
  const needKw = Math.max((panels * wp) / 1000 / cfg.dcAcMax, s.system === 'hybrid' ? s.backupKw * 1.25 : 0);
  let inverter = fits.find((i) => i.kw + 1e-9 >= needKw) ?? null;
  if (!inverter && fits.length) {
    inverter = fits[fits.length - 1];
    notes.push({ text: 'One inverter only: sized down to the largest that fits the PLN connection ({kw} kW).', vars: { kw: inverter.kw } });
  }
  if (inverter) {
    const maxPanels = Math.floor((inverter.kw * cfg.dcAcMax * 1000) / wp);
    if (panels > maxPanels) panels = maxPanels;
  } else {
    notes.push({ text: 'No {phase}-phase inverter up to {kw} kW in the catalogue — pick one by hand.', vars: { phase: s.plnPhase, kw: round1(plnKw) } });
  }
  if (panels < 1 && monthlyKwh > 0) notes.push({ text: 'The usage is too small for even one panel at this share.' });
  panels = Math.max(0, panels);
  const kwp = (panels * wp) / 1000;

  const perString = (inverter?.phase ?? s.plnPhase) === 3 ? cfg.panelsPerString3p : cfg.panelsPerString1p;
  const strings = panels ? Math.ceil(panels / perString) : 0;
  if (strings > 0) notes.push({ text: '{n} string(s) estimated at {p} panels each — check against the datasheet.', vars: { n: strings, p: perString } });

  let battery: QqBattery | null = null;
  let batteries = 0;
  if (s.system === 'hybrid') {
    battery = cat.battery;
    if (!battery) notes.push({ text: 'No battery in the catalogue — pick one by hand.' });
    else if (s.backupKw > 0 && s.backupHours > 0) {
      batteries = Math.ceil((s.backupKw * s.backupHours) / cfg.batteryDod / battery.kwh - 1e-9);
    } else {
      notes.push({ text: 'No backup load given: no battery sized.' });
    }
  }
  const kwh = battery ? round1(batteries * battery.kwh) : 0;
  return { monthlyKwh, sharePct, targetKwp, panel: cat.panel, panels, kwp, inverter, strings, battery, batteries, kwh, notes };
}

// ── The template ─────────────────────────────────────────────────────────────

export type QqGroup = 'solar_panels' | 'bos' | 'services';

export interface QqLine {
  description: string;
  brand?: string;
  qty: number;
  unit: string;
  /** A catalogue item: its cost comes from the cost base (Std Cost). */
  componentId?: string;
  /** Catalogue item to look up by these words (all must appear), else `cost`. */
  match?: string[];
  /** Rp per unit when no catalogue item answers. */
  cost: number | null;
  /** Needs a person before the quote goes out (flagged, no price). */
  needsPricing?: string;
}
export interface QqSection { title: string; group: QqGroup; lines: QqLine[] }

const MCB_STEPS = [16, 20, 25, 32, 40, 50, 63, 80, 100];

/** NIDI + SLO for an array of this size. */
export const permitCost = (kwp: number, bands: PermitBand[]): number =>
  (bands.find((b) => kwp <= b.upToKwp + 1e-9) ?? bands[bands.length - 1]).cost;

/** Crew days: the larger of 3 and kWp ÷ 3 (rounded), one more with a battery. */
export const crewDays = (kwp: number, battery: boolean): number => Math.max(3, Math.round(kwp / 3)) + (battery ? 1 : 0);

/** The proposal's sections and lines for a sized system. Quantities only scale; prices are the screen's. */
export function buildTemplate(s: QqSurvey, z: QqSize, cfg: QuickQuoteSettings): QqSection[] {
  const c = cfg.cost;
  const three = (z.inverter?.phase ?? s.plnPhase) === 3;
  const hybrid = s.system === 'hybrid' && z.batteries > 0;
  const far = !s.jabodetabek;
  const sections: QqSection[] = [];
  const sec = (title: string, group: QqGroup, lines: QqLine[]) => { if (lines.length) sections.push({ title, group, lines }); };

  sec('Solar panels', 'solar_panels', [
    { description: z.panel.name, brand: z.panel.brand, qty: z.panels, unit: 'unit', componentId: z.panel.componentId, cost: null },
  ]);
  sec('Inverters', 'bos', z.inverter ? [
    { description: z.inverter.name, brand: z.inverter.brand, qty: 1, unit: 'unit', componentId: z.inverter.componentId, cost: null },
  ] : [{ description: 'Inverter', qty: 1, unit: 'unit', cost: null, needsPricing: 'Pick the inverter: none in the catalogue fits the PLN connection.' }]);

  const wp = z.panels * z.panel.wp;
  const mounting: QqLine = s.roof === 'metal'
    ? { description: 'Aluminium L-Feet Metal Roof Kit - c/w clamps, clips, grounding kits', qty: wp, unit: 'Wp', cost: c.mountingMetalPerWp }
    : s.roof === 'tile'
      ? { description: 'Aluminium Rail With Tile Roof Hook, Grounding', qty: wp, unit: 'Wp', cost: c.mountingTilePerWp }
      : { description: 'Triangle Mounting Kit with Cement Pedestal', qty: wp, unit: 'Wp', cost: null,
          needsPricing: s.roof === 'concrete'
            ? 'Concrete roof: price the triangle kit and cement pedestals by hand.'
            : 'Flat roof: price the triangle kit and cement pedestals by hand.' };
  sec('Array mounting kits', 'bos', [mounting]);

  const dcM = Math.ceil(2 * z.strings * s.dcRunM * 1.1);
  sec('DC cables, conduits and terminators', 'bos', z.strings ? [
    { description: 'Kabel H1Z2Z2-K 1 x 6mm', qty: dcM, unit: 'meter', match: ['h1z2z2', '1x6mm'], cost: c.dcCablePerM },
    { description: 'Kabel NYA 6 mm²', qty: Math.ceil(s.dcRunM + 10), unit: 'meter', match: ['nya', '6mm'], cost: c.earthCablePerM },
    { description: 'MC4 Connector 6mm² 1500V', qty: z.strings, unit: 'set', match: ['mc4'], cost: c.mc4Set },
    { description: 'Cable conduit and accessories', qty: Math.ceil(s.dcRunM), unit: 'meter', cost: c.conduitPerM },
  ] : []);

  const acKw = z.inverter?.kw ?? 0;
  const acLarge = three && acKw > 15;
  sec('AC cables, conduits and terminators', 'bos', [
    three
      ? { description: acLarge ? 'Kabel NYY 4 x 10 mm²' : 'Kabel NYY 4 x 6 mm²', qty: Math.ceil(s.acRunM), unit: 'meter', match: ['nyy', acLarge ? '4x10mm' : '4x6mm'], cost: acLarge ? c.acCable3pLargePerM : c.acCable3pSmallPerM }
      : { description: 'Kabel NYY 3 x 4 mm²', qty: Math.ceil(s.acRunM), unit: 'meter', match: ['nyy', '3x4mm'], cost: c.acCable1pPerM },
    { description: 'Kabel NYA 6 mm²', qty: Math.ceil(s.acRunM), unit: 'meter', match: ['nya', '6mm'], cost: c.earthCablePerM },
    { description: 'Cable Duct and Accessories, PVC', qty: Math.ceil(s.acRunM), unit: 'meter', cost: c.cableDuctPerM },
  ]);

  // The AC breaker: the next standard rating ≥ 1.25 × the inverter's current.
  const amps = acKw ? (acKw * 1000) / (three ? 400 * Math.sqrt(3) : 230) : 0;
  const rating = MCB_STEPS.find((a) => a >= amps * 1.25) ?? MCB_STEPS[MCB_STEPS.length - 1];
  sec('AC switchgears and protection devices', 'bos', [
    { description: 'DC-AC Panel Wallmount Indoor Type', qty: 1, unit: 'unit', cost: c.panelBox },
    { description: `AC MCB ${three ? '3P' : '1P'} ${rating}A`, qty: 1, unit: 'pcs', cost: three ? c.mcb3p : c.mcb1p },
    { description: `AC SPD ${three ? '4P' : '2P'} 20-40kA T2`, qty: 1, unit: 'unit', match: ['ac spd', three ? '4p' : '2p'], cost: three ? c.acSpd4p : c.acSpd2p },
    ...(z.strings ? [{ description: 'DC PV Fuse dan DC SPD 2P', qty: z.strings, unit: 'set', cost: c.dcFuseSpdSet }] : []),
    ...(hybrid ? [{ description: 'DC MCCB 2P (Battery)', qty: 1, unit: 'unit', match: ['dc mccb'], cost: c.batteryMccb }] : []),
    { description: 'Electrical Instrument', qty: 1, unit: 'ls', cost: c.electricalInstrument },
  ]);

  if (hybrid && z.battery) {
    sec('Battery Energy Storage Systems (BESS)', 'bos', [
      { description: z.battery.name, brand: z.battery.brand, qty: z.batteries, unit: 'unit', componentId: z.battery.componentId, cost: null },
      { description: 'Cable Jumper Battery', qty: z.batteries + 1, unit: 'pcs', cost: c.batteryJumper },
      { description: 'Box battery Lithium', qty: Math.ceil(z.batteries / 4), unit: 'unit', cost: c.batteryBox },
    ]);
  }

  sec('Design, engineering and test commissioning', 'services', [
    { description: 'Detailed site survey', qty: 1, unit: 'eng days', cost: c.survey },
    { description: 'Detailed engineering design (Electrical)', qty: 1, unit: 'eng days', cost: c.design },
    { description: 'Final inspection, testing and commissioning', qty: 1, unit: 'eng days', cost: c.commissioning },
  ]);

  const d = crewDays(z.kwp, hybrid);
  sec('Installation', 'services', [
    { description: 'Technician (1 person)', qty: d, unit: 'man days', cost: c.technicianDay },
    { description: 'Installers (3 person)', qty: 3 * d, unit: 'man days', cost: c.installerDay },
    { description: 'Food and accomodation', qty: 4 * d, unit: 'man days', cost: c.foodDay },
    { description: 'Local transport', qty: 1, unit: 'ls', cost: c.localTransport },
    ...(far ? [{ description: 'Transport and accommodation (outside Jabodetabek)', qty: 1, unit: 'ls', cost: null,
      needsPricing: 'Outside Jabodetabek: price the team’s travel and accommodation by hand.' }] : []),
  ]);

  sec('Logistics and misc.', 'services', [
    { description: 'Mobilization and demobilization', qty: 1, unit: 'ls', cost: c.mobilisation },
    ...(s.storeys >= 2 ? [{ description: 'Scaffolding', qty: 1, unit: 'ls', cost: c.scaffolding }] : []),
    far
      ? { description: 'Equipment transport (Jakarta - site)', qty: 1, unit: 'ls', cost: null, needsPricing: 'Outside Jabodetabek: price the equipment transport by hand.' }
      : { description: 'Equipment transport (Jakarta - site)', qty: 1, unit: 'ls', cost: c.equipmentTransport },
  ]);

  sec('Perizinan', 'services', [
    { description: 'Biaya NIDI dan SLO', qty: 1, unit: 'ls', cost: permitCost(z.kwp, cfg.permitBands) },
  ]);
  return sections;
}

/**
 * Does a catalogue name carry every one of these words — as WHOLE words?
 * "6mm" must not find "16 mm²", "nya" must not find "NYAF". Sizes are
 * written many ways ("6 mm", "6mm", "3 x 4", "3x4"), so both sides are
 * normalised first.
 */
export function matchesWords(name: string, words: string[]): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/(\d)\s*x\s*(\d)/g, '$1x$2').replace(/(\d)\s*mm/g, '$1mm');
  const n = norm(name);
  return words.every((w) => new RegExp(`(^|[^a-z0-9])${norm(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(n));
}

/** Sell price at the quick quote's margin, rounded to the rupiah. */
export const sellAt = (cost: number, marginPct: number): number => Math.round(cost / (1 - marginPct / 100));

/** "EPC for PV Hybrid 6,3 kWp DC / 5 kW AC / 9,6 kWh BESS, at …" — the house description. */
export function projectDescription(s: QqSurvey, z: QqSize): string {
  const id = (n: number) => String(round1(n)).replace('.', ',');
  const ac = z.inverter ? `${id(z.inverter.kw)} kW AC` : '';
  const parts = [`${id(z.kwp)} kWp DC`, ac, s.system === 'hybrid' && z.kwh ? `${id(z.kwh)} kWh BESS` : ''].filter(Boolean);
  return `EPC for PV ${s.system === 'hybrid' ? 'Hybrid' : 'On-Grid'} ${parts.join(' / ')}${s.location ? `, at ${s.location}` : ''}`;
}
