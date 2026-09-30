import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandedModel, collapseRepeatedLead } from './brandText.ts';

test('the brand is said once, whether or not the model already starts with it', () => {
  assert.equal(brandedModel('EPEVER', 'EPEVER XTRA3210N-G3 MPPT 30A'), 'EPEVER XTRA3210N-G3 MPPT 30A');
  assert.equal(brandedModel('ICA SOLAR', 'ICA SOLAR ICA550-72HMI 550Wp Mono'), 'ICA SOLAR ICA550-72HMI 550Wp Mono');
  assert.equal(brandedModel('EPEVER', 'XTRA3210N-G3'), 'EPEVER XTRA3210N-G3');
  assert.equal(brandedModel('Deye', 'deye SUN-5K'), 'deye SUN-5K', 'case-insensitive');
  assert.equal(brandedModel('ICA', 'ICA550-72HMI'), 'ICA ICA550-72HMI', 'a model CODE that merely begins with the letters is not the brand');
  assert.equal(brandedModel(null, 'X1'), 'X1');
  assert.equal(brandedModel('EPEVER', ''), 'EPEVER');
});

test('letters saved with the doubled brand print clean', () => {
  // The two real lines from letter 002-ISL-SD-VIII-2026.
  assert.equal(collapseRepeatedLead('ICA SOLAR ICA SOLAR ICA550-72HMI 550Wp Mono 2278x1134x30mm'),
    'ICA SOLAR ICA550-72HMI 550Wp Mono 2278x1134x30mm');
  assert.equal(collapseRepeatedLead('EPEVER EPEVER XTRA3210N-G3 MPPT 30A'), 'EPEVER XTRA3210N-G3 MPPT 30A');
  // Nothing repeated: untouched.
  assert.equal(collapseRepeatedLead('Deye SUN-5K-SG04LP1'), 'Deye SUN-5K-SG04LP1');
  // Only the lead — a repeat later in the text is someone's wording.
  assert.equal(collapseRepeatedLead('Panel 550Wp 550Wp'), 'Panel 550Wp 550Wp');
  assert.equal(collapseRepeatedLead(''), '');
});
