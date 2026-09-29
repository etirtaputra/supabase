-- Each issuing company carries its own contact details (owner, 2026-09-29).
--
-- A support letter is issued BY a company (28.0_support_letters.company_id),
-- but printed the address and phone from ONE global setting (40.0 companyAddress
-- / companyPhone), which was empty — so PT Indodaya Surya Lestari's letters
-- read "Alamat: —, Telp.: —". The company row already held an address; it had
-- no phone or email. Add them, so the letter reads its own company.
alter table "1.0_companies" add column if not exists phone text;
alter table "1.0_companies" add column if not exists email text;

comment on column "1.0_companies".phone is 'Printed on documents this company issues (support letters). Falls back to Settings › Company.';
comment on column "1.0_companies".email is 'Printed on documents this company issues (support letters). Falls back to Settings › Company.';
