/**
 * bcaRate — reading KlikBCA e-Rate and deciding whether the company rate
 * follows it. The figures are the owner's own examples (2026-10-24).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBcaKurs, roundUpToHundred, decideFollow, idNumber, FOLLOW_STEP, followsAt } from './bcaRate.ts';

const row = (code: string, nums: string[], attrs = true) => {
  const types = ['eRate-buy', 'eRate-sell', 'TT-buy', 'TT-sell', 'BN-buy', 'BN-sell'];
  return `<tr code="${code}"><td><p class="m-txt">${code}</p></td>${nums.map((n, i) =>
    `<td><p ${attrs ? `rate-type="${types[i]}" ` : ''}class="m-txt-right">${n}</p></td>`).join('')}</tr>`;
};
const PAGE = `<div><p>e-Rate</p><span>Diperbarui 23 Okt 2026 / 15:40 WIB</span></div><table>
  ${row('USD', ['18.098,00', '18.128,00', '17.950,00', '18.250,00', '17.900,00', '18.300,00'])}
  ${row('SGD', ['13.900,00', '13.950,00', '13.800,00', '14.050,00', '13.750,00', '14.100,00'])}
  ${row('CNH', ['2.731,00', '2.745,00', '2.700,00', '2.790,00', '2.650,00', '2.820,00'])}
</table>`;

test('reads the e-Rate, not the TT Counter, for USD and CNH (our CNY)', () => {
  const p = parseBcaKurs(PAGE);
  assert.deepEqual(p.rates.USD, { buy: 18098, sell: 18128 });
  assert.deepEqual(p.rates.CNY, { buy: 2731, sell: 2745 });
  assert.equal(p.quotedAt, '23 Okt 2026 / 15:40 WIB');
});

test('without the rate-type marks, the first pair of figures is still the e-Rate', () => {
  const p = parseBcaKurs(`<table>${row('USD', ['18.098,00', '18.128,00', '17.950,00', '18.250,00'], false)}</table>`);
  assert.equal(p.rates.USD.sell, 18128);
  assert.equal(p.rates.CNY, undefined, 'a currency not on the page is simply absent');
});

test('round up to the next hundred: the owner’s examples', () => {
  assert.equal(roundUpToHundred(18128), 18200);
  assert.equal(roundUpToHundred(2745), 2800);
  assert.equal(roundUpToHundred(2800), 2800, 'already a hundred stays');
  assert.equal(roundUpToHundred(2800.4), 2900);
  assert.equal(idNumber('18.128,00'), 18128);
});

test('the company rate follows whenever the rounded e-Rate is 100 or more away, either way (owner, 2026-11-28)', () => {
  assert.equal(FOLLOW_STEP, 100);
  assert.equal(decideFollow('USD', 18128, 18200).update, false, 'same hundred: stays');
  const today = decideFollow('USD', 18399, 18200);      // → 18,400: +1.1% — under the old 1.5% it stayed
  assert.deepEqual([today.target, today.update, today.reason], [18400, true, 'moved']);
  assert.equal(decideFollow('USD', 18399, 18400).update, false, 'at 18,400 it stays at 18,400');
  assert.equal(decideFollow('USD', 18401, 18400).update, true, '18,401 rounds up to 18,500');
  const down = decideFollow('USD', 18250, 18400);        // → 18,300: one hundred down
  assert.deepEqual([down.target, down.update], [18300, true]);
  assert.equal(decideFollow('CNY', 2789.77, 2800).update, false, 'CNY 2,789.77 rounds to the 2,800 in force');
  assert.equal(decideFollow('CNY', 2850, 2800).update, true);
  assert.equal(decideFollow('USD', 18350, 18330).update, false, 'a typed odd rate: under 100 away stays');
  assert.equal(decideFollow('USD', 18128, null).reason, 'no-rate-yet');
  assert.equal(followsAt(18500, 18400), true);
  assert.equal(followsAt(18450, 18400), false);
});

test('a misread figure never becomes the company rate', () => {
  assert.equal(decideFollow('USD', 181.28, 18200).reason, 'insane');
  assert.equal(decideFollow('CNY', 27450, 2800).update, false);
});
