'use client';
/**
 * BOM Calculator — the Cable raceway tab: tray runs sized by fill ratio,
 * the stick-price table that turns them into one cost per metre, and the
 * conduit / gland / label / tie / clip counts (lib/bomCalc/raceway.ts).
 */
import React from 'react';
import { useT } from '@/hooks/useT';
import { fmtRp } from '@/lib/formatters';
import { racewayOf, type BomCalcDoc, type BomCalcResult, type BomRow } from '@/lib/bomCalc';
import { sizeKey, sizeLabel, type RacewayDoc, type RacewaySettings, type TrayCable, type TrayCableSource, type TrayRun } from '@/lib/bomCalc/raceway';
import type { Explanation } from '@/lib/bomCalc/links';
import { NumField, TextField, Labeled, Card, CELL, SMALL_BTN, DEL_BTN } from './Fields';
import { fmtN, LinkLines } from './LinkBits';

let uid = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

/** A cable source as one <select> value. */
const srcValue = (s: TrayCableSource) => (s.kind === 'typed' ? 'typed' : s.kind === 'roof' ? `roof:${s.roofId}` : `seg:${s.segId}:${s.part}`);

export function RacewayTab({ doc, res, edit, explain, usage, onGo }: {
  doc: BomCalcDoc; res: BomCalcResult; edit: (fn: (d: BomCalcDoc) => BomCalcDoc) => void;
  explain: (key: string) => Explanation | null; usage: Map<string, BomRow[]>; onGo: (rowId: string) => void;
}) {
  const { t, tf } = useT();
  const rw = racewayOf(doc);
  const rr = res.raceway;
  const st = rw.settings;

  const setRw = (fn: (r: RacewayDoc) => RacewayDoc) => edit((d) => ({ ...d, raceway: fn(racewayOf(d)) }));
  const setSt = (p: Partial<RacewaySettings>) => setRw((r) => ({ ...r, settings: { ...r.settings, ...p } }));
  const setRun = (id: string, p: Partial<TrayRun>) => setRw((r) => ({ ...r, trays: r.trays.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const setCable = (runId: string, cid: string, p: Partial<TrayCable>) => setRw((r) => ({
    ...r, trays: r.trays.map((x) => (x.id === runId ? { ...x, cables: x.cables.map((c) => (c.id === cid ? { ...c, ...p } : c)) } : x)),
  }));
  const setSize = (i: number, p: Partial<RacewayDoc['sizes'][number]>) => setRw((r) => ({ ...r, sizes: r.sizes.map((s, j) => (j === i ? { ...s, ...p } : s)) }));

  /** The name a linked cable goes by until someone types one. */
  const sourceName = (src: TrayCableSource) => {
    if (src.kind === 'roof') {
      const roof = doc.roofs.find((x) => x.id === src.roofId);
      const size = res.dc.roofs.find((x) => x.id === src.roofId)?.size;
      return roof ? `PV ${size ?? ''} mm² — ${roof.label || t('Roof')}` : '';
    }
    if (src.kind === 'seg') {
      const s = doc.acSegments.find((x) => x.id === src.segId);
      if (!s) return '';
      return src.part === 'pe' && s.pe ? `${s.pe.cableType} ${s.pe.sizeMm2} — ${s.label}` : `${s.cableType} ${s.sizeMm2} — ${s.label}`;
    }
    return '';
  };
  const pickSource = (runId: string, c: TrayCable, v: string) => {
    const [kind, id, part] = v.split(':');
    const source: TrayCableSource = kind === 'roof' ? { kind: 'roof', roofId: id }
      : kind === 'seg' ? { kind: 'seg', segId: id, part: part === 'pe' ? 'pe' : 'phase' }
      : { kind: 'typed', count: c.source.kind === 'typed' ? c.source.count : 0 };
    setCable(runId, c.id, { source });
  };

  const trayRows = usage.get('rw.tray.m') ?? [];
  const sizesUsed = Object.keys(rr.bySize);
  const trayKeys = ['rw.tray.m', ...sizesUsed.map((z) => `rw.tray.${z}.m`), 'rw.tray.pieces', 'rw.tray.covers', 'rw.tray.clamps', 'rw.tray.joints', 'rw.tray.bolts'];
  const countKeys = ['rw.conduit', 'rw.glands', 'rw.labels', 'rw.ties', 'rw.clips'];

  return (
    <div className="space-y-4">
      {/* ── Tray runs ── */}
      <Card title={t('Cable trays')} action={
        <button className={SMALL_BTN} onClick={() => setRw((r) => ({ ...r, trays: [...r.trays, { id: newId('t'), label: '', lengthM: 0, size: 'auto', cables: [] }] }))}>{t('+ Tray run')}</button>}>
        <p className="text-[11px] text-slate-500">{t('One run per tray route, with the cables it carries. Fill = Σ cables × π × (OD ÷ 2)² ÷ (width × height). Size "auto" picks the smallest tray in the size table within the fill limit. A cable can take its count from a roof (2 per string) or an AC segment, so the fill follows the design. Outer diameters come from the maker catalogue.')}</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-3xl">
          <Labeled label={t('Fill limit %')}><NumField value={st.fillLimitPct} onChange={(v) => setSt({ fillLimitPct: v ?? 40 })} /></Labeled>
          <Labeled label={t('Stick length (m)')}><NumField value={st.stickM} onChange={(v) => setSt({ stickM: v ?? 3 })} /></Labeled>
          <Labeled label={t('Clamps per cover')}><NumField value={st.clampsPerCover} onChange={(v) => setSt({ clampsPerCover: v ?? 0 })} /></Labeled>
          <Labeled label={t('Joints per piece')}><NumField value={st.jointsPerPiece} onChange={(v) => setSt({ jointsPerPiece: v ?? 0 })} /></Labeled>
          <Labeled label={t('Bolts per joint')}><NumField value={st.boltsPerJoint} onChange={(v) => setSt({ boltsPerJoint: v ?? 0 })} /></Labeled>
        </div>
        {rw.trays.length === 0 && <p className="text-xs text-slate-500 italic">{t('No tray runs yet.')}</p>}
        {rw.trays.map((run) => {
          const r = rr.trays.find((x) => x.id === run.id);
          const over = r?.fillPct != null && r.fillPct > st.fillLimitPct;
          return (
            <div key={run.id} className="rounded-xl border border-slate-800 p-3 space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <Labeled label={t('Tray run')} className="flex-1 min-w-[200px]"><TextField value={run.label} placeholder={t('e.g. DC main route')} onChange={(v) => setRun(run.id, { label: v })} /></Labeled>
                <Labeled label={t('Route length (m)')} className="w-28"><NumField value={run.lengthM} onChange={(v) => setRun(run.id, { lengthM: v ?? 0 })} /></Labeled>
                <Labeled label={t('Size')} className="w-40">
                  <select value={run.size} className={CELL} onChange={(e) => setRun(run.id, { size: e.target.value })}>
                    <option value="auto">{tf('auto ({s})', { s: run.size === 'auto' && r?.size ? sizeLabel(r.size) : '—' })}</option>
                    {rw.sizes.map((s) => <option key={sizeKey(s)} value={sizeKey(s)}>{sizeLabel(sizeKey(s))}</option>)}
                  </select>
                </Labeled>
                <button className={DEL_BTN} title={t('Remove')} onClick={() => setRw((x) => ({ ...x, trays: x.trays.filter((y) => y.id !== run.id) }))}>×</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[700px]">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="text-left py-1 pr-2">{t('Cable')}</th><th className="text-left px-1 w-56">{t('Count source')}</th>
                    <th className="text-right px-1 w-20">{t('Count')}</th><th className="text-right px-1 w-28">OD (mm)</th><th className="text-right px-1 w-24">mm²</th><th className="w-6" />
                  </tr></thead>
                  <tbody>
                    {run.cables.map((c) => {
                      const cr = r?.cables.find((x) => x.id === c.id);
                      return (
                        <tr key={c.id}>
                          <td className="py-1 pr-2"><TextField value={c.label} placeholder={sourceName(c.source)} onChange={(v) => setCable(run.id, c.id, { label: v })} /></td>
                          <td className="px-1">
                            <select value={srcValue(c.source)} className={CELL} onChange={(e) => pickSource(run.id, c, e.target.value)}>
                              <option value="typed">{t('Typed')}</option>
                              {doc.roofs.length > 0 && <optgroup label={t('DC cable')}>
                                {doc.roofs.map((f) => <option key={f.id} value={`roof:${f.id}`}>{tf('{roof}: 2 per string', { roof: f.label || t('Roof') })}</option>)}
                              </optgroup>}
                              <optgroup label={t('AC cable')}>
                                {doc.acSegments.flatMap((s) => [
                                  <option key={`${s.id}p`} value={`seg:${s.id}:phase`}>{`${s.label}: ${s.cableType} ${s.sizeMm2}`}</option>,
                                  ...(s.pe ? [<option key={`${s.id}e`} value={`seg:${s.id}:pe`}>{`${s.label}: ${s.pe.cableType} ${s.pe.sizeMm2} (PE)`}</option>] : []),
                                ])}
                              </optgroup>
                              {/* A source that no longer exists stays visible until it is re-picked. */}
                              {c.source.kind !== 'typed' && !(c.source.kind === 'roof' ? doc.roofs.some((f) => f.id === (c.source as { roofId: string }).roofId) : doc.acSegments.some((s) => s.id === (c.source as { segId: string }).segId))
                                && <option value={srcValue(c.source)}>{t('(removed)')}</option>}
                            </select>
                          </td>
                          <td className="px-1">
                            {c.source.kind === 'typed'
                              ? <NumField value={c.source.count} onChange={(v) => setCable(run.id, c.id, { source: { kind: 'typed', count: v ?? 0 } })} />
                              : <div className="text-right tabular-nums text-sky-300 pt-1.5">{fmtN(cr?.count ?? 0)}</div>}
                          </td>
                          <td className="px-1"><NumField value={c.odMm} placeholder={t('from catalogue')} onChange={(v) => setCable(run.id, c.id, { odMm: v })} /></td>
                          <td className="px-1 text-right tabular-nums text-slate-400 pt-1.5">{cr?.areaMm2 != null ? fmtN(cr.areaMm2) : '—'}</td>
                          <td><button className={DEL_BTN} title={t('Remove')} onClick={() => setRw((x) => ({ ...x, trays: x.trays.map((y) => (y.id === run.id ? { ...y, cables: y.cables.filter((z) => z.id !== c.id) } : y)) }))}>×</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                <button className={SMALL_BTN} onClick={() => setRun(run.id, { cables: [...run.cables, { id: newId('c'), label: '', source: { kind: 'typed', count: 0 }, odMm: null }] })}>{t('+ Cable')}</button>
                {r && <>
                  {!r.size && r.lengthM > 0 && <span className="text-amber-300">{t('Not sized yet — see Checks.')}</span>}
                  {r.cableAreaMm2 != null && <span>{tf('Cables {a} mm²', { a: fmtN(r.cableAreaMm2) })}</span>}
                  {r.fillPct != null && r.size && <span className={over ? 'text-red-300' : 'text-emerald-300'}>{tf('fill {f} % of {size}', { f: r.fillPct, size: sizeLabel(r.size) })}</span>}
                  {r.pieces > 0 && <span>{tf('{p} pieces · {c} covers · {k} clamps · {j} joints · {b} bolts', { p: r.pieces, c: r.covers, k: r.clamps, j: r.joints, b: r.bolts })}</span>}
                  {r.cost != null && <span className="text-slate-300">{fmtRp(r.cost)}</span>}
                </>}
              </div>
            </div>
          );
        })}
        <LinkLines keys={trayKeys} explain={explain} usage={usage} onGo={onGo} mustUse={['rw.tray.m']} />
      </Card>

      {/* ── Size table and stick prices ── */}
      <Card title={t('Tray sizes and stick prices')} action={
        <button className={SMALL_BTN} onClick={() => setRw((r) => ({ ...r, sizes: [...r.sizes, { widthMm: 0, heightMm: 100, stickCost: null, coverCost: null }] }))}>{t('+ Size')}</button>}>
        <p className="text-[11px] text-slate-500">{t('Cost per stick of tray and of cover, from the supplier. A blank cover, clamp, joint or bolt cost means it is included in the stick cost. The blended cost per metre is what the tray row in the Bill of Material takes.')}</p>
        <div className="overflow-x-auto">
          <table className="text-xs min-w-[560px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="text-right px-1 w-24">{t('Width (mm)')}</th><th className="text-right px-1 w-24">{t('Height (mm)')}</th>
              <th className="text-right px-1 w-32">{t('Stick cost')}</th><th className="text-right px-1 w-32">{t('Cover cost')}</th>
              <th className="text-right px-1 w-28">{t('Used (m)')}</th><th className="w-6" />
            </tr></thead>
            <tbody>
              {rw.sizes.map((s, i) => {
                const used = rr.bySize[sizeKey(s)];
                return (
                  <tr key={i}>
                    <td className="px-1 py-0.5"><NumField value={s.widthMm || null} onChange={(v) => setSize(i, { widthMm: v ?? 0 })} /></td>
                    <td className="px-1"><NumField value={s.heightMm || null} onChange={(v) => setSize(i, { heightMm: v ?? 0 })} /></td>
                    <td className="px-1"><NumField value={s.stickCost} onChange={(v) => setSize(i, { stickCost: v })} /></td>
                    <td className="px-1"><NumField value={s.coverCost} onChange={(v) => setSize(i, { coverCost: v })} /></td>
                    <td className={`px-1 text-right tabular-nums ${used ? (s.stickCost ? 'text-slate-200' : 'text-amber-300') : 'text-slate-600'}`}>{used ? fmtN(used.m, used.m % 1 ? 2 : 0) : '—'}</td>
                    <td><button className={DEL_BTN} title={t('Remove')} onClick={() => setRw((x) => ({ ...x, sizes: x.sizes.filter((_, j) => j !== i) }))}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-3 gap-3 max-w-lg">
          <Labeled label={t('Clamp cost')}><NumField value={st.clampCost} onChange={(v) => setSt({ clampCost: v })} /></Labeled>
          <Labeled label={t('Joint cost')}><NumField value={st.jointCost} onChange={(v) => setSt({ jointCost: v })} /></Labeled>
          <Labeled label={t('Bolt cost')}><NumField value={st.boltCost} onChange={(v) => setSt({ boltCost: v })} /></Labeled>
        </div>
        {rr.trayM > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {rr.costPerM != null ? (
              <>
                <span className="text-slate-300">{tf('Blended cost: {c} per m ({total} ÷ {m} m)', { c: fmtRp(rr.costPerM), total: fmtRp(rr.trayCost ?? 0), m: fmtN(rr.trayM, rr.trayM % 1 ? 2 : 0) })}</span>
                {trayRows.length > 0 && (
                  <button className={SMALL_BTN} title={t('Sets the cost per unit of every BOM row that reads the tray metres')}
                    onClick={() => edit((d) => ({ ...d, rows: d.rows.map((x) => (x.qty.mode === 'link' && x.qty.key === 'rw.tray.m' ? { ...x, cost: Math.round(rr.costPerM!) } : x)) }))}>
                    {t('Use as the tray row cost')}
                  </button>
                )}
              </>
            ) : <span className="text-amber-300">{t('Size every tray run and give every size in use a stick cost to get the blended cost per metre.')}</span>}
          </div>
        )}
      </Card>

      {/* ── Counts ── */}
      <Card title={t('Conduit, glands, labels, ties and clips')}>
        <p className="text-[11px] text-slate-500">{tf('Counted from {s} strings, {i} inverters, {m} modules and {c} AC circuits. The factors are starting figures — set them to your own practice.', { s: fmtN(rr.counts.strings), i: fmtN(rr.counts.inverters), m: fmtN(rr.counts.modules), c: fmtN(rr.acCircuits) })}</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Labeled label={t('Conduit m per string')}><NumField value={st.conduitPerStringM} onChange={(v) => setSt({ conduitPerStringM: v ?? 0 })} /></Labeled>
          <Labeled label={t('Conduit m per inverter')}><NumField value={st.conduitPerInverterM} onChange={(v) => setSt({ conduitPerInverterM: v ?? 0 })} /></Labeled>
          <Labeled label={t('Glands per string')}><NumField value={st.glandsPerString} onChange={(v) => setSt({ glandsPerString: v ?? 0 })} /></Labeled>
          <Labeled label={t('Glands per inverter')}><NumField value={st.glandsPerInverter} onChange={(v) => setSt({ glandsPerInverter: v ?? 0 })} /></Labeled>
          <Labeled label={t('Ties per module')}><NumField value={st.tiesPerModule} onChange={(v) => setSt({ tiesPerModule: v ?? 0 })} /></Labeled>
          <Labeled label={t('Labels per string')}><NumField value={st.labelsPerString} onChange={(v) => setSt({ labelsPerString: v ?? 0 })} /></Labeled>
          <Labeled label={t('Labels per inverter')}><NumField value={st.labelsPerInverter} onChange={(v) => setSt({ labelsPerInverter: v ?? 0 })} /></Labeled>
          <Labeled label={t('Labels per AC circuit')}><NumField value={st.labelsPerAcCircuit} onChange={(v) => setSt({ labelsPerAcCircuit: v ?? 0 })} /></Labeled>
          <Labeled label={t('Extra labels')}><NumField value={st.labelsExtra} onChange={(v) => setSt({ labelsExtra: v ?? 0 })} /></Labeled>
          <Labeled label={t('Clips per module')}><NumField value={st.clipsPerModule} onChange={(v) => setSt({ clipsPerModule: v ?? 0 })} /></Labeled>
        </div>
        <LinkLines keys={countKeys} explain={explain} usage={usage} onGo={onGo} mustUse={countKeys} />
      </Card>
    </div>
  );
}
