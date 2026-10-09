import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacySource, sourceLabel, sourceSentence, fmtSourceAt, localInputToIso, isoToLocalInput, reasonsFor, reasonForPo, LINE_REASONS } from './dealContext.ts';

const STAFF = ['Wendy', 'Eric', 'Tisa', 'Abel', 'Budi'];
const P = (s: string) => {
  const r = parseLegacySource(s, STAFF);
  return r && [r.source_channel, fmtSourceAt(r.source_at), r.source_contact, r.received_by];
};

// The real notes, as typed between 2025-09 and 2026-10 (one of each shape).
test('the hand-typed notes become channel, Jakarta time, contact and receiver', () => {
  assert.deepEqual(P('WA Wendy to Eric 2026-10-07 16:55'), ['whatsapp', '2026-10-07 16:55', null, 'Wendy']);
  assert.deepEqual(P('WA Joe Trisindo to Wendy 2026-05-05 10:42'), ['whatsapp', '2026-05-05 10:42', 'Joe', 'Wendy']);
  assert.deepEqual(P('WA Joe Trisindo to Wendy'), ['whatsapp', '', 'Joe', 'Wendy']);
  assert.deepEqual(P('WA Joe Trisindo 2026-04-09 16.25'), ['whatsapp', '2026-04-09 16:25', 'Joe', null]);
  assert.deepEqual(P('WA Joe Trisindo 2026-09-24 (revised)'), ['whatsapp', '2026-09-24', 'Joe', null]);
  assert.deepEqual(P('WhatsApp Jasmine Epsolar 2026-04-25 00:17'), ['whatsapp', '2026-04-25 00:17', 'Jasmine', null]);
  assert.deepEqual(P('WhatsApp Tacy EPSIVO 2026-07-08 07.58'), ['whatsapp', '2026-07-08 07:58', 'Tacy', null]);
  assert.deepEqual(P("Wendy's WeChat 2026-1-31 07:51"), ['wechat', '2026-01-31 07:51', null, 'Wendy']);
  assert.deepEqual(P('WeChat EP-ICA 2026-09-07 13:41'), ['wechat', '2026-09-07 13:41', 'EP-ICA', null]);
  assert.deepEqual(P('WeChat jasmine-epsolar 刘超 2026-04-01 10:59'), ['wechat', '2026-04-01 10:59', 'Jasmine (刘超)', null]);
  assert.deepEqual(P('ICA-Serena WeChat 2026-07-15 12:15'), ['wechat', '2026-07-15 12:15', 'ICA-Serena', null]);
  assert.deepEqual(P('WeChat Shalin 2026-05-12 14:44'), ['wechat', '2026-05-12 14:44', 'Shalin', null]);
  assert.deepEqual(P('Email "ICA/ INFINISOLAR WP II 30K, 50K" 2026-07-28, 15.46'), ['email', '2026-07-28 15:46', null, null]);
  assert.deepEqual(P('Email "New EPEVER PI 2026.01.06" 11:04'), ['email', '2026-01-06 11:04', null, null]);
  assert.deepEqual(P('WeChat EP-ICA "New EPEVER PI 2026.01.06" 12:17'), ['wechat', '2026-01-06 12:17', 'EP-ICA', null]);
});

test("a date inside an email subject is the PI's date — the quote date is used instead", () => {
  const r = parseLegacySource('Email "New EPEVER PI 2026.01.06" 11:04', STAFF, '2026-01-08')!;
  assert.equal(fmtSourceAt(r.source_at), '2026-01-08 11:04');
  const r2 = parseLegacySource('Email "UPS Planning Order = July 2026" 2026-07-31, 13:15', STAFF, '2026-08-06')!;
  assert.equal(fmtSourceAt(r2.source_at), '2026-07-31 13:15', 'a date outside the subject is the message date');
});

test('a real document number is not a chat note', () => {
  for (const s of ['PI-20260507', 'LC26010001 (R1 2026-01-12)', 'Epsivo VFD Price List - ICA 20260708.pdf', '', 'WAREHOUSE-12']) {
    assert.equal(parseLegacySource(s, STAFF), null, s);
  }
});

