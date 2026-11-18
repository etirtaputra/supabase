import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfDisposition, desktopPdfName, supabaseStorageKey } from './pdfFileName.ts';

test('the download carries the desktop name, both plain and exact', () => {
  const t = 'Q-20261116-R9B-PVBESS_SBO-PV-CUAC-AL_AYANA-Resort-and-Spa-BALI_Hybrid-338kWpDC';
  assert.equal(pdfDisposition(t), `attachment; filename="${t}.pdf"; filename*=UTF-8''${t}.pdf`);
  assert.equal(pdfDisposition(t + '+(x)'), pdfDisposition(t + 'x'));
});

test('the name is the one desktop Chrome saves: + ( ) & and spaces dropped', () => {
  // The owner's own desktop PDF of R9B, 2026-11-18.
  assert.equal(
    desktopPdfName('Q-20261116-R9B-PV+BESS_SBO-(PV-CU+AC-AL)_AYANA-Resort-and-Spa-BALI_Hybrid-338kWpDC-375kWAC-375kWPCS-765kWhBESS_Atap-BOH-&-Atap-Ballroom-AYANA-BALI'),
    'Q-20261116-R9B-PVBESS_SBO-PV-CUAC-AL_AYANA-Resort-and-Spa-BALI_Hybrid-338kWpDC-375kWAC-375kWPCS-765kWhBESS_Atap-BOH--Atap-Ballroom-AYANA-BALI.pdf');
});

test('non-ASCII, quotes and line breaks never break the header', () => {
  const d = pdfDisposition('Q-1 "Café" (Bali)\n');
  assert.match(d, /^attachment; filename="Q-1Caf_Bali\.pdf"; filename\*=UTF-8''Q-1Caf%C3%A9Bali\.pdf$/);
  assert.ok(!/[\r\n"]/.test(d.split('filename="')[1].slice(0, -1).split('";')[0]));
});

test('an empty or .pdf-ended title still makes one sensible name', () => {
  assert.match(pdfDisposition(''), /filename="proposal\.pdf"/);
  assert.match(pdfDisposition('X.pdf'), /filename="X\.pdf"/);
});

test('the session key is the one supabase-js uses', () => {
  assert.equal(supabaseStorageKey('https://xijgplktpnpnstgeolfa.supabase.co'), 'sb-xijgplktpnpnstgeolfa-auth-token');
});
