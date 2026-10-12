/**
 * The STANDARD BOM layout — 11 numbered categories, material and
 * installation priced in separate columns. Neutral by design: nothing on screen
 * or in an export names a customer (owner, 2026-10-12). The row list was taken
 * from the engineers' newest rooftop workbook (2026-10), minus its empty
 * per-model variants;
 * quantities the calculator knows are linked, the rest start typed.
 *
 * Prices are NOT seeded: they move every month ("Update okt 2026" on half the
 * rows) and belong to the catalogue and the engineer, not to code.
 */
import type { BomCategory, BomRow } from './bom.ts';

export const STANDARD_CATEGORIES: BomCategory[] = [
  { key: 'modules', label: '1. Modules' },
  { key: 'inverters', label: '2. Inverters' },
  { key: 'mounting', label: '3. Mounting system' },
  { key: 'ac_dc_cable', label: '4. AC and DC Cable' },
  { key: 'switchgear', label: '5. AC Switchgear' },
  { key: 'grounding', label: '6. Grounding System' },
  { key: 'raceway', label: '7. Cable Raceway' },
  { key: 'monitoring', label: '8. Monitoring System' },
  { key: 'om', label: '9. Operation & Maintenance' },
  { key: 'project', label: '10. Project Works' },
  { key: 'misc', label: '11. Miscellaneous Items' },
];

let seq = 0;
const id = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export const typedRow = (category: string, description: string, unit: string, value: number | null = null): BomRow => ({
  id: id(), category, description, unit, qty: { mode: 'typed', value },
  cost: null, margin: null, install: null, componentId: null, brand: '', remarks: '',
});
export const linkedRow = (category: string, description: string, unit: string, key: string, factor = 1, add = 0, roundUp = false): BomRow => ({
  id: id(), category, description, unit, qty: { mode: 'link', key, factor, add, roundUp },
  cost: null, margin: null, install: null, componentId: null, brand: '', remarks: '',
});

