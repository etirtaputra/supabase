import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { designContext, resolveAndPrice, designNotes } from '@/lib/agentDesign';
import { calculateSystem, SYSTEM_ENGINE_VERSION, type SystemInput, type PanelSpec, type OnGridInverterSpec,
         type HybridInverterSpec, type BatterySpec } from '@/lib/systemDesign/system';
import { specNumber, specRangeMax } from '@/lib/specSchema';
import { isOfferable } from '@/lib/itemVisibility';

/**
 * POST /api/agent/design/system — the v7 whole-system calculator, for agents.
 *
 * Sizes the inverter, the battery bank and the array, then the structure and
 * balance of system, and resolves the lot against the catalogue at the
 * customer's tier. Same engine as the Design System screen.
 *
 * Body: { systemType: 'on-grid'|'off-grid'|'hybrid',
 *         panelComponentId,                       ← chosen from the catalogue
 *         gridVA?, gridPhase?, dcAcRatio?,        ← on-grid
 *         loads?: [{name, watts, hoursPerDay, qty, inductive}],
 *         autonomyDays?, pshHours?, batteryPreference?,   ← off-grid / hybrid
 *         demandFactor?,                          ← default 1.0 (all at once)
 *         powerLossFactorFs?,                     ← the site's own Fs, if stated
 *         pshSource?: 'measured'|'pvsyst'|'estimate',
 *         cableRunPerStringM?,                    ← default 6 m per panel
 *         minCellTempC?,                          ← default 18 (lowland)
 *         rows?, railLengthMm?, panelSpacingMm?, mountType?, orientation?,
 *         customerId? }
 *
 * The candidate pool is the catalogue itself, filtered to items that are
 * OFFERABLE and design-ready — an agent cannot smuggle in a made-up inverter.
 */
export const dynamic = 'force-dynamic';

const num = (v: unknown): number | null => specNumber(v);

