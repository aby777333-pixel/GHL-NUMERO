-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · maker-checker for the Owner, and party
-- tagging on document postings (migration 0005).
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); g uuid; c1 uuid; party uuid; inv uuid; jv uuid; tax uuid; sales uuid; v text; n int; x numeric; y numeric; pl numeric; r text := '';
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner2@test.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker2@test.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('T', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','T1','name','Test One'),
    'accounts', '[{"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},{"code":"1100","name":"AR","type":"asset","subtype":"receivable","control_type":"receivable"},{"code":"2000","name":"AP","type":"liability","subtype":"payable","control_type":"payable"},{"code":"2200","name":"CGST","type":"liability","subtype":"tax_payable","control_type":"tax"},{"code":"2201","name":"SGST","type":"liability","subtype":"tax_payable","control_type":"tax"},{"code":"4000","name":"Sales","type":"income","subtype":"revenue"}]'::jsonb,
    'account_map', '{"ar_control":"1100","ap_control":"2000"}'::jsonb,
    'tax_codes', '[{"code":"GST18","name":"GST 18%","components":[{"component":"CGST","rate":9,"output_code":"2200","input_code":"2200"},{"component":"SGST","rate":9,"output_code":"2201","input_code":"2201"}]}]'::jsonb));
  perform public.grant_membership('maker2@test.numero.invalid', c1, 'accountant');
  select id into sales from public.accounts where company_id = c1 and code = '4000';
  select id into tax from public.tax_codes where company_id = c1 and code = 'GST18';

  -- T25: with maker-checker enforced, even the Owner cannot approve the Owner's own journal
  jv := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date, 'narration', 'own', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.accounts where company_id = c1 and code = '1000'), 'debit', 10), jsonb_build_object('account_id', sales, 'credit', 10))));
  perform public.submit_journal(jv);
  begin
    perform public.approve_journal(jv, 'self');
    r := r || E'\nFAIL T25 owner approved own journal although maker-checker is enforced';
  exception when others then r := r || E'\nPASS T25 owner cannot approve own journal when maker-checker is enforced (' || sqlerrm || ')';
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  party := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'customer', 'display_name', 'Patch Test Customer')))->>'id')::uuid;
  inv := public.save_invoice(jsonb_build_object('company_id', c1, 'doc_type', 'sales_invoice', 'party_id', party, 'doc_date', current_date,
    'lines', jsonb_build_array(jsonb_build_object('account_id', sales, 'amount', 1000, 'tax_code_id', tax, 'description', 'x'))));

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.approve_invoice(inv);
  select journal_id into jv from public.invoices where id = inv;
  select sum(debit), sum(credit), count(*) filter (where party_id = party) into x, y, n from public.journal_lines where journal_id = jv;
  r := r || E'\n' || case when x = y and x = 1180 then 'PASS' else 'FAIL' end || ' T26 patched posting still balances (dr ' || x || ' cr ' || y || ')';
  r := r || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || ' T27 receivable line and revenue line both carry the party (' || n || ' lines); tax lines do not';
  select coalesce(sum(debit - credit), 0) into pl from public.party_ledger_balances(array[c1], current_date) where party_id = party;
  r := r || E'\n' || case when pl = 1180 then 'PASS' else 'FAIL' end || ' T28 party subledger unaffected by the analysis tag (balance ' || pl || ')';

  execute 'reset role';
  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', r;
end $t$;