test('label and sentence read the fields back', () => {
  const s = { source_channel: 'whatsapp', source_at: localInputToIso('2026-09-15T15:34'), source_contact: 'Jasmine', received_by: 'Wendy' };
  assert.equal(sourceLabel(s), 'WhatsApp · Jasmine · 2026-09-15 15:34');
  assert.equal(sourceSentence(s), 'WhatsApp from Jasmine to Wendy · 2026-09-15 15:34');
  assert.equal(sourceSentence({}), '');
  assert.equal(isoToLocalInput(s.source_at), '2026-09-15T15:34', 'Jakarta time both ways');
  assert.equal(s.source_at, '2026-09-15T08:34:00.000Z');
});

test('a price check is a reason to ask, never to order', () => {
  assert.ok(reasonsFor('quote').some((r) => r.value === 'price_check'));
  assert.ok(!reasonsFor('po').some((r) => r.value === 'price_check'));
  assert.equal(reasonForPo('price_check'), null);
  assert.equal(reasonForPo('project'), 'project');
  assert.equal(LINE_REASONS.filter((r) => r.needs).length, 3);
});

import { lineContextFields, sourceFieldsFromForm } from './dealContext.ts';

test('a line keeps only the link its reason points at; a PO drops "price check"', () => {
  const l = { reason: 'project', reason_project_quote_id: 'p1', reason_sales_quote_id: 's1', reason_replaces_component_id: 'c1', reason_note: '  for Hon Chuan ' };
  assert.deepEqual(lineContextFields(l, 'quote'), { reason: 'project', reason_note: 'for Hon Chuan', reason_project_quote_id: 'p1', reason_sales_quote_id: null, reason_replaces_component_id: null });
  assert.equal(lineContextFields({ ...l, reason: 'replacement' }, 'po').reason_replaces_component_id, 'c1');
  assert.deepEqual(lineContextFields({ reason: 'price_check', reason_note: 'compare' }, 'po'), { reason: null, reason_note: 'compare', reason_project_quote_id: null, reason_sales_quote_id: null, reason_replaces_component_id: null });
  assert.equal(lineContextFields({ reason: 'bogus' }, 'quote').reason, null);
  assert.equal(lineContextFields({}, 'quote').reason, null);
});

test('the header fields as typed become clean columns', () => {
  assert.deepEqual(sourceFieldsFromForm({ source_channel: 'whatsapp', source_at: '2026-10-09T09:15', source_contact: ' Joe ', received_by: '' }),
    { source_channel: 'whatsapp', source_at: '2026-10-09T02:15:00.000Z', source_contact: 'Joe', received_by: null });
  assert.equal(sourceFieldsFromForm({ source_channel: 'telegram' }).source_channel, null, 'only known channels');
});

import { reasonParts } from './dealContext.ts';

test('a reason renders with what it points at and the note', () => {
  const names = new Map([['p1', 'PT Hon Chuan — KIIC Plant'], ['c1', 'DEYE SUN-50K-SG01HP3']]);
  assert.deepEqual(reasonParts({ reason: 'project', reason_project_quote_id: 'p1', reason_note: 'phase 2' }, (id) => names.get(id)),
    { label: 'For a project', target: 'PT Hon Chuan — KIIC Plant', note: 'phase 2' });
  assert.deepEqual(reasonParts({ reason: 'replacement', reason_replaces_component_id: 'c1' }, (id) => names.get(id)),
    { label: 'Replaces an old model', target: 'DEYE SUN-50K-SG01HP3', note: '' });
  assert.equal(reasonParts({}, () => undefined), null);
  assert.deepEqual(reasonParts({ reason_note: 'just a note' }, () => undefined), { label: '', target: '', note: 'just a note' });
});

import { defaultLineReason } from './dealContext.ts';

test('project-only suppliers and the Jembo brand default a line to "for a project" (owner, 2026-10-09)', () => {
  for (const code of ['ANUGRAH', 'ESA', 'JJLAPP', 'LAPP', 'PERSADA', 'SUPREME', ' esa ']) assert.equal(defaultLineReason(code, null), 'project', code);
  assert.equal(defaultLineReason('GLOBAL', 'JEMBO'), 'project', 'Jembo wherever it is bought');
  assert.equal(defaultLineReason('SINARMONAS', 'Jembo Cable'), 'project');
  assert.equal(defaultLineReason('GLOBAL', 'KMI'), null, 'other items from a Jembo distributor are asked');
  assert.equal(defaultLineReason('EPEVER', null), null);
  assert.equal(defaultLineReason(null, undefined), null);
});