export async function POST(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const body = await request.json() as Record<string, unknown>;

    const systemType = String(body.systemType ?? '') as SystemInput['systemType'];
    if (!['on-grid', 'off-grid', 'hybrid'].includes(systemType)) {
      return NextResponse.json({ error: "systemType must be 'on-grid', 'off-grid' or 'hybrid'" }, { status: 400 });
    }
    const panelId = String(body.panelComponentId ?? '');
    if (!panelId) return NextResponse.json({ error: 'panelComponentId is required — pick a real module from the catalogue' }, { status: 400 });

    const ctx = await designContext(client, { customerId: body.customerId as string | null });
    const offerable = ctx.candidates.filter(isOfferable);
    const byId = new Map(offerable.map((c) => [c.component_id, c]));

    const panelRow = byId.get(panelId);
    if (!panelRow) return NextResponse.json({ error: `No offerable catalogue item ${panelId}` }, { status: 404 });
    const ps = (panelRow.specifications ?? {}) as Record<string, unknown>;
    const panel: PanelSpec = {
      component_id: panelRow.component_id,
      model: (panelRow.internal_description ?? '').trim() || panelRow.supplier_model,
      power_stc_w: num(ps.power_stc_w) ?? 0,
      voc_stc_v: num(ps.voc_stc_v) ?? 0,
      temp_coeff_voc_percent_per_c: num(ps.temp_coeff_voc_percent_per_c),
      dimensions_l_w_h_mm: String(ps.dimensions_l_w_h_mm ?? ''),
    };
    if (!panel.power_stc_w || !panel.voc_stc_v) {
      return NextResponse.json({
        error: `${panel.model} is missing power_stc_w or voc_stc_v in Tech Specs, so nothing can be sized from it.`,
      }, { status: 422 });
    }

    const inCat = (cat: string) => offerable.filter((c) => c.category === cat);
    const spec = (c: typeof offerable[number]) => (c.specifications ?? {}) as Record<string, unknown>;
    const nameOf = (c: typeof offerable[number]) => (c.internal_description ?? '').trim() || c.supplier_model;

    const onGridInverters: OnGridInverterSpec[] = inCat('on_grid_inverter').map((c) => ({
      component_id: c.component_id, model: nameOf(c),
      rated_output_power_kw: num(spec(c).rated_output_power_kw) ?? 0,
      nominal_ac_voltage_vac: String(spec(c).nominal_ac_voltage_vac ?? ''),
      pv_max_voltage_vdc: num(spec(c).pv_max_voltage_vdc),
      no_of_mppts: num(spec(c).no_of_mppts),
      strings_per_mppt: num(spec(c).strings_per_mppt),
    })).filter((i) => i.rated_output_power_kw > 0);

    const hybridInverters: HybridInverterSpec[] = inCat('inverter_charger').map((c) => ({
      component_id: c.component_id, model: nameOf(c),
      rated_output_power_w: num(spec(c).rated_output_power_w) ?? 0,
      battery_nominal_voltage_vdc: num(spec(c).battery_nominal_voltage_vdc),
      // "500~900" → 900. The bank's real terminal voltage is checked against
      // this; absent, the engine says 'unknown' rather than assuming it fits.
      max_battery_voltage_vdc: specRangeMax(spec(c).battery_voltage_range_vdc),
      surge_power_va: num(spec(c).surge_power_va),
      pv_max_open_circuit_voltage_vdc: num(spec(c).pv_max_open_circuit_voltage_vdc),
      no_of_mpp_trackers: num(spec(c).no_of_mpp_trackers),
      phase: String(spec(c).phase ?? ''),
    })).filter((i) => i.rated_output_power_w > 0);

    const batteries: BatterySpec[] = inCat('batteries').map((c) => ({
      component_id: c.component_id, model: nameOf(c),
      battery_type: String(spec(c).battery_type ?? ''),
      nominal_voltage_v: num(spec(c).nominal_voltage_v) ?? 0,
      energy_wh: num(spec(c).energy_wh) ?? 0,
      rated_capacity_ah: num(spec(c).rated_capacity_ah),
    })).filter((b) => b.nominal_voltage_v > 0 && b.energy_wh > 0);

    const input: SystemInput = {
      systemType, panel,
      gridVA: num(body.gridVA) ?? undefined,
      gridPhase: (Number(body.gridPhase) === 3 ? 3 : 1),
      dcAcRatio: num(body.dcAcRatio) ?? 1.2,
      loads: Array.isArray(body.loads) ? (body.loads as SystemInput['loads']) : undefined,
      autonomyDays: num(body.autonomyDays) ?? 1,
      pshHours: num(body.pshHours) ?? 4,
      batteryPreference: (body.batteryPreference as SystemInput['batteryPreference']) ?? 'LiFePO4',
      // v9's four provenance answers. Each is UNDEFINED when unstated rather
      // than defaulted here, because the engine's warning is about the caller
      // not having answered — a default applied at the door would silence it.
      demandFactor: num(body.demandFactor) ?? undefined,
      powerLossFactorFs: num(body.powerLossFactorFs) ?? undefined,
      cableRunPerStringM: num(body.cableRunPerStringM) ?? undefined,
      pshSource: (body.pshSource as SystemInput['pshSource']) ?? undefined,
      minCellTempC: num(body.minCellTempC) ?? undefined,
      rows: num(body.rows) ?? 1,
      railLengthMm: num(body.railLengthMm) ?? 4850,
      panelSpacingMm: num(body.panelSpacingMm) ?? 20,
      mountType: (body.mountType as SystemInput['mountType']) ?? 'roof',
      orientation: (body.orientation as SystemInput['orientation']) ?? 'portrait',
    };

    const result = calculateSystem(input, { onGridInverters, hybridInverters, batteries });
    const reply = resolveAndPrice(result.lines, ctx);

    return NextResponse.json({
      engine: 'system', version: SYSTEM_ENGINE_VERSION,
      actor: { email, role },
      ok: result.ok,
      errors: result.errors,
      chosen: {
        inverter: result.inverter ?? null,
        battery: result.battery ?? null,
        numPanels: result.numPanels,
        arrayKwp: result.arrayKwp,
      },
      // Never report a string length without the rule and temperature behind it.
      strings: result.strings ?? null,
      load_analysis: systemType === 'on-grid' ? null : {
        totalWh: result.totalWh, runningW: result.runningW,
        surgeW: result.surgeW, requiredContinuousW: result.requiredContinuousW,
        // The load table BEFORE diversity, beside the figure that was sized.
        // An agent reporting "2 kW running" when the engine sized 1 kW is the
        // failure this whole version exists to stop.
        rawRunningW: result.rawRunningW, rawTotalWh: result.rawTotalWh,
        demandFactor: result.demandFactor,
        inverterSizingMethod: result.inverterSizingMethod,
        powerLossFactorFs: result.powerLossFactorFs ?? null,
        inverterHeadroomPct: result.inverterHeadroomPct,
        batteryStringVoltageV: result.batteryStringVoltageV,
        inverterMaxBatteryV: result.inverterMaxBatteryV ?? null,
        batteryVoltageCheck: result.batteryVoltageCheck,
        pshSource: result.pshSource,
      },
      // Provenance of the two site figures that move the BoM most. Reported on
      // every path because an on-grid field has cable too.
      assumptions: {
        cableSource: result.cableSource, cableRunPerStringM: result.cableRunPerStringM ?? null,
        totalCableM: result.totalCableM,
      },
      candidate_pool: {
        on_grid_inverters: onGridInverters.length,
        hybrid_inverters: hybridInverters.length,
        batteries: batteries.length,
      },
      picks: result.picks,
      pricing: reply.pricing,
      summary: reply.summary,
      lines: reply.lines,
      notes: designNotes(result.warnings, reply),
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
