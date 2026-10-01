-- NPWP per issuing company (owner, 2026-10-01: Company Editor in Settings).
-- Printed on the quotation/invoice letterhead of the company that issues it;
-- Settings › Company's single NPWP stays the fallback.
alter table "1.0_companies" add column if not exists tax_id text;
comment on column "1.0_companies".tax_id is 'NPWP printed on documents this company issues. Falls back to Settings › Company.';