/** A fresh standard-layout row list, linked to the default AC segments ('inv', 'feeder', 'mv'). */
export function standardRows(): BomRow[] {
  return [
    linkedRow('modules', 'Solar Photovoltaic (PV) Module', 'pcs', 'pv.modules'),
    linkedRow('inverters', 'Inverter', 'sets', 'inv.count'),
    linkedRow('mounting', 'PV Mounting (including rail, ground lugs, clamps and accessories)', 'Wp', 'pv.wp'),

    linkedRow('ac_dc_cable', 'Solar cable 6 mm²', 'm', 'dc.cable.6'),
    linkedRow('ac_dc_cable', 'Solar cable 4 mm²', 'm', 'dc.cable.4'),
    linkedRow('ac_dc_cable', 'PV connector and accessories 6 mm', 'pairs', 'dc.connectors.6'),
    linkedRow('ac_dc_cable', 'PV connector and accessories 4 mm', 'pairs', 'dc.connectors.4'),
    linkedRow('ac_dc_cable', 'PV inline fuse', 'pcs', 'pv.strings'),
    linkedRow('ac_dc_cable', 'AC cable inverter to AC combiner', 'm', 'ac.seg.inv.phase'),
    linkedRow('ac_dc_cable', 'AC cable AC combiner to interconnection', 'm', 'ac.seg.feeder.phase'),
    linkedRow('ac_dc_cable', 'AC cable MV transformer to cubicle to interconnection', 'm', 'ac.seg.mv.phase'),
    typedRow('ac_dc_cable', 'Other AC cables and accessories (cable lugs, insulation)', 'lot', 1),

    typedRow('switchgear', 'AC Combiner Panel', 'sets', 1),
    typedRow('switchgear', 'Solar Service Breaker panel', 'sets', 1),
    typedRow('switchgear', 'Panel MVMDP 20 kV', 'sets'),
    typedRow('switchgear', 'Transformer step-up 0.8 kV – 20 kV', 'sets'),
    typedRow('switchgear', 'Termination at interconnection point and modification', 'sets'),
    typedRow('switchgear', 'Zero export', 'sets'),
    linkedRow('switchgear', 'Inverter station (support, canopy, civil)', 'sets', 'inv.count'),

    linkedRow('grounding', 'Grounding cable inverter to AC combiner', 'm', 'ac.seg.inv.pe'),
    linkedRow('grounding', 'Grounding cable AC combiner to grounding rod', 'm', 'ac.seg.feeder.pe'),
    typedRow('grounding', 'Grounding cable (PV) NYA 1×6 mm²', 'm'),
    typedRow('grounding', 'Grounding cable (PV) NYA 1×35 mm²', 'm'),
    typedRow('grounding', 'Accessories grounding cable, grounding test box', 'overall', 1),
    typedRow('grounding', 'Grounding pit, rod and accessories', 'set'),

    linkedRow('raceway', 'HDG cable tray, cover, clamp, support and accessories', 'm', 'rw.tray.m'),
    linkedRow('raceway', 'Flexible metal conduit, with accessories', 'm', 'rw.conduit'),
    typedRow('raceway', 'Weatherproof sealant for cable conduits', 'overall', 1),
    typedRow('raceway', 'Sealant for electrical panel', 'overall', 1),
    linkedRow('raceway', 'UV rated weatherproof labelling of all equipment', 'pcs', 'rw.labels'),
    linkedRow('raceway', 'UV rated cable ties (outdoor type)', 'pcs', 'rw.ties'),
    linkedRow('raceway', 'Solar cable hangers (clips)', 'pcs', 'rw.clips'),
    linkedRow('raceway', 'Cable gland (metal)', 'pcs', 'rw.glands'),

    typedRow('monitoring', 'RS485 cable for inverters and energy meter', 'm'),
    typedRow('monitoring', 'RS485 cable (2 pairs) for weather station', 'm'),
    typedRow('monitoring', 'Irradiance sensor (POA) and module temperature sensor', 'set'),
    typedRow('monitoring', 'Pyranometer and mounting', 'set'),
    typedRow('monitoring', 'Data logger', 'set', 1),
    typedRow('monitoring', 'Monitoring box (SPD, UPS, router, power supply)', 'set', 1),
    typedRow('monitoring', 'CCTV, NVR and accessories', 'set'),
    typedRow('monitoring', 'Internet installation with router (1 year)', 'set'),

    typedRow('om', 'Steel walkway, and accessories', 'meter'),
    typedRow('om', 'Stainless permanent safety line, and accessories', 'meter'),
    typedRow('om', 'Water cleaning system (pipe, taps, pump, water tank)', 'meter'),
    typedRow('om', 'Fire extinguisher CO2 5 kg', 'overall'),
    typedRow('om', 'Access ladder', 'set'),
    typedRow('om', 'Preventive and corrective maintenance', 'year'),
    typedRow('om', 'Periodic inspection AC combiner box (K3L)', 'year'),
    typedRow('om', 'Monthly report including performance analysis', 'year'),

    typedRow('project', 'Site survey', 'overall', 1),
    typedRow('project', 'HSE, safety signs, safety equipment, temporary walkway', 'overall', 1),
    typedRow('project', 'Temporary warehouse', 'overall', 1),
    typedRow('project', 'Temporary site office', 'overall', 1),
    typedRow('project', 'Scaffolding', 'overall', 1),
    typedRow('project', 'Heavy machinery', 'overall', 1),
    typedRow('project', 'Civil works, if required', 'overall'),
    typedRow('project', 'Site management, supervision and reporting', 'overall', 1),
    typedRow('project', 'Liaisoning with authorities', 'overall', 1),
    typedRow('project', 'Complete PV module cleaning after installation', 'overall', 1),
    typedRow('project', 'Construction All Risk (CAR) insurance incl. third-party liability', 'overall', 1),
    typedRow('project', 'Overall engineering design', 'overall', 1),
    typedRow('project', 'Overall commissioning', 'overall', 1),

    typedRow('misc', 'Equipment transport', 'overall', 1),
    typedRow('misc', 'Mobilisation and demobilisation', 'overall', 1),
    typedRow('misc', 'NIDI, SLO and permits', 'overall', 1),
  ];
}
