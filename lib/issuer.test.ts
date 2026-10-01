import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveIssuer, receivingAccountFor, type IssuerFallback, type ReceivingAccount } from './issuer.ts';

const EMPTY: IssuerFallback = { companyName: '', companyAddress: '', companyPhone: '', companyEmail: '', companyTaxId: '', companyBankDetails: '' };
const ISL = { company_id: 'isl', legal_name: 'PT Indodaya Surya Lestari', address: 'Ruko Glodok Plaza A11', phone: '021-54345799', email: 'salessupport2@icasolar.com', tax_id: null };
const acct = (p: Partial<ReceivingAccount>): ReceivingAccount => ({
  company_id: 'isl', bank_name: 'BCA', account_number: '0827211111', account_name: 'PT Indodaya Surya Lestari',
  currency: 'IDR', is_active: true, is_default_receipt: false, ...p,
});

test("each field is the issuing company's own, the Settings block only fills a blank", () => {
  const i = resolveIssuer(ISL, { ...EMPTY, companyTaxId: '01.234.567.8-901.000', companyPhone: 'house phone' });
  assert.equal(i.name, 'PT Indodaya Surya Lestari');
  assert.equal(i.address, 'Ruko Glodok Plaza A11');
  assert.equal(i.phone, '021-54345799', 'own phone wins over the house phone');
  assert.equal(i.taxId, '01.234.567.8-901.000', 'blank NPWP on the company falls back');
  assert.equal(resolveIssuer(null, EMPTY).name, 'ICAPROC');
});

test('the bank account is never guessed — only the one marked for receiving prints', () => {
  // ISL today: three accounts, none marked (one is a personal joint account).
  const isl = [acct({ bank_name: 'MANDIRI', account_number: '1150038933893' }), acct({}), acct({ account_name: 'Eric Tirtaputra OR Wendy Yusson Abadi', account_number: '0821811111' })];
  assert.equal(receivingAccountFor(isl, 'isl'), null);
  assert.deepEqual(resolveIssuer(ISL, EMPTY, isl).bankLines, []);
  // Marked → printed, in full.
  const marked = [...isl.slice(0, 1), acct({ is_default_receipt: true })];
  assert.deepEqual(resolveIssuer(ISL, EMPTY, marked).bankLines, ['BCA', 'No. Rek. 0827211111', 'a.n. PT Indodaya Surya Lestari']);
  // Another company's marked account is never borrowed.
  assert.equal(receivingAccountFor([acct({ company_id: 'mbs', is_default_receipt: true })], 'isl'), null);
  // An inactive account does not print.
  assert.equal(receivingAccountFor([acct({ is_default_receipt: true, is_active: false })], 'isl'), null);
  // Nothing marked: the Settings text, line by line.
  assert.deepEqual(resolveIssuer(ISL, { ...EMPTY, companyBankDetails: 'BCA 123\na.n. PT X' }, isl).bankLines, ['BCA 123', 'a.n. PT X']);
});

test('every printed document takes its issuer from resolveIssuer, not the Settings block directly', () => {
  for (const f of ['app/sales/[id]/print/page.tsx', 'app/sales/[id]/do/page.tsx', 'app/proposals/[id]/print/page.tsx', 'app/support-letters/[id]/print/page.tsx']) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /resolveIssuer\(/, `${f} does not resolve its issuer`);
    assert.ok(!/settings\.company(Address|Phone|Email|TaxId|BankDetails)\b/.test(src), `${f} still reads the Settings block directly`);
  }
});
