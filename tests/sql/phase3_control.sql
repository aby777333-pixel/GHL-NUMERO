-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · PHASE 3, PART 3 — REALITY AND CONTROL
-- Materiality, cases and their history, physical verification,
-- confirmation of balances, reclassification, allocation of cost.
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare
  a uuid := gen_random_uuid();   -- owner (Group Super Admin)
  b uuid := gen_random_uuid();   -- accountant: prepares
  d uuid := gen_random_uuid();   -- finance head: approves
  au uuid := gen_random_uuid();  -- auditor: verifies and confirms, changes nothing else
  e uuid := gen_random_uuid();   -- employee
  g uuid; c1 uuid; c2 uuid; r text := ''; v text; v2 text; v3 text; v4 text; ver0 uuid; n int; n2 int; x numeric; y numeric; z numeric; w numeric; j uuid; j2 uuid; id1 uuid; id2 uuid; id3 uuid;
  bank uuid; cash uuid; ar uuid; ic uuid; ic2 uuid; bank2 uuid; fa uuid; accd uuid; depx uuid; sales uuid; rent uuid; supplies uuid;
  fin uuid; ops uuid; mkt uuid; cust uuid; cat uuid; as1 uuid; as2 uuid; box uuid; al uuid; cs uuid; ver uuid; ln1 uuid; ln2 uuid; rline uuid; bline uuid; res jsonb;
  m1 date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@p9.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker@p9.numero.invalid'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checker@p9.numero.invalid'),
    (au, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'auditor@p9.numero.invalid'),
    (e, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@p9.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('P9', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','CTL','name','Control Test'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1010","name":"Petty Cash","type":"asset","subtype":"cash","control_type":"cash"},
      {"code":"1100","name":"AR","type":"asset","subtype":"receivable","control_type":"receivable"},
      {"code":"1190","name":"Due from Sister Co","type":"asset","subtype":"intercompany_receivable","control_type":"intercompany"},
      {"code":"1320","name":"Equipment","type":"asset","subtype":"fixed_asset"},
      {"code":"1390","name":"Accumulated Depreciation","type":"asset","subtype":"accumulated_depreciation"},
      {"code":"2000","name":"AP","type":"liability","subtype":"payable","control_type":"payable"},
      {"code":"4000","name":"Sales","type":"income","subtype":"revenue"},
      {"code":"6210","name":"Rent","type":"expense","subtype":"operating_expense"},
      {"code":"6240","name":"Office Supplies","type":"expense","subtype":"operating_expense"},
      {"code":"7100","name":"Depreciation","type":"expense","subtype":"depreciation"}]'::jsonb,
    'account_map', '{"ar_control":"1100","ap_control":"2000","intercompany_receivable":"1190"}'::jsonb,
    'tax_codes', '[]'::jsonb,
    'org_units', '[{"type_key":"department","code":"FIN","name":"Finance"},{"type_key":"department","code":"OPS","name":"Operations"},{"type_key":"department","code":"MKT","name":"Marketing"}]'::jsonb));
  c2 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','SIS','name','Sister Co'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"2180","name":"Due to Control Test","type":"liability","subtype":"intercompany_payable","control_type":"intercompany"},
      {"code":"4000","name":"Sales","type":"income","subtype":"revenue"}]'::jsonb,
    'account_map', '{"intercompany_payable":"2180"}'::jsonb, 'tax_codes', '[]'::jsonb, 'org_units', '[]'::jsonb));
  perform public.grant_membership('maker@p9.numero.invalid', c1, 'accountant');
  perform public.grant_membership('maker@p9.numero.invalid', c2, 'accountant');
  perform public.grant_membership('checker@p9.numero.invalid', c1, 'finance_head');
  perform public.grant_membership('checker@p9.numero.invalid', c2, 'finance_head');
  perform public.grant_membership('auditor@p9.numero.invalid', c1, 'auditor');
  perform public.grant_membership('staff@p9.numero.invalid', c1, 'employee');
  execute 'reset role';
  select id into bank from public.accounts where company_id = c1 and code = '1000';
  select id into cash from public.accounts where company_id = c1 and code = '1010';
  select id into ar from public.accounts where company_id = c1 and code = '1100';
  select id into ic from public.accounts where company_id = c1 and code = '1190';
  select id into fa from public.accounts where company_id = c1 and code = '1320';
  select id into accd from public.accounts where company_id = c1 and code = '1390';
  select id into depx from public.accounts where company_id = c1 and code = '7100';
  select id into sales from public.accounts where company_id = c1 and code = '4000';
  select id into rent from public.accounts where company_id = c1 and code = '6210';
  select id into supplies from public.accounts where company_id = c1 and code = '6240';
  select id into bank2 from public.accounts where company_id = c2 and code = '1000';
  select id into ic2 from public.accounts where company_id = c2 and code = '2180';
  update public.accounts set counterparty_company_id = c2 where id = ic;
  update public.accounts set counterparty_company_id = c1 where id = ic2;
  select id into fin from public.org_units where company_id = c1 and code = 'FIN';
  select id into ops from public.org_units where company_id = c1 and code = 'OPS';
  select id into mkt from public.org_units where company_id = c1 and code = 'MKT';

  -- the books to work on
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  cust := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'customer', 'display_name', 'Kovai Traders', 'force', true)))->>'id')::uuid;
  j := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', m1, 'voucher_type', 'journal', 'narration', 'Opening position', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', bank, 'debit', 1000000), jsonb_build_object('account_id', cash, 'debit', 5000),
    jsonb_build_object('account_id', ar, 'debit', 118000, 'party_id', cust), jsonb_build_object('account_id', fa, 'debit', 300000),
    jsonb_build_object('account_id', sales, 'credit', 1423000))));
  perform public.submit_journal(j);
  id1 := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', m1 + 5, 'voucher_type', 'journal', 'narration', 'Rent for the month', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', rent, 'debit', 12000, 'dims', jsonb_build_object('department', ops)),
    jsonb_build_object('account_id', rent, 'debit', 90000),
    jsonb_build_object('account_id', bank, 'credit', 102000))));
  perform public.submit_journal(id1);
  id2 := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', m1 + 6, 'voucher_type', 'journal', 'narration', 'Lent to Sister Co', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', ic, 'debit', 50000), jsonb_build_object('account_id', bank, 'credit', 50000))));
  perform public.submit_journal(id2);
  id3 := public.save_journal_draft(jsonb_build_object('company_id', c2, 'journal_date', m1 + 6, 'voucher_type', 'journal', 'narration', 'Received from Control Test', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', bank2, 'debit', 50000), jsonb_build_object('account_id', ic2, 'credit', 50000))));
  perform public.submit_journal(id3);
  cat := public.save_asset_category(jsonb_build_object('company_id', c1, 'name', 'Equipment', 'asset_account_id', fa, 'accum_account_id', accd, 'expense_account_id', depx, 'method', 'slm', 'life_months', 60));
  as1 := public.save_asset(jsonb_build_object('company_id', c1, 'name', 'Generator', 'category_id', cat, 'acquisition_date', m1, 'cost', 200000, 'location', 'Head office'));
  as2 := public.save_asset(jsonb_build_object('company_id', c1, 'name', 'Projector', 'category_id', cat, 'acquisition_date', m1, 'cost', 100000, 'location', 'Head office'));
  box := public.save_cash_box(jsonb_build_object('company_id', c1, 'name', 'HO petty cash', 'ledger_account_id', cash, 'float_amount', 5000));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok'); perform public.post_journal(j);
  perform public.approve_journal(id1, 'ok'); perform public.post_journal(id1);
  perform public.approve_journal(id2, 'ok'); perform public.post_journal(id2);
  perform public.approve_journal(id3, 'ok'); perform public.post_journal(id3);
  select id into rline from public.journal_lines where journal_id = id1 and debit = 12000;
  select id into bline from public.journal_lines where journal_id = id1 and credit = 102000;

  -- ------------------------------------------------------------ materiality
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.set_materiality(c1, 100, null, 'Test');
    r := r || E'\nFAIL T220 an employee set the materiality threshold';
  exception when others then r := r || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL' end || ' T220 the materiality threshold cannot be set without the permission';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.set_materiality(c1, 100, null, null);
    r := r || E'\nFAIL T221 a threshold was set without its basis';
  exception when others then
    perform public.set_materiality(c1, 100, null, 'Agreed with the auditors for this company');
    select amount into x from public.materiality where company_id = c1;
    r := r || E'\n' || case when x = 100 then 'PASS' else 'FAIL' end || ' T221 a threshold is set for the company, with its basis (' || x || ')';
  end;

  -- ------------------------------------------------------------ cases
  execute 'reset role';
  insert into public.alerts(company_id, kind, attention, title, explanation, dedupe_key)
  values (c1, 'test_alert', 'review', 'Payment split below the approval limit', 'Two payments to one vendor on one day.', 't-1') returning id into al;
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.open_case(jsonb_build_object('company_id', c1, 'kind', 'reality', 'title', 'X'));
    r := r || E'\nFAIL T222 an employee opened a case';
  exception when others then r := r || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL' end || ' T222 a case cannot be opened without the permission';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  cs := public.open_case(jsonb_build_object('company_id', c1, 'kind', 'reality', 'title', 'Order, receipt and payment do not agree', 'amount', 18000,
    'dedupe_key', 'po:1', 'finding', jsonb_build_object('document', 100, 'operation', 82, 'accounting', 100, 'cash', 100),
    'links', jsonb_build_array(jsonb_build_object('entity', 'journals', 'entity_id', id1, 'label', 'Rent entry'))));
  id3 := public.open_case(jsonb_build_object('company_id', c1, 'kind', 'reality', 'title', 'Found again', 'dedupe_key', 'po:1'));
  r := r || E'\n' || case when cs = id3 and (select count(*) from public.cases where company_id = c1) = 1 then 'PASS' else 'FAIL' end
         || ' T223 the same difference, found again, is the same case';
  v := '';
  begin perform public.update_case(jsonb_build_object('id', cs, 'status', 'investigating')); v := v || 'status without note;'; exception when others then null; end;
  perform public.update_case(jsonb_build_object('id', cs, 'status', 'investigating', 'note', 'Asked the warehouse for the receipt note', 'owner_name', 'Asha'));
  begin perform public.update_case(jsonb_build_object('id', cs, 'status', 'closed', 'note', 'Done')); v := v || 'closed without resolution;'; exception when others then null; end;
  perform public.update_case(jsonb_build_object('id', cs, 'status', 'substantiated', 'note', '18 units were short-delivered'));
  perform public.update_case(jsonb_build_object('id', cs, 'status', 'closed', 'note', 'Vendor issued a credit note', 'resolution', 'Credit note received for 18 units'));
  select count(*) into n from public.case_events where case_id = cs;
  select status into v from public.cases where id = cs;
  r := r || E'\n' || case when v = 'closed' and n = 5 then 'PASS' else 'FAIL' end
         || ' T224 a change of status needs its note and closing needs the resolution; the case is ' || v || ' with ' || n || ' events in its history';
  execute 'reset role';
  v := '';
  begin update public.case_events set note = 'rewritten' where case_id = cs; v := v || 'history rewritten;'; exception when others then null; end;
  begin delete from public.cases where id = cs; v := v || 'case deleted;'; exception when others then null; end;
  r := r || E'\n' || case when v = '' then 'PASS' else 'FAIL' end || ' T225 the history of a case cannot be rewritten and a case cannot be deleted, even by a privileged role ' || v;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id3 := public.open_case(jsonb_build_object('company_id', c1, 'kind', 'sentinel', 'title', 'Payments split', 'alert_id', al));
  select status into v from public.alerts where id = al;
  perform public.update_case(jsonb_build_object('id', id3, 'status', 'unsubstantiated', 'note', 'Two separate orders, each with its own approval'));
  r := r || E'\n' || case when v = 'reviewing' and (select status from public.alerts where id = al) = 'false_positive' then 'PASS' else 'FAIL' end
         || ' T226 an alert under a case is ' || v || '; when the case is found unsubstantiated the alert is closed as ' || (select status from public.alerts where id = al);

  -- ------------------------------------------------------------ verification of assets
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', au, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ver := public.open_verification(jsonb_build_object('company_id', c1, 'subject', 'assets', 'performed_by_name', 'Auditor', 'scope', jsonb_build_object('location', 'head office')));
  select count(*) into n from public.verification_lines where run_id = ver;
  select id into ln1 from public.verification_lines where run_id = ver and entity_id = as1;
  select id into ln2 from public.verification_lines where run_id = ver and entity_id = as2;
  begin
    perform public.record_verification(jsonb_build_object('run_id', ver, 'lines', jsonb_build_array(jsonb_build_object('id', ln2, 'result', 'missing'))));
    r := r || E'\nFAIL T227 an asset was reported missing without a word of what was found';
  exception when others then r := r || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || ' T227 the verification lists the ' || n || ' assets of the place; a result other than located needs its note';
  end;
  perform public.record_verification(jsonb_build_object('run_id', ver, 'lines', jsonb_build_array(
    jsonb_build_object('id', ln1, 'result', 'located'), jsonb_build_object('id', ln2, 'result', 'missing', 'note', 'Not in the meeting room; nobody knows where it went'))));
  res := public.complete_verification(ver, null);
  execute 'reset role';
  select count(*) into n from public.asset_events where company_id = c1 and event_type = 'verification';
  select count(*) into n2 from public.alerts where company_id = c1 and kind = 'verification_difference';
  select status into v from public.fixed_assets where id = as2;
  r := r || E'\n' || case when n = 2 and n2 = 1 and v = 'active' and (res->>'agree')::int = 1 and (res->>'differ')::int = 1 then 'PASS' else 'FAIL' end
         || ' T228 both assets carry the verification in their history; the missing one raised ' || n2 || ' alert and is still ' || v || ' in the books: a verification changes nothing';

  -- ------------------------------------------------------------ verification of cash
  perform set_config('request.jwt.claims', json_build_object('sub', au, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ver := public.open_verification(jsonb_build_object('company_id', c1, 'subject', 'cash', 'performed_by_name', 'Auditor'));
  select id, book_value into ln1, x from public.verification_lines where run_id = ver;
  begin
    perform public.complete_verification(ver, null);
    r := r || E'\nFAIL T229 a verification was completed with items not checked and no reason';
  exception when others then r := r || E'\nPASS T229 items left unchecked need a reason before the verification is completed';
  end;
  perform public.record_verification(jsonb_build_object('run_id', ver, 'lines', jsonb_build_array(jsonb_build_object('id', ln1, 'found_value', 4800, 'note', 'Two vouchers not yet entered'))));
  res := public.complete_verification(ver, null);
  execute 'reset role';
  select attention into v from public.alerts where company_id = c1 and kind = 'verification_difference' and entity = 'cash_boxes';
  select (evidence->>'difference')::numeric into y from public.alerts where company_id = c1 and kind = 'verification_difference' and entity = 'cash_boxes';
  select coalesce(sum(l.debit - l.credit), 0) into z from public.journal_lines l join public.journals jj on jj.id = l.journal_id where jj.status = 'posted' and l.account_id = cash;
  r := r || E'\n' || case when x = 5000 and y = -200 and v = 'priority' and z = 5000 then 'PASS' else 'FAIL' end
         || ' T230 cash in the books ' || x || ', found 4800: the difference of ' || y || ' is above the threshold of 100 and is raised as ' || v || '; the books still say ' || z;

  -- ------------------------------------------------------------ a sheet opened by mistake
  ver0 := ver;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', au, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ver := public.open_verification(jsonb_build_object('company_id', c1, 'subject', 'cash', 'performed_by_name', 'Auditor'));
  select id into ln1 from public.verification_lines where run_id = ver;
  perform public.record_verification(jsonb_build_object('run_id', ver, 'lines', jsonb_build_array(jsonb_build_object('id', ln1, 'found_value', 4000, 'note', 'Counted in haste'))));
  v := '';
  begin perform public.cancel_verification(ver, '  '); v := v || 'cancelled without a reason;'; exception when others then null; end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.cancel_verification(ver, 'Not mine'); v := v || 'cancelled by an employee;'; exception when others then if sqlstate <> '42501' then v := v || sqlstate || ';'; end if; end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', au, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.cancel_verification(ver, 'Opened for the wrong box');
  begin perform public.complete_verification(ver, 'x'); v := v || 'completed after it was cancelled;'; exception when others then null; end;
  begin perform public.record_verification(jsonb_build_object('run_id', ver, 'lines', jsonb_build_array(jsonb_build_object('id', ln1, 'found_value', 5000)))); v := v || 'changed after it was cancelled;'; exception when others then null; end;
  begin perform public.cancel_verification(ver0, 'Changed my mind'); v := v || 'a completed sheet was cancelled;'; exception when others then v4 := sqlerrm; end;
  execute 'reset role';
  select status, note into v2, v3 from public.verification_runs where id = ver;
  select count(*) into n from public.alerts where company_id = c1 and kind = 'verification_difference' and entity = 'cash_boxes';
  select count(*) into n2 from public.audit_log where entity = 'verification_runs' and entity_id = ver and reason = 'Opened for the wrong box';
  r := r || E'\n' || case when v = '' and v2 = 'cancelled' and v3 like '%Cancelled: Opened for the wrong box' and n = 1 and n2 >= 1 and v4 like '%What was completed stays%'
                               and (select found_value from public.verification_lines where id = ln1) = 4000 then 'PASS' else 'FAIL' end
         || ' T275 a sheet opened by mistake is ' || v2 || ' with its reason, keeps what was entered on it and raises nothing (' || n || ' alert, that of the completed sheet); a completed sheet stays ' || v;

  -- ------------------------------------------------------------ confirmation of balances
  perform set_config('request.jwt.claims', json_build_object('sub', au, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_confirmation(jsonb_build_object('company_id', c1, 'subject', 'customer', 'party_id', cust, 'as_of', current_date));
  select book_balance, status into x, v from public.confirmations where id = id1;
  begin
    perform public.update_confirmation(jsonb_build_object('id', id1, 'action', 'sent'));
    r := r || E'\nFAIL T231 a confirmation was marked as sent without saying how';
  exception when others then r := r || E'\n' || case when x = 118000 and v = 'drafted' then 'PASS' else 'FAIL' end || ' T231 the balance in the books (' || x || ') is worked out by NUMERO; sending is recorded with how it was sent';
  end;
  perform public.update_confirmation(jsonb_build_object('id', id1, 'action', 'sent', 'sent_how', 'Letter by email to accounts@kovai', 'contact', 'Mr Senthil'));
  v := public.update_confirmation(jsonb_build_object('id', id1, 'action', 'reply', 'confirmed_balance', 100000));
  select difference into y from public.confirmations where id = id1;
  begin
    perform public.update_confirmation(jsonb_build_object('id', id1, 'action', 'explained'));
    r := r || E'\nFAIL T232 a difference was marked explained without an explanation';
  exception when others then
    perform public.update_confirmation(jsonb_build_object('id', id1, 'action', 'explained', 'explanation', 'Receipt of 18000 of the last day is in transit'));
    execute 'reset role';
    select count(*) into n from public.alerts where company_id = c1 and kind = 'confirmation_difference';
    r := r || E'\n' || case when v = 'difference' and y = -18000 and n = 1 and (select status from public.confirmations where id = id1) = 'explained' then 'PASS' else 'FAIL' end
           || ' T232 the customer confirms 100000: a ' || v || ' of ' || y || ' is raised once, and explained by a person';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_confirmation(jsonb_build_object('company_id', c1, 'subject', 'intercompany', 'counter_company_id', c2, 'as_of', current_date));
  select book_balance, confirmed_balance, status into x, y, v from public.confirmations where id = id1;
  id2 := public.save_journal_draft(jsonb_build_object('company_id', c2, 'journal_date', current_date, 'voucher_type', 'journal', 'narration', 'Charge from Control Test recorded here only', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.accounts where company_id = c2 and code = '4000'), 'debit', 10000), jsonb_build_object('account_id', ic2, 'credit', 10000))));
  perform public.submit_journal(id2);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(id2, 'ok'); perform public.post_journal(id2);
  id2 := public.save_confirmation(jsonb_build_object('company_id', c1, 'subject', 'intercompany', 'counter_company_id', c2, 'as_of', current_date));
  select confirmed_balance, difference into z, w from public.confirmations where id = id2;
  r := r || E'\n' || case when x = 50000 and y = 50000 and v = 'agreed' and z = 60000 and w = 10000 and (select status from public.confirmations where id = id2) = 'difference' then 'PASS' else 'FAIL' end
         || ' T233 between companies of the group the other side is read from its own books: ' || x || ' against ' || y || ' is ' || v || '; after an entry on one side only, ' || z || ' differs by ' || w;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', au, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_confirmation(jsonb_build_object('company_id', c1, 'subject', 'intercompany', 'counter_company_id', c2, 'as_of', current_date));
  select confirmed_balance, status into x, v from public.confirmations where id = id1;
  r := r || E'\n' || case when x is null and v = 'drafted' then 'PASS' else 'FAIL' end
         || ' T234 a person with no access to the other company is not shown its balance: the confirmation is ' || v;

  -- ------------------------------------------------------------ reclassification
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  v := '';
  begin perform public.propose_reclassification(jsonb_build_object('line_id', bline, 'to_account_id', cash, 'reason', 'Paid in cash')); v := v || 'bank line moved;'; exception when others then null; end;
  begin perform public.propose_reclassification(jsonb_build_object('line_id', rline, 'to_account_id', supplies)); v := v || 'no reason;'; exception when others then null; end;
  j := public.propose_reclassification(jsonb_build_object('line_id', rline, 'to_account_id', supplies, 'amount', 5000, 'reason', 'Stationery billed with the rent'));
  begin perform public.propose_reclassification(jsonb_build_object('line_id', rline, 'to_account_id', supplies, 'amount', 8000, 'reason', 'More')); v := v || 'more than the line;'; exception when others then null; end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  execute 'reset role';
  select debit into x from public.journal_lines where id = rline and account_id = rent;
  select coalesce(sum(l.debit - l.credit), 0) into y from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where jj.status = 'posted' and l.account_id = supplies and exists (select 1 from public.journal_line_dims dd where dd.line_id = l.id and dd.org_unit_id = ops);
  select count(*) into n2 from public.reclassifications where line_id = rline and status = 'posted' and reason <> '' and requested_by = b and new_journal_id = j;
  r := r || E'\n' || case when v = '' and x = 12000 and y = 5000 and n2 = 1 then 'PASS' else 'FAIL' end
         || ' T235 the original line still reads ' || x || ' in rent; ' || y || ' now stands in office supplies for the same department; the reason, the person and both entries are on record ' || v;

  -- ------------------------------------------------------------ allocation
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_allocation(jsonb_build_object('company_id', c1, 'name', 'Rent', 'period_from', m1, 'period_to', current_date, 'source_account_id', rent, 'dimension_type', 'department',
      'amount', 95000, 'driver', 'headcount', 'recipients', jsonb_build_array(jsonb_build_object('org_unit_id', fin, 'driver_value', 2))));
    r := r || E'\nFAIL T236 more was shared out than the ledger holds';
  exception when others then r := r || E'\nPASS T236 no more can be shared out than the ledger holds without a department (90000)';
  end;
  id1 := public.save_allocation(jsonb_build_object('company_id', c1, 'name', 'Head office rent', 'period_from', m1, 'period_to', current_date, 'source_account_id', rent, 'dimension_type', 'department',
    'amount', 90000, 'driver', 'headcount', 'driver_note', 'Headcount on the last day of the month',
    'recipients', jsonb_build_array(jsonb_build_object('org_unit_id', fin, 'driver_value', 2), jsonb_build_object('org_unit_id', ops, 'driver_value', 5), jsonb_build_object('org_unit_id', mkt, 'driver_value', 3))));
  select string_agg(x2->>'amount', '/' order by ord) into v from public.allocations al2, jsonb_array_elements(al2.recipients) with ordinality q(x2, ord) where al2.id = id1;
  j := public.propose_allocation(id1);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  execute 'reset role';
  select coalesce(sum(l.debit - l.credit), 0) into x from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where jj.status = 'posted' and l.account_id = rent and not exists (select 1 from public.journal_line_dims dd where dd.line_id = l.id);
  select coalesce(sum(l.debit - l.credit), 0) into y from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where jj.status = 'posted' and l.account_id = rent and exists (select 1 from public.journal_line_dims dd where dd.line_id = l.id and dd.org_unit_id = ops);
  select coalesce(sum(l.debit - l.credit), 0) into z from public.journal_lines l join public.journals jj on jj.id = l.journal_id where jj.status = 'posted' and l.account_id = rent;
  r := r || E'\n' || case when v = '18000.00/45000.00/27000.00' and x = 0 and y = 52000 and z = 97000 and (select formula <> '' and status = 'posted' from public.allocations where id = id1) then 'PASS' else 'FAIL' end
         || ' T237 90000 of rent shared by headcount 2:5:3 gives ' || v || '; nothing is left without a department, operations carries ' || y || ', and rent as a whole is unchanged by the sharing (' || z || ')';

  -- ------------------------------------------------------------ integrity
  select count(*) into n from public.journals jj where jj.status = 'posted'
     and (select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) from public.journal_lines where journal_id = jj.id) <> 0;
  select count(*) into n2 from public.journals jj where jj.status = 'posted';
  r := r || E'\n' || case when n = 0 and n2 >= 7 then 'PASS' else 'FAIL' end || ' T238 every one of the ' || n2 || ' posted entries balances';
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname in ('wf_reclassification', 'wf_allocation', 'is_material', 'case_perm', 'ledger_balance_at', 'raise_confirmation_alert', 'guard_case', 'guard_case_event')
     and has_function_privilege('authenticated', p.oid, 'execute');
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T239 the internal control functions cannot be called by a signed-in user (' || n || ' callable)';

  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', coalesce(r, ' <results lost: a value was null>');
end $t$;
