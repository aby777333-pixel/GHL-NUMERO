-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · PHASE 2, PART 1
-- Workflow posting engine, fixed assets, advances, expense claims, cash,
-- fund transfers, documents, registers, reversal of documents, privileges.
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare
  a uuid := gen_random_uuid();   -- owner (Group Super Admin)
  b uuid := gen_random_uuid();   -- accountant: prepares
  d uuid := gen_random_uuid();   -- finance head: approves accounting entries
  e uuid := gen_random_uuid();   -- employee: sees only their own
  g uuid; c1 uuid; c2 uuid; r text := ''; v text; n int; x numeric; y numeric; j uuid; j2 uuid; id1 uuid; id2 uuid; id3 uuid;
  bank uuid; cash uuid; adv_acc uuid; travel uuid; sales uuid; fa_acc uuid; acc_dep uuid; dep_exp uuid; plain uuid;
  emp uuid; cust uuid; cat uuid; asset uuid; run1 uuid; run2 uuid; adv uuid; claim uuid; box uuid; dept uuid; inv uuid; pay uuid; res jsonb;
  m1 date := (date_trunc('month', current_date) - interval '2 month')::date;
  m2 date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@p2.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker@p2.numero.invalid'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checker@p2.numero.invalid'),
    (e, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'employee@p2.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('P2', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','P1','name','Phase Two One'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1010","name":"Petty Cash","type":"asset","subtype":"cash","control_type":"cash"},
      {"code":"1100","name":"AR","type":"asset","subtype":"receivable","control_type":"receivable"},
      {"code":"1155","name":"Employee Advances","type":"asset","subtype":"advance","control_type":"advance_paid"},
      {"code":"1190","name":"Due from group","type":"asset","subtype":"intercompany_receivable","control_type":"intercompany"},
      {"code":"1350","name":"Computers","type":"asset","subtype":"fixed_asset"},
      {"code":"1390","name":"Accumulated Depreciation","type":"asset","subtype":"accumulated_depreciation"},
      {"code":"2000","name":"AP","type":"liability","subtype":"payable","control_type":"payable"},
      {"code":"2165","name":"Reimbursements Payable","type":"liability","subtype":"employee_payable"},
      {"code":"2180","name":"Due to group","type":"liability","subtype":"intercompany_payable","control_type":"intercompany"},
      {"code":"4000","name":"Sales","type":"income","subtype":"revenue"},
      {"code":"6410","name":"Travel","type":"expense","subtype":"operating_expense"},
      {"code":"7100","name":"Depreciation","type":"expense","subtype":"depreciation"},
      {"code":"7330","name":"Disposal gain or loss","type":"expense","subtype":"exceptional"},
      {"code":"7340","name":"Impairment","type":"expense","subtype":"exceptional"}]'::jsonb,
    'account_map', '{"ar_control":"1100","ap_control":"2000","employee_advances":"1155","employee_payable":"2165","asset_disposal":"7330","asset_impairment":"7340","intercompany_receivable":"1190","intercompany_payable":"2180"}'::jsonb,
    'tax_codes', '[]'::jsonb,
    'org_units', '[{"type_key":"department","code":"FIN","name":"Finance"}]'::jsonb));
  c2 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','P2','name','Phase Two Two'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1190","name":"Due from group","type":"asset","subtype":"intercompany_receivable","control_type":"intercompany"},
      {"code":"2180","name":"Due to group","type":"liability","subtype":"intercompany_payable","control_type":"intercompany"}]'::jsonb,
    'account_map', '{"intercompany_receivable":"1190","intercompany_payable":"2180"}'::jsonb, 'tax_codes', '[]'::jsonb));
  perform public.grant_membership('maker@p2.numero.invalid', c1, 'accountant');
  perform public.grant_membership('maker@p2.numero.invalid', c2, 'accountant');
  perform public.grant_membership('checker@p2.numero.invalid', c1, 'finance_head');
  perform public.grant_membership('checker@p2.numero.invalid', c2, 'finance_head');
  perform public.grant_membership('employee@p2.numero.invalid', c1, 'employee');
  select id into bank from public.accounts where company_id = c1 and code = '1000';
  select id into cash from public.accounts where company_id = c1 and code = '1010';
  select id into adv_acc from public.accounts where company_id = c1 and code = '1155';
  select id into travel from public.accounts where company_id = c1 and code = '6410';
  select id into sales from public.accounts where company_id = c1 and code = '4000';
  select id into fa_acc from public.accounts where company_id = c1 and code = '1350';
  select id into acc_dep from public.accounts where company_id = c1 and code = '1390';
  select id into dep_exp from public.accounts where company_id = c1 and code = '7100';
  select id into dept from public.org_units where company_id = c1 and code = 'FIN';

  -- T29 phase 2 roles and permissions are seeded
  select count(*) into n from public.roles ro join public.role_permissions rp on rp.role_id = ro.id
   where ro.group_id = g and ((ro.key = 'payroll_officer' and rp.permission = 'payroll.manage')
      or (ro.key = 'accountant' and rp.permission = 'asset.manage') or (ro.key = 'employee' and rp.permission = 'expense.create'));
  select count(*) into x from public.roles ro join public.role_permissions rp on rp.role_id = ro.id
   where ro.group_id = g and ro.key in ('accountant','finance_head','auditor','company_director') and rp.permission like 'payroll.%';
  r := r || E'\n' || case when n = 3 and x = 0 then 'PASS' else 'FAIL' end || ' T29 phase 2 permissions seeded; payroll is not granted to finance roles by default (' || n || ', ' || x || ')';

  -- opening money so that later postings have something to move
  j := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', m1, 'voucher_type', 'opening', 'narration', 'Opening', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', bank, 'debit', 1000000), jsonb_build_object('account_id', cash, 'debit', 20000),
    jsonb_build_object('account_id', fa_acc, 'debit', 120000), jsonb_build_object('account_id', sales, 'credit', 1140000))));
  perform public.submit_journal(j);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok'); perform public.post_journal(j);

  -- ------------------------------------------------------------ fixed assets
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  cat := public.save_asset_category(jsonb_build_object('company_id', c1, 'name', 'Computers', 'asset_account_id', fa_acc,
    'accum_account_id', acc_dep, 'expense_account_id', dep_exp, 'method', 'slm', 'life_months', 60));
  asset := public.save_asset(jsonb_build_object('company_id', c1, 'name', 'Server', 'category_id', cat, 'acquisition_date', m1,
    'cost', 120000, 'org_unit_id', dept));
  run1 := public.create_depreciation_run(c1, m1);
  select total, asset_count into x, n from public.depreciation_runs where id = run1;
  r := r || E'\n' || case when x = 2000 and n = 1 then 'PASS' else 'FAIL' end || ' T30 straight-line depreciation: 120000 over 60 months = ' || x || ' for the month';

  j := public.propose_depreciation_run(run1);
  select status into v from public.journals where id = j;
  select count(*) into n from public.journals where status = 'posted' and source = 'depreciation';
  r := r || E'\n' || case when v = 'submitted' and n = 0 then 'PASS' else 'FAIL' end || ' T31 an operation only PROPOSES: journal is ' || v || ', nothing posted';

  begin
    perform public.approve_journal(j, 'self');
    r := r || E'\nFAIL T32 maker approved the journal the maker proposed';
  exception when others then r := r || E'\nPASS T32 the person who proposed cannot approve (' || left(sqlerrm, 70) || ')';
  end;
  begin
    perform public.save_journal_draft(jsonb_build_object('id', j, 'company_id', c1, 'journal_date', m1, 'lines', jsonb_build_array(
      jsonb_build_object('account_id', dep_exp, 'debit', 5), jsonb_build_object('account_id', acc_dep, 'credit', 5))));
    r := r || E'\nFAIL T33 workflow journal was edited by hand';
  exception when others then r := r || E'\nPASS T33 a workflow journal cannot be edited by hand';
  end;
  begin
    perform public.create_depreciation_run(c1, m2);
    r := r || E'\nFAIL T34 next month was calculated while the earlier month was unposted';
  exception when others then r := r || E'\nPASS T34 months are depreciated in order (' || left(sqlerrm, 60) || ')';
  end;

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  v := public.approve_journal(j, 'checked');
  select accumulated_depreciation into x from public.fixed_assets where id = asset;
  select status into v from public.journals where id = j;
  r := r || E'\n' || case when v = 'posted' and x = 2000 and (select status from public.depreciation_runs where id = run1) = 'posted' then 'PASS' else 'FAIL' end
         || ' T35 final approval posts the journal and updates the source (journal ' || v || ', accumulated ' || x || ')';
  select sum(debit), sum(credit) into x, y from public.journal_lines where journal_id = j;
  select count(*) into n from public.journal_line_dims dm join public.journal_lines l on l.id = dm.line_id where l.journal_id = j and dm.org_unit_id = dept;
  r := r || E'\n' || case when x = y and x = 2000 and n = 1 then 'PASS' else 'FAIL' end || ' T36 depreciation journal balances and carries the department';

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  run2 := public.create_depreciation_run(c1, m2);
  j2 := public.propose_depreciation_run(run2);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j2, 'ok');
  begin
    perform public.reverse_journal(j, current_date, 'test');
    r := r || E'\nFAIL T37 an earlier depreciation month was reversed while a later one stands';
  exception when others then r := r || E'\nPASS T37 earlier month cannot be reversed while a later month stands';
  end;
  perform public.reverse_journal(j2, current_date, 'wrong month');
  select accumulated_depreciation into x from public.fixed_assets where id = asset;
  r := r || E'\n' || case when x = 2000 and (select status from public.depreciation_runs where id = run2) = 'reversed' then 'PASS' else 'FAIL' end
         || ' T38 reversing the journal reverses the source record (accumulated back to ' || x || ')';

  -- disposal: cost 120000, accumulated 2000, sold for 100000 => loss 18000
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.propose_asset_disposal(jsonb_build_object('asset_id', asset, 'date', current_date, 'kind', 'sale', 'proceeds', 100000, 'bank_ledger_id', sales, 'reason', 'x'));
    r := r || E'\nFAIL T39 a revenue ledger was accepted as the bank ledger';
  exception when others then r := r || E'\nPASS T39 a ledger that is not bank or cash is refused (' || left(sqlerrm, 60) || ')';
  end;
  j := public.propose_asset_disposal(jsonb_build_object('asset_id', asset, 'date', current_date, 'kind', 'sale', 'proceeds', 100000, 'bank_ledger_id', bank, 'reason', 'Replaced'));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select sum(debit), sum(credit) into x, y from public.journal_lines where journal_id = j;
  r := r || E'\n' || case when x = y and x = 120000 and (select status from public.fixed_assets where id = asset) = 'disposed' then 'PASS' else 'FAIL' end
         || ' T40 disposal removes cost and accumulated depreciation and balances (' || x || ')';
  select l.debit into x from public.journal_lines l join public.accounts ac on ac.id = l.account_id where l.journal_id = j and ac.code = '7330';
  r := r || E'\n' || case when x = 18000 then 'PASS' else 'FAIL' end || ' T41 loss on disposal = book value 118000 − proceeds 100000 = ' || x;

  -- ------------------------------------------------------------ advances
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  emp := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'employee', 'kind', 'person', 'display_name', 'Test Traveller')))->>'id')::uuid;
  cust := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'customer', 'display_name', 'Limit Customer', 'credit_limit', 1000)))->>'id')::uuid;
  adv := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', emp, 'purpose', 'Site visit', 'requested_amount', 120000,
    'dims', jsonb_build_object('department', dept)));
  perform public.submit_advance(adv);
  begin
    perform public.release_advance(jsonb_build_object('advance_id', adv, 'amount', 1000, 'bank_ledger_id', bank, 'date', current_date));
    r := r || E'\nFAIL T42 money was released before approval';
  exception when others then r := r || E'\nPASS T42 an advance cannot be released before it is approved';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  v := public.approve_advance(adv, 100000, 'Reduced to the estimate');
  select count(*) into n from public.journals where source = 'advance_release';
  r := r || E'\n' || case when v = 'approved' and n = 0 and (select approved_amount from public.advances where id = adv) = 100000 then 'PASS' else 'FAIL' end
         || ' T43 approval authorises 100000 of the 120000 requested and moves no money';

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.release_advance(jsonb_build_object('advance_id', adv, 'amount', 100001, 'bank_ledger_id', bank, 'date', current_date));
    r := r || E'\nFAIL T44 more than the approved amount was released';
  exception when others then r := r || E'\nPASS T44 release cannot exceed the approved amount';
  end;
  begin
    perform public.release_advance(jsonb_build_object('advance_id', adv, 'amount', 100, 'bank_ledger_id', travel, 'date', current_date));
    r := r || E'\nFAIL T45 an expense ledger was accepted as the source of money';
  exception when others then r := r || E'\nPASS T45 release must come from a bank or cash ledger (ledger without control type refused)';
  end;
  j := public.release_advance(jsonb_build_object('advance_id', adv, 'amount', 100000, 'bank_ledger_id', bank, 'date', current_date, 'reference', 'UTR1'));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select released_amount into x from public.advances where id = adv;
  select coalesce(sum(debit - credit), 0) into y from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where l.account_id = adv_acc and l.party_id = emp and jj.status = 'posted';
  r := r || E'\n' || case when x = 100000 and y = 100000 and (select status from public.advances where id = adv) = 'released' then 'PASS' else 'FAIL' end
         || ' T46 released advance sits in the advances ledger against the person, not in expenses (' || y || ')';
  select coalesce(sum(debit - credit), 0) into x from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where l.account_id = travel and jj.status = 'posted';
  r := r || E'\n' || case when x = 0 then 'PASS' else 'FAIL' end || ' T47 ADVANCE IS NOT EXPENSE: travel expense is still ' || x;

  -- ------------------------------------------------------------ expense claim settling the advance
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_expense_category(jsonb_build_object('company_id', c1, 'name', 'Hotel', 'account_id', travel, 'limit_per_item', 20000, 'receipt_required_above', 500));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  claim := public.save_claim(jsonb_build_object('company_id', c1, 'claimant_party_id', emp, 'title', 'Site visit', 'advance_id', adv, 'final_settlement', true,
    'lines', jsonb_build_array(
      jsonb_build_object('expense_date', current_date - 3, 'account_id', travel, 'description', 'Flights', 'amount', 42000, 'has_receipt', true),
      jsonb_build_object('expense_date', current_date - 3, 'category_id', id1, 'description', 'Hotel', 'amount', 28000, 'has_receipt', true),
      jsonb_build_object('expense_date', current_date - 2, 'category_id', id1, 'description', 'Meals', 'amount', 8000))));
  select total, flagged_lines into x, n from public.expense_claims where id = claim;
  r := r || E'\n' || case when x = 78000 and n >= 2 then 'PASS' else 'FAIL' end || ' T48 policy flags are recorded, the claim is not rejected (total ' || x || ', ' || n || ' flagged lines)';
  select string_agg(f, ' | ') into v from public.expense_claim_lines l, unnest(l.flags) f where l.claim_id = claim and l.description = 'Hotel';
  r := r || E'\n' || case when v like 'OUTSIDE POLICY%' then 'PASS' else 'FAIL' end || ' T49 hotel above the limit is flagged: ' || coalesce(v, 'none');
  perform public.submit_claim(claim);

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.approve_claim(claim, null, null);
    r := r || E'\nFAIL T50 flagged claim approved without a reason';
  exception when others then r := r || E'\nPASS T50 approving flagged lines requires the approver''s reason';
  end;
  v := public.approve_claim(claim, 'Hotel rate was the only one available; meals confirmed by site manager', null);
  select journal_id, advance_applied, payable into j, x, y from public.expense_claims where id = claim;
  r := r || E'\n' || case when v = 'approved' and x = 78000 and y = 0 and (select status from public.journals where id = j) = 'submitted' then 'PASS' else 'FAIL' end
         || ' T51 claim approval proposes the entry: 78000 against the advance, nothing payable';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select settled_amount, status into x, v from public.advances where id = adv;
  r := r || E'\n' || case when x = 78000 and v = 'return_due' then 'PASS' else 'FAIL' end || ' T52 partial settlement: 78000 settled, 22000 RETURN DUE (status ' || v || ')';

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.return_advance(jsonb_build_object('advance_id', adv, 'amount', 22001, 'bank_ledger_id', bank, 'date', current_date));
    r := r || E'\nFAIL T53 more than the unsettled balance was returned';
  exception when others then r := r || E'\nPASS T53 a return cannot exceed the unsettled balance';
  end;
  j := public.return_advance(jsonb_build_object('advance_id', adv, 'amount', 22000, 'bank_ledger_id', bank, 'date', current_date));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select status into v from public.advances where id = adv;
  select coalesce(sum(debit - credit), 0) into y from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where l.account_id = adv_acc and l.party_id = emp and jj.status = 'posted';
  r := r || E'\n' || case when v = 'settled' and y = 0 then 'PASS' else 'FAIL' end || ' T54 after the return the advance is settled and the person''s advance balance is ' || y;

  -- excess expense: advance 10000, claim 11500 => 1500 reimbursement due
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id2 := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', emp, 'purpose', 'Second trip', 'requested_amount', 10000));
  perform public.submit_advance(id2);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_advance(id2, null, 'ok');
  select new_value->>'recipient_open_advances' into v from public.audit_log where entity = 'advances' and entity_id = id2 and action = 'approved';
  r := r || E'\n' || case when v is not null then 'PASS' else 'FAIL' end || ' T55 the recipient''s open advances are recorded with the approval decision (' || coalesce(v, '?') || ' open)';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.release_advance(jsonb_build_object('advance_id', id2, 'amount', 10000, 'bank_ledger_id', cash, 'date', current_date));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id3 := public.save_claim(jsonb_build_object('company_id', c1, 'claimant_party_id', emp, 'title', 'Second trip', 'advance_id', id2,
    'lines', jsonb_build_array(jsonb_build_object('expense_date', current_date - 1, 'account_id', travel, 'description', 'Taxi and train', 'amount', 11500, 'has_receipt', true))));
  perform public.submit_claim(id3);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_claim(id3, 'Weekend travel was required', null);
  select journal_id into j from public.expense_claims where id = id3;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select payable, status into x, v from public.expense_claims where id = id3;
  r := r || E'\n' || case when x = 1500 and v = 'posted' then 'PASS' else 'FAIL' end || ' T56 excess expense: 1500 REIMBURSEMENT DUE, claim is payable (' || v || ')';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j2 := public.pay_claim(jsonb_build_object('claim_id', id3, 'bank_ledger_id', bank, 'date', current_date));
  begin
    execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
    perform public.reverse_journal(j, current_date, 'test');
    r := r || E'\nFAIL T57 claim entry reversed while its reimbursement awaits approval';
  exception when others then r := r || E'\nPASS T57 a claim cannot be reversed while its reimbursement is awaiting approval';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j2, 'ok');
  select status into v from public.expense_claims where id = id3;
  select coalesce(sum(credit - debit), 0) into x from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where l.account_id = (select id from public.accounts where company_id = c1 and code = '2165') and jj.status = 'posted';
  r := r || E'\n' || case when v = 'paid' and x = 0 then 'PASS' else 'FAIL' end || ' T58 reimbursement settles the claim; reimbursements payable is ' || x;

  -- ------------------------------------------------------------ row level security: a person sees only their own
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.expense_claims;
  select count(*) into x from public.advances;
  id1 := public.save_claim(jsonb_build_object('company_id', c1, 'claimant_party_id', emp, 'title', 'Own claim',
    'lines', jsonb_build_array(jsonb_build_object('expense_date', current_date - 1, 'account_id', travel, 'description', 'Parking', 'amount', 200, 'has_receipt', true))));
  select count(*) into y from public.expense_claims;
  r := r || E'\n' || case when n = 0 and x = 0 and y = 1 then 'PASS' else 'FAIL' end || ' T59 an employee sees no one else''s claims or advances, only their own (' || n || ', ' || x || ', ' || y || ')';
  begin
    perform public.approve_claim(claim, 'x', null);
    r := r || E'\nFAIL T60 employee approved a claim';
  exception when others then r := r || E'\nPASS T60 an employee cannot approve claims';
  end;
  select count(*) into n from public.fixed_assets;
  select count(*) into x from public.journals;
  r := r || E'\n' || case when n = 0 and x = 0 then 'PASS' else 'FAIL' end || ' T61 an employee sees no assets and no journals';

  -- ------------------------------------------------------------ cash count
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  box := public.save_cash_box(jsonb_build_object('company_id', c1, 'name', 'HO petty cash', 'ledger_account_id', cash, 'float_amount', 20000, 'min_balance', 5000));
  res := public.record_cash_count(jsonb_build_object('box_id', box, 'count_date', current_date,
    'denominations', '{"500": 18, "100": 8, "50": 2}'::jsonb, 'note', 'Surprise count'));
  r := r || E'\n' || case when (res->>'counted_total')::numeric = 9900 and (res->>'book_balance')::numeric = 10000 and (res->>'difference')::numeric = -100 then 'PASS' else 'FAIL' end
         || ' T62 cash count: counted ' || (res->>'counted_total') || ', books ' || (res->>'book_balance') || ', difference ' || (res->>'difference');
  execute 'reset role';
  select count(*) into n from public.alerts where kind = 'cash_count_difference' and company_id = c1;
  begin
    update public.cash_counts set counted_total = 10000 where id = (res->>'id')::uuid;
    r := r || E'\nFAIL T63 a cash count was altered';
  exception when others then r := r || E'\nPASS T63 a cash count cannot be altered afterwards; the difference raised ' || n || ' factual alert';
  end;

  -- ------------------------------------------------------------ fund transfers
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.propose_fund_transfer(jsonb_build_object('company_id', c1, 'from_ledger_id', bank, 'to_ledger_id', cash, 'amount', 5000,
    'transfer_date', current_date, 'purpose', 'Petty cash top-up'));
  select journal_id, kind into j, v from public.fund_transfers where id = id1;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select coalesce(sum(debit - credit), 0) into x from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where l.account_id in (select id from public.accounts where company_id = c1 and type in ('income','expense')) and jj.id = j;
  r := r || E'\n' || case when v = 'cash_withdrawal' and x = 0 and (select status from public.fund_transfers where id = id1) = 'posted' then 'PASS' else 'FAIL' end
         || ' T64 an internal transfer moves money between pockets and touches neither income nor expense';

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id2 := public.propose_fund_transfer(jsonb_build_object('company_id', c1, 'to_company_id', c2, 'from_ledger_id', bank,
    'to_ledger_id', (select id from public.accounts where company_id = c2 and code = '1000'), 'amount', 50000,
    'transfer_date', current_date, 'purpose', 'Working capital support'));
  select journal_id, to_journal_id into j, j2 from public.fund_transfers where id = id2;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select status into v from public.fund_transfers where id = id2;
  perform public.reject_journal(j2, 'Receiving company did not get the money');
  execute 'reset role';
  select count(*) into n from public.alerts where kind = 'intercompany_one_sided';
  r := r || E'\n' || case when v = 'part_posted' and n = 1 and (select status from public.fund_transfers where id = id2) = 'rejected' then 'PASS' else 'FAIL' end
         || ' T65 intercompany transfer has two entries; when only one side stands, a priority alert says so';

  -- ------------------------------------------------------------ documents
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  res := public.register_document(jsonb_build_object('company_id', c1, 'name', 'hotel.pdf', 'sha256', repeat('ab', 32),
    'storage_path', c1::text || '/x-hotel.pdf', 'size_bytes', 1200, 'entity', 'expense_claims', 'entity_id', claim));
  id1 := (res->>'id')::uuid;
  res := public.register_document(jsonb_build_object('company_id', c1, 'name', 'hotel-copy.pdf', 'sha256', repeat('ab', 32),
    'storage_path', c1::text || '/y-hotel.pdf', 'size_bytes', 1200));
  r := r || E'\n' || case when jsonb_array_length(res->'possible_duplicates') = 1 and (select duplicate_of from public.documents where id = (res->>'id')::uuid) = id1 then 'PASS' else 'FAIL' end
         || ' T66 an identical file is kept and flagged POSSIBLE DUPLICATE, never discarded';
  begin
    perform public.register_document(jsonb_build_object('company_id', c1, 'name', 'z.pdf', 'sha256', repeat('cd', 32), 'storage_path', c2::text || '/z.pdf'));
    r := r || E'\nFAIL T67 a file in another company''s folder was registered';
  exception when others then r := r || E'\nPASS T67 a document must sit in its own company''s folder';
  end;
  execute 'reset role';
  begin
    delete from public.documents where id = id1;
    r := r || E'\nFAIL T68 a document was deleted';
  exception when others then r := r || E'\nPASS T68 documents are evidence and cannot be deleted';
  end;
  begin
    update public.documents set sha256 = repeat('ef', 32) where id = id1;
    r := r || E'\nFAIL T69 a document fingerprint was altered';
  exception when others then r := r || E'\nPASS T69 the recorded facts of a document cannot be altered';
  end;

  -- ------------------------------------------------------------ registers
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'vehicle', 'title', 'Innova', 'data', '{}'::jsonb));
    r := r || E'\nFAIL T70 vehicle saved without its registration number';
  exception when others then r := r || E'\nPASS T70 required fields of a register kind are enforced (' || left(sqlerrm, 70) || ')';
  end;
  id1 := public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'vehicle', 'title', 'Innova TN-01-AB-1234',
    'data', jsonb_build_object('registration_no', 'TN01AB1234', 'insurance_expiry', (current_date + 20)::text)));
  select ref_no, org_unit_id into v, id2 from public.register_items where id = id1;
  select count(*) into n from public.org_units where id = id2 and type_key = 'vehicle' and code = v;
  r := r || E'\n' || case when v = 'VEH-00001' and n = 1 then 'PASS' else 'FAIL' end || ' T71 a vehicle gets its reference ' || v || ' and its own cost-tracking dimension';
  id2 := public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'subscription', 'title', 'CRM', 'amount', 12000, 'frequency', 'monthly',
    'start_date', current_date, 'account_id', travel, 'auto_renew', true));
  select certainty into v from public.register_items where id = id2;
  r := r || E'\n' || case when v = 'scheduled' then 'PASS' else 'FAIL' end || ' T72 a subscription defaults to certainty SCHEDULED';
  select count(*) into n from public.register_kinds;
  r := r || E'\n' || case when n >= 50 then 'PASS' else 'FAIL' end || ' T73 ' || n || ' register kinds are available as data';

  -- ------------------------------------------------------------ reversal keeps documents truthful (phase 1 gap closed)
  inv := public.save_invoice(jsonb_build_object('company_id', c1, 'doc_type', 'sales_invoice', 'party_id', cust, 'doc_date', current_date,
    'lines', jsonb_build_array(jsonb_build_object('account_id', sales, 'amount', 5000, 'description', 'Service'))));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_invoice(inv);
  execute 'reset role';
  select count(*) into n from public.alerts where kind = 'credit_limit_exceeded' and entity_id = inv;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' T74 credit control: invoice beyond the configured limit is recorded and flagged, not blocked';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  pay := public.save_payment(jsonb_build_object('company_id', c1, 'direction', 'in', 'party_id', cust, 'bank_ledger_id', bank, 'pay_date', current_date,
    'amount', 2000, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', inv, 'amount', 2000))));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_payment(pay);
  select journal_id into j from public.invoices where id = inv;
  begin
    perform public.reverse_journal(j, current_date, 'Wrong customer');
    r := r || E'\nFAIL T75 an invoice with a receipt against it was reversed';
  exception when others then r := r || E'\nPASS T75 an invoice with settlements cannot be reversed until the receipt is reversed';
  end;
  select journal_id into j2 from public.payments where id = pay;
  perform public.reverse_journal(j2, current_date, 'Receipt recorded against the wrong invoice');
  select amount_settled, status into x, v from public.invoices where id = inv;
  r := r || E'\n' || case when x = 0 and v = 'open' and (select status from public.payments where id = pay) = 'cancelled' then 'PASS' else 'FAIL' end
         || ' T76 reversing a receipt reopens the invoice (settled ' || x || ', ' || v || ')';
  perform public.reverse_journal(j, current_date, 'Wrong customer');
  select status into v from public.invoices where id = inv;
  r := r || E'\n' || case when v = 'cancelled' then 'PASS' else 'FAIL' end || ' T77 reversing an invoice journal cancels the invoice (' || v || ')';

  -- ------------------------------------------------------------ privileges
  execute 'reset role';
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and (left(p.proname, 3) = 'wf_' or p.proname in ('do_post','propose_posting','write_journal_lines','open_request','decide_request'))
     and has_function_privilege('authenticated', p.oid, 'execute');
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T78 internal posting functions cannot be called by a signed-in user (' || n || ' exposed)';
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname in ('public','numero_private') and has_function_privilege('anon', p.oid, 'execute')
     and p.proname in ('save_advance','release_advance','approve_claim','propose_fund_transfer','save_register_item','register_document','pay_claim','propose_asset_disposal');
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T79 nothing in phase 2 can be called anonymously (' || n || ' exposed)';
  select count(*) into n from pg_tables t where t.schemaname = 'public' and not t.rowsecurity;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T80 every table has row level security enabled (' || n || ' without)';
  select count(*) into n from public.journals jj where jj.status in ('posted','reversed')
     and (select sum(debit) from public.journal_lines l where l.journal_id = jj.id) <> (select sum(credit) from public.journal_lines l where l.journal_id = jj.id);
  select count(*) into x from public.journals where status in ('posted','reversed');
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T81 every one of the ' || x || ' posted journals balances';

  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', r;
end $t$;
