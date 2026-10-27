/**
 * Dolibarr → ICAPROC, batch 0: the matching report. READS files, writes one.
 *
 *   node scripts/dolibarr-match.ts --survey <survey dir> --icaproc <snapshot dir> --out <dir>
 *
 * --survey   the folder scripts/dolibarr-survey.py wrote (keys.json, survey.json)
 * --icaproc  a snapshot of ICAPROC, read with SELECTs (Supabase MCP / SQL editor):
 *              customers.json   [{ id, code, legal_name, display_name }]   from "20.0_customers"
 *              suppliers.json   [{ id, code, name }]                       from "2.0_suppliers"
 *              components.json  [{ id, model, brand, archived }]           from "3.0_components"
 *              users.json       [{ email, name, role }]                    user_profiles + allowed_emails
 * --out      match.json: every Dolibarr customer, supplier, product and user
 *            with same / possible / new, the candidates and the reason.
 *
 * It talks to neither Dolibarr nor Supabase, and it never writes outside --out.
 * The output holds customer names: keep it out of git (like keys.json).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  matchParties, matchItems, matchUsers, lookAlikes, unclaimed, tally, looksInternal,
  type Party, type Match, type DolibarrItem, type IcaprocItem, type IcaprocUser, type DolibarrUser,
} from '../lib/dolibarrMatch.ts';

type Json = Record<string, unknown>;

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? process.argv[i + 1] : undefined;
  if (!v) { console.error(`missing --${name}`); process.exit(2); }
  return v;
}
const read = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8'));

const surveyDir = arg('survey'), icaprocDir = arg('icaproc'), outDir = arg('out');
const keys = read(surveyDir, 'keys.json');
const survey = read(surveyDir, 'survey.json');

// ── Dolibarr side ────────────────────────────────────────────────────────────
const thirdparties: Json[] = keys.thirdparties ?? [];
const openBySoc = new Map<string, Record<string, number>>();
for (const [doc, rows] of Object.entries((keys.open_documents ?? {}) as Record<string, Json[]>)) {
  for (const r of rows) {
    const soc = String(r.socid ?? '');
    if (!soc) continue;
    const o = openBySoc.get(soc) ?? {};
    o[doc] = (o[doc] ?? 0) + 1;
    openBySoc.set(soc, o);
  }
}
const party = (t: Json): Party => ({
  id: String(t.id),
  names: [t.name, t.name_alias].filter((x): x is string => typeof x === 'string' && x.trim() !== ''),
  label: String(t.name ?? ''),
});
const dCustomers = thirdparties.filter((t) => t.client === 1 || t.client === 3);
const dSuppliers = thirdparties.filter((t) => t.fournisseur === 1);
const dOthers = thirdparties.filter((t) => !(t.client === 1 || t.client === 3));
const tpById = new Map(thirdparties.map((t) => [String(t.id), t]));

// ── ICAPROC side ─────────────────────────────────────────────────────────────
const iCustomers: Party[] = read(icaprocDir, 'customers.json').map((c: Json) => ({
  id: String(c.id),
  names: [c.legal_name, c.display_name].filter((x): x is string => typeof x === 'string' && x.trim() !== ''),
  label: `${c.code} · ${c.legal_name}${c.display_name && c.display_name !== c.legal_name ? ` (${c.display_name})` : ''}`,
}));
const iSuppliers: Party[] = read(icaprocDir, 'suppliers.json').map((s: Json) => ({
  id: String(s.id),
  names: [s.name, s.code].filter((x): x is string => typeof x === 'string' && x.trim() !== ''),
  label: `${s.code} · ${String(s.name).trim()}`,
}));
const iItems: IcaprocItem[] = read(icaprocDir, 'components.json')
  .filter((c: Json) => !c.archived)
  .map((c: Json) => ({ id: String(c.id), model: String(c.model ?? ''), brand: (c.brand as string) ?? null }));
const iUsers: IcaprocUser[] = read(icaprocDir, 'users.json');

// Words that say nothing about WHICH supplier ("Shenzhen … Technology Co.").
const SUPPLIER_GENERIC = new Set([
  'shenzhen', 'huizhou', 'dongguan', 'foshan', 'ningbo', 'xiamen', 'wenzhou', 'hefei', 'wuxi', 'guangzhou', 'shanghai', 'zhejiang',
  'science', 'teknologi', 'tech', 'new', 'energi', 'power', 'elektrik', 'electrical', 'international', 'trade', 'trading',
  'industries', 'industry', 'industrial', 'indonesia', 'group', 'photovoltaic', 'solar', 'global', 'and', 'the',
]);

// ── Match ────────────────────────────────────────────────────────────────────
const customers = matchParties(dCustomers.map(party), iCustomers);
const suppliers = matchParties(dSuppliers.map(party), iSuppliers, { generic: SUPPLIER_GENERIC });
const items = matchItems((keys.products ?? []).map((p: Json): DolibarrItem => ({
  id: String(p.id), ref: String(p.ref ?? ''), label: String(p.label ?? ''), service: p.type === 1,
})), iItems);
const dUsers: DolibarrUser[] = (survey.users?.users ?? []).map((u: Json) => ({
  login: String(u.login ?? ''), name: String(u.name ?? ''), email: (u.email as string) ?? null,
}));
const users = matchUsers(dUsers, iUsers);

// ICAPROC customers no Dolibarr CUSTOMER matched: are they a Dolibarr prospect
// or supplier instead, or typed in ICAPROC only?
const lonely = unclaimed(iCustomers, customers);
const elsewhere = matchParties(lonely, dOthers.map(party));
const icaprocOnly = elsewhere.map((m) => {
  const t = m.match ? tpById.get(m.match.id) : undefined;
  const kind = !t ? null : t.client === 2 ? 'prospek' : t.fournisseur === 1 ? 'pemasok' : 'lainnya';
  return { icaproc: m.source.label, status: m.status, dolibarr: m.match?.label ?? null, dolibarr_kind: kind, why: m.why };
});

// A Dolibarr supplier ICAPROC holds only as a CUSTOMER (a sister company
// that both buys and sells) is not new to ICAPROC.
const supplierAsCustomer = matchParties(
  suppliers.filter((m) => m.status === 'new').map((m) => m.source), iCustomers,
).filter((m) => m.status !== 'new').map((m) => ({ dolibarr: m.source.label, icaproc_customer: m.match?.label, status: m.status }));

const withOpen = <S extends Party>(ms: Match<S>[]) => ms.map((m) => ({
  ...m, open_documents: openBySoc.get(m.source.id) ?? null, placeholder: looksInternal(m.source.label),
}));

const report = {
  generated_at: new Date().toISOString(),
  survey_generated_at: survey.generated_at,
  counts: {
    customers: tally(customers),
    suppliers: tally(suppliers),
    items: tally(items),
    users: tally(users),
    icaproc_customers_not_matched_to_a_dolibarr_customer: lonely.length,
    of_which_in_dolibarr_as_something_else: tally(elsewhere),
    dolibarr_prospects: thirdparties.filter((t) => t.client === 2).length,
    dolibarr_customers_that_are_placeholders: dCustomers.filter((t) => looksInternal(String(t.name ?? ''))).length,
  },
  customers: withOpen(customers),
  suppliers: withOpen(suppliers),
  items,
  users,
  icaproc_customers_not_in_dolibarr_customers: icaprocOnly,
  new_suppliers_icaproc_has_as_customers: supplierAsCustomer,
  look_alikes: {
    icaproc_customers: lookAlikes(iCustomers).map((g) => g.map((p) => p.label)),
    dolibarr_customers: lookAlikes(dCustomers.map(party)).map((g) => g.map((p) => `${p.id} · ${p.label}`)),
  },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'match.json'), JSON.stringify(report, null, 1));

// Counts only on the screen; names stay in the file.
const row = (name: string, t: Record<string, number>) =>
  console.log(`${name.padEnd(12)}${String(t.same).padStart(8)}${String(t.possible).padStart(10)}${String(t.new).padStart(8)}`);
console.log(`${''.padEnd(12)}${'sudah'.padStart(8)}${'mungkin'.padStart(10)}${'baru'.padStart(8)}`);
row('pelanggan', report.counts.customers);
row('pemasok', report.counts.suppliers);
row('barang', report.counts.items);
row('pengguna', report.counts.users);
console.log(`\nPelanggan ICAPROC tanpa pasangan pelanggan Dolibarr: ${lonely.length}`);
console.log(`Kembar di ICAPROC: ${report.look_alikes.icaproc_customers.length} kelompok · kembar di Dolibarr: ${report.look_alikes.dolibarr_customers.length} kelompok`);
console.log(`\n${join(outDir, 'match.json')}`);
