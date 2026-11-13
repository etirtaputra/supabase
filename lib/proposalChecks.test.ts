/**
 * Proposal checks (lib/proposalChecks.ts). The cases are the real proposals:
 * the copper R8A passes; the aluminium R8B / R8C and July's R6 — sent without
 * their earthing conductors — fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalChecks, isAcPowerCable, isEarthing, PROPOSAL_CHECK_IDS } from './proposalChecks.ts';

const L = (...d: string[]) => d.map((description) => ({ description }));

const MOUNTING = 'Aluminium Triangle Kit - c/w cor pedestal, clamps, clips, grounding kits';
const LADDER = 'Cable Ladder Steel HDG + Cover and Accesories';

test('R8A (copper) passes: its NYA runs are the earthing', () => {
  const r8a = L(MOUNTING, 'KMI Kabel NYY 1 x 95 mm²', 'KMI Kabel NYY 1 x 240 mm²', 'KMI Kabel NYA 50 mm²', 'KMI Kabel NYA 240 mm²', LADDER);
  assert.deepEqual(proposalChecks(r8a), []);
});

test('R8B / R8C / R6 (aluminium) fail: AC cables and no earthing', () => {
  const al = L(MOUNTING, 'KMI Kabel NA2XY 1 x 120 mm²', 'KMI Kabel NA2XY 1 x 300 mm²', 'KMI Kabel NA2XY 70 mm²', LADDER);
  const r = proposalChecks(al);
  assert.deepEqual(r.map((c) => c.id), ['ac_earthing']);
  assert.deepEqual(r[0].evidence, ['KMI Kabel NA2XY 1 x 120 mm²', 'KMI Kabel NA2XY 1 x 300 mm²', 'KMI Kabel NA2XY 70 mm²']);
});

test('what counts as earthing, and what does not', () => {
  for (const d of ['KMI Kabel NYA 4 mm² (Kuning Hijau)', 'KMI Kabel NYA 240 mm²', 'NYA 10mm', 'Grounding sistem, lightning arrester & accesories',
    'Grounding Rod, Joint Rod, Grounding Box, Kabel BC, Bor Lubang 25m', 'Grounding System', 'Grounding Equipment', 'Kabel BC 50 mm²', 'Earthing cable 70mm2']) {
    assert.ok(isEarthing(d), d);
  }
  // PV-frame bonding hardware, not the AC side's earth
  for (const d of [MOUNTING, 'Aluminium & HDG Steel Ground Mounting Kit - c/w  clamps, clips, grounding kits', 'MIBET MD Grounding Clip L40mm SUS304',
    'MIBET MD Grounding Lug Kit L25mm AL6005-T5', 'Canopy Outdoor with Concrete Ground for Inverter & BESS & Transformer (20M x 6M)',
    'KMI Kabel NA2XY 70 mm²', 'Underground U ditch with Cover for Cable Raceway']) {
    assert.ok(!isEarthing(d), d);
  }
});

test('AC power cables, copper and aluminium; NYA and DC cable are not', () => {
  for (const d of ['KMI Kabel NYY 1 x 95 mm²', 'KMI Kabel NA2XY 1 x 300 mm²', 'JEMBO Kabel NYY 4 x 10 mm²', 'Kabel NYM 3 x 2.5 mm²', 'KMI N2XSY 1 x 150 mm² 20kV']) {
    assert.ok(isAcPowerCable(d), d);
  }
  for (const d of ['KMI Kabel NYA 50 mm²', 'SUNKEAN PV1500DC-AL-K 10mm²', 'SLOCABLE Kabel H1Z2Z2-K 1 x 6mm']) {
    assert.ok(!isAcPowerCable(d), d);
  }
});

test('a proposal without AC cables has nothing to check; blank lines are ignored', () => {
  assert.deepEqual(proposalChecks(L('JINKO JKM650-66HL4M-BDV 650Wp', 'SUNKEAN PV1500DC-AL-K 10mm²', '  ')), []);
  assert.deepEqual(PROPOSAL_CHECK_IDS, ['ac_earthing']);
});
