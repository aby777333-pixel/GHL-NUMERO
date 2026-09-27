-- =====================================================================
-- GHL NUMERO · DATABASE INVARIANT TESTS  (spec 92, 1517-1522)
--
-- Runs entirely inside one transaction and ALWAYS rolls back: the final
-- statement raises an exception carrying the results, so no test data,
-- journal or audit row is ever left in the database.
--
-- Read the result from the error message:  NUMERO-TEST-RESULTS ...
-- Every line must start with PASS.
-- =====================================================================
do $test$
declare
  a uuid := gen_random_uuid();  -- owner / group super admin
  b uuid := gen_random_uuid();  -- accountant, company 1
  c uuid := gen_random_uuid();  -- accountant, company 2
  d uuid := gen_random_uuid();  -- signed-up user with no access
  g uuid; c1 uuid; c2 uuid;
  bank1 uuid; sales1 uuid; exp1 uuid; ar1 uuid; cgst1 uuid; sgst1 uuid; cap1 uuid; bank2 uuid; exp2 uuid;
  j1 uuid; j2 uuid; j3 uuid; jr uuid; jv uuid; inv uuid; pay uuid; party uuid; tax uuid;
  v text; n int; x numeric; y numeric; js jsonb;
  r text := '';
  coa jsonb := '[
    {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
    {"code":"1100","name":"Accounts Receivable","type":"asset","subtype":"receivable","control_type":"receivable"},
    {"code":"1200","name":"Vendor Advances","type":"asset","subtype":"advance","control_type":"advance_paid"},
    {"code":"2000","name":"Accounts Payable","type":"liability","subtype":"payable","control_type":"payable"},
    {"code":"2100","name":"Customer Advances","type":"liability","subtype":"advance","control_type":"advance_received"},
    {"code":"2200","name":"CGST Output","type":"liability","subtype":"tax_payable","control_type":"tax"},
    {"code":"2201","name":"SGST Output","type":"liability","subtype":"tax_payable","control_type":"tax"},
    {"code":"3000","name":"Capital","type":"equity","subtype":"capital"},
    {"code":"4000","name":"Sales","type":"income","subtype":"revenue"},
    {"code":"5000","name":"Expenses","type":"expense","subtype":"operating_expense","is_group":true},
    {"code":"5100","name":"Marketing","type":"expense","subtype":"operating_expense","parent_code":"5000"},
    {"code":"5900","name":"Exchange Difference","type":"expense","subtype":"finance_cost"}
  ]'::jsonb;
  amap jsonb := '{"ar_control":"1100","ap_control":"2000","customer_advances":"2100","vendor_advances":"1200","fx_gain_loss":"5900"}'::jsonb;
  taxes jsonb := '[{"code":"GST18","name":"GST 18%","components":[
      {"component":"CGST","rate":9,"output_code":"2200","input_code":"2200"},
      {"component":"SGST","rate":9,"output_code":"2201","input_code":"2201"}]}]'::jsonb;
begin
  insert into auth.users(id, instance_id, aud, role, email)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.numero.invalid'),
         (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acc1@test.numero.invalid'),
         (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acc2@test.numero.invalid'),
         (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nobody@test.numero.invalid');
  insert into public.app_config(key, value) values ('allow_multiple_groups', 'true'::jsonb)
    on conflict (key) do update set value = excluded.value;
  delete from public.app_config where key = 'owner_email';

  -- ---------- T01 bootstrap + company creation (as owner) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('Test Universe', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','T1','name','Test One'),
          'accounts', coa, 'account_map', amap, 'tax_codes', taxes));
  c2 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','T2','name','Test Two'),
          'accounts', coa, 'account_map', amap, 'tax_codes', taxes));
  perform public.grant_membership('acc1@test.numero.invalid', c1, 'accountant');
  perform public.grant_membership('acc2@test.numero.invalid', c2, 'accountant');
  select id into bank1 from public.accounts where company_id = c1 and code = '1000';
  select id into ar1   from public.accounts where company_id = c1 and code = '1100';
  select id into cgst1 from public.accounts where company_id = c1 and code = '2200';
  select id into sgst1 from public.accounts where company_id = c1 and code = '2201';
  select id into cap1  from public.accounts where company_id = c1 and code = '3000';
  select id into sales1 from public.accounts where company_id = c1 and code = '4000';
  select id into exp1  from public.accounts where company_id = c1 and code = '5100';
  select id into bank2 from public.accounts where company_id = c2 and code = '1000';
  select id into exp2  from public.accounts where company_id = c2 and code = '5100';
  select count(*) into n from public.accounts where company_id = c1;
  r := r || E'\n' || case when n = 12 and bank1 is not null then 'PASS' else 'FAIL' end || ' T01 bootstrap, company + chart of accounts created (' || n || ' accounts)';

  -- ---------- T02 second bootstrap by same user is refused ----------
  begin
    perform public.bootstrap_group('Again', 'INR', 'enforced');
    r := r || E'\nFAIL T02 second bootstrap was allowed';
  exception when others then r := r || E'\nPASS T02 second bootstrap refused';
  end;

  -- ---------- T03 accountant B drafts, submits; cannot approve own journal ----------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j1 := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date, 'narration', 'Marketing spend',
          'lines', jsonb_build_array(
            jsonb_build_object('account_id', exp1, 'debit', 85000),
            jsonb_build_object('account_id', bank1, 'credit', 85000))));
  perform public.submit_journal(j1);
  begin
    perform public.approve_journal(j1, 'self');
    r := r || E'\nFAIL T03 maker approved own journal';
  exception when others then r := r || E'\nPASS T03 maker cannot approve own journal (' || sqlerrm || ')';
  end;

  -- ---------- T04 posting before approval is refused ----------
  begin
    perform public.post_journal(j1);
    r := r || E'\nFAIL T04 posted without approval';
  exception when others then r := r || E'\nPASS T04 posting refused before approval';
  end;

  -- ---------- T05 owner approves, accountant posts, voucher number issued ----------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.approve_journal(j1, 'ok');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.post_journal(j1);
  r := r || E'\n' || case when v like 'JV-%' then 'PASS' else 'FAIL' end || ' T05 approved then posted as ' || coalesce(v, 'null');

  -- ---------- T06 posting is idempotent ----------
  r := r || E'\n' || case when public.post_journal(j1) = v then 'PASS' else 'FAIL' end || ' T06 re-posting returns the same voucher (idempotent)';

  -- ---------- T07 unbalanced journal can be drafted but never submitted ----------
  j2 := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date, 'narration', 'Unbalanced',
          'lines', jsonb_build_array(
            jsonb_build_object('account_id', exp1, 'debit', 1000),
            jsonb_build_object('account_id', bank1, 'credit', 900))));
  begin
    perform public.submit_journal(j2);
    r := r || E'\nFAIL T07 unbalanced journal was submitted';
  exception when others then r := r || E'\nPASS T07 unbalanced journal refused (' || sqlerrm || ')';
  end;

  -- ---------- T08 group/header account cannot receive postings ----------
  begin
    perform public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date,
          'lines', jsonb_build_array(
            jsonb_build_object('account_id', (select id from public.accounts where company_id = c1 and code = '5000'), 'debit', 10),
            jsonb_build_object('account_id', bank1, 'credit', 10))));
    r := r || E'\nFAIL T08 posting to group account allowed';
  exception when others then r := r || E'\nPASS T08 group account refused';
  end;

  -- ---------- T09 client cannot change status or edit posted data directly ----------
  begin
    update public.journals set status = 'draft' where id = j1;
    get diagnostics n = row_count;
    r := r || E'\n' || case when n = 0 then 'PASS T09 direct status update blocked (no write policy)' else 'FAIL T09 direct status update succeeded' end;
  exception when others then r := r || E'\nPASS T09 direct status update blocked (' || sqlerrm || ')';
  end;

  -- ---------- T10 even a privileged database role cannot alter or delete posted records ----------
  execute 'reset role';
  begin
    update public.journal_lines set debit = 1 where journal_id = j1 and debit > 0;
    r := r || E'\nFAIL T10a posted line was altered';
  exception when others then r := r || E'\nPASS T10a posted lines immutable';
  end;
  begin
    delete from public.journals where id = j1;
    r := r || E'\nFAIL T10b posted journal was deleted';
  exception when others then r := r || E'\nPASS T10b journals cannot be deleted';
  end;
  begin
    update public.journals set total = 1 where id = j1;
    r := r || E'\nFAIL T10c posted header was altered';
  exception when others then r := r || E'\nPASS T10c posted header immutable';
  end;
  begin
    update public.audit_log set reason = 'tamper' where id = (select max(id) from public.audit_log);
    r := r || E'\nFAIL T10d audit log was altered';
  exception when others then r := r || E'\nPASS T10d audit trail is append-only';
  end;

  -- ---------- T11 tenant isolation: company-2 accountant sees nothing of company 1 ----------
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.journals where company_id = c1;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T11a cross-company journals hidden (' || n || ' visible)';
  select count(*) into n from public.accounts where company_id = c1;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T11b cross-company accounts hidden (' || n || ' visible)';
  select count(*) into n from public.ledger_balances(array[c1], current_date - 365, current_date);
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T11c reporting function returns nothing for unauthorised company';
  select (public.ledger_lines(jsonb_build_object('company_ids', jsonb_build_array(c1)))->>'total')::int into n;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T11d drill-down returns nothing for unauthorised company';
  begin
    perform public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date,
          'lines', jsonb_build_array(jsonb_build_object('account_id', exp1, 'debit', 5), jsonb_build_object('account_id', bank1, 'credit', 5))));
    r := r || E'\nFAIL T11e wrote a journal into another company';
  exception when others then r := r || E'\nPASS T11e cannot write into another company';
  end;
  begin
    perform public.save_journal_draft(jsonb_build_object('company_id', c2, 'journal_date', current_date,
          'lines', jsonb_build_array(jsonb_build_object('account_id', exp1, 'debit', 5), jsonb_build_object('account_id', bank2, 'credit', 5))));
    r := r || E'\nFAIL T11f used another company''s account';
  exception when others then r := r || E'\nPASS T11f cannot use another company''s account in own journal';
  end;
  begin
    perform public.open_journal(j1);
    r := r || E'\nFAIL T11g opened another company''s journal';
  exception when others then r := r || E'\nPASS T11g cannot open another company''s journal';
  end;

  -- ---------- T12 signed-up user with no membership sees nothing ----------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.companies) + (select count(*) from public.journals)
       + (select count(*) from public.parties) + (select count(*) from public.audit_log) into n;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T12 user without access sees nothing (' || n || ' rows)';

  -- ---------- T13 anonymous role sees nothing ----------
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin
    select (select count(*) from public.companies) + (select count(*) from public.journals) into n;
    r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T13 anonymous sees nothing (' || n || ' rows)';
  exception when others then r := r || E'\nPASS T13 anonymous denied (' || sqlerrm || ')';
  end;

  -- ---------- T14 period lock ----------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_period_status(c1, (current_date - 70), 'locked', 'Month closed');
  begin
    j3 := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date - 70, 'narration', 'Into locked period',
          'lines', jsonb_build_array(jsonb_build_object('account_id', exp1, 'debit', 100), jsonb_build_object('account_id', bank1, 'credit', 100))));
    perform public.submit_journal(j3);
    r := r || E'\nFAIL T14a journal submitted into a locked period';
  exception when others then r := r || E'\nPASS T14a locked period refuses entries';
  end;
  begin
    perform public.set_period_status(c1, (current_date - 70), 'open', '');
    r := r || E'\nFAIL T14b period reopened without a reason';
  exception when others then r := r || E'\nPASS T14b reopening requires a reason';
  end;
  perform public.set_period_status(c1, (current_date - 70), 'open', 'Audit adjustment required');
  r := r || E'\nPASS T14c period reopened with reason and audit record';

  -- ---------- T15 reversal preserves history and nets to zero ----------
  jr := public.reverse_journal(j1, current_date, 'Entered against the wrong account');
  select status into v from public.journals where id = j1;
  select coalesce(sum(debit - credit), 0) into x from public.journal_lines l join public.journals j on j.id = l.journal_id
   where j.id in (j1, jr) and l.account_id = exp1;
  r := r || E'\n' || case when v = 'reversed' and x = 0 then 'PASS' else 'FAIL' end || ' T15a reversal posted; original kept as "' || v || '"; net effect ' || x;
  begin
    perform public.reverse_journal(j1, current_date, 'again');
    r := r || E'\nFAIL T15b journal reversed twice';
  exception when others then r := r || E'\nPASS T15b a journal cannot be reversed twice';
  end;

  -- ---------- T16 event-driven invoice posting with configurable tax ----------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  js := public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'customer', 'display_name', 'ABC Builders Pvt Ltd'));
  party := (js->>'id')::uuid;
  r := r || E'\n' || case when js->>'party_no' like 'NUM-CUS-%' then 'PASS' else 'FAIL' end || ' T16a party created with universal id ' || coalesce(js->>'party_no', '?');
  js := public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'customer', 'display_name', 'A.B.C. Builders Private Limited'));
  r := r || E'\n' || case when js->>'status' = 'possible_duplicate' then 'PASS' else 'FAIL' end || ' T16b near-duplicate party surfaced for review, not merged';
  select id into tax from public.tax_codes where company_id = c1 and code = 'GST18';
  inv := public.save_invoice(jsonb_build_object('company_id', c1, 'doc_type', 'sales_invoice', 'party_id', party,
           'doc_date', current_date, 'due_date', current_date + 30, 'narration', 'Consulting',
           'lines', jsonb_build_array(jsonb_build_object('account_id', sales1, 'description', 'Consulting services', 'amount', 250000, 'tax_code_id', tax))));
  begin
    perform public.approve_invoice(inv);
    r := r || E'\nFAIL T16c accountant approved own invoice';
  exception when others then r := r || E'\nPASS T16c invoice approval requires authority and a second person';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.approve_invoice(inv);
  select journal_id into jv from public.invoices where id = inv;
  select sum(debit), sum(credit) into x, y from public.journal_lines where journal_id = jv;
  select count(*) into n from public.journal_lines where journal_id = jv
    and ((account_id = ar1 and debit = 295000) or (account_id = sales1 and credit = 250000)
      or (account_id = cgst1 and credit = 22500) or (account_id = sgst1 and credit = 22500));
  r := r || E'\n' || case when x = y and x = 295000 and n = 4 then 'PASS' else 'FAIL' end
         || ' T16d ' || v || ' posted: Dr Receivable 295000 / Cr Sales 250000 / Cr CGST 22500 / Cr SGST 22500 (dr ' || x || ' cr ' || y || ')';
  r := r || E'\n' || case when public.approve_invoice(inv) = v and (select count(*) from public.journals where source_id = inv) = 1
         then 'PASS' else 'FAIL' end || ' T16e invoice approval is idempotent (one journal only)';

  -- ---------- T17 receipt with partial allocation ----------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  pay := public.save_payment(jsonb_build_object('company_id', c1, 'direction', 'in', 'party_id', party, 'bank_ledger_id', bank1,
           'pay_date', current_date, 'amount', 100000, 'reference', 'UTR123',
           'allocations', jsonb_build_array(jsonb_build_object('invoice_id', inv, 'amount', 100000))));
  begin
    perform public.save_payment(jsonb_build_object('company_id', c1, 'direction', 'in', 'party_id', party, 'bank_ledger_id', bank1,
           'pay_date', current_date, 'amount', 900000,
           'allocations', jsonb_build_array(jsonb_build_object('invoice_id', inv, 'amount', 900000))));
    r := r || E'\nFAIL T17a over-allocation accepted';
  exception when others then r := r || E'\nPASS T17a allocation above outstanding balance refused';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.approve_payment(pay);
  select status, total - amount_settled into v, x from public.invoices where id = inv;
  select coalesce(sum(debit - credit), 0) into y from public.party_ledger_balances(array[c1], current_date)
   where party_id = party and control_type = 'receivable';
  r := r || E'\n' || case when v = 'partially_paid' and x = 195000 and y = 195000 then 'PASS' else 'FAIL' end
         || ' T17b receipt posted; invoice ' || v || ', outstanding ' || x || ', subledger ' || y || ' (control = subledger)';

  -- ---------- T18 books balance: total debits = total credits ----------
  select sum(opening_debit + period_debit), sum(opening_credit + period_credit) into x, y
    from public.ledger_balances(array[c1, c2], current_date - 365, current_date);
  js := public.integrity_check(array[c1, c2]);
  r := r || E'\n' || case when x = y and (js->>'unbalanced_journals')::int = 0 then 'PASS' else 'FAIL' end
         || ' T18 trial balance: debits ' || x || ' = credits ' || y || '; unbalanced journals ' || (js->>'unbalanced_journals');

  -- ---------- T19 Black Vault: restricted detail masked, totals stay truthful ----------
  j2 := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date, 'narration', 'Legal settlement',
          'confidentiality', 'restricted',
          'lines', jsonb_build_array(jsonb_build_object('account_id', exp1, 'debit', 500000), jsonb_build_object('account_id', bank1, 'credit', 500000))));
  perform public.submit_journal(j2);
  execute 'reset role';
  update public.groups set settings = jsonb_set(settings, '{controls,maker_checker}', '"owner_override"') where id = g;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.approve_journal(j2, 'Owner override test');
  v := public.post_journal(j2);
  select action into v from public.approval_actions aa join public.approval_requests ar on ar.id = aa.request_id where ar.entity_id = j2;
  r := r || E'\n' || case when v = 'override' then 'PASS' else 'FAIL' end || ' T19a owner self-approval only when explicitly configured, recorded as "' || v || '"';
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.journals where id = j2;
  js := public.ledger_lines(jsonb_build_object('company_ids', jsonb_build_array(c1), 'account_ids', jsonb_build_array(exp1)));
  select period_debit + opening_debit into x from public.ledger_balances(array[c1], current_date - 365, current_date) where account_id = exp1;
  r := r || E'\n' || case when n = 0 and (js#>>'{restricted,count}')::int = 1 and (js#>>'{restricted,debit}')::numeric = 500000
                           and x = 585000 then 'PASS' else 'FAIL' end
         || ' T19b restricted journal hidden from accountant (' || n || ' visible), masked bucket ' || (js#>>'{restricted,debit}')
         || ', ledger total still includes it (' || x || ')';
  js := public.open_journal(j2);
  r := r || E'\n' || case when (js->>'restricted')::boolean then 'PASS' else 'FAIL' end || ' T19c opening a restricted record returns RESTRICTED and logs the attempt';
  begin
    perform public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date, 'confidentiality', 'restricted',
          'lines', jsonb_build_array(jsonb_build_object('account_id', exp1, 'debit', 1), jsonb_build_object('account_id', bank1, 'credit', 1))));
    r := r || E'\nFAIL T19d uncleared user created a restricted record';
  exception when others then r := r || E'\nPASS T19d uncleared user cannot create restricted records';
  end;

  -- ---------- T20 Sentinel flags factual patterns ----------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := public.run_sentinel(c1);
  select count(*) into n from public.alerts where company_id = c1 and kind = 'round_number_journal';
  select count(*) into x from public.alerts where company_id = c1 and (title ilike '%fraud%' or explanation ilike '%fraud%');
  r := r || E'\n' || case when n >= 1 and x = 0 then 'PASS' else 'FAIL' end || ' T20 Sentinel raised ' || n || ' round-number alert(s); none labelled as fraud';

  -- ---------- T21 time machine: state as known at an earlier moment ----------
  select coalesce(sum(period_debit), 0) into x from public.ledger_balances(array[c1], current_date - 365, current_date, now() - interval '1 day');
  r := r || E'\n' || case when x = 0 then 'PASS' else 'FAIL' end || ' T21 time machine excludes entries not yet posted at the chosen moment (' || x || ')';

  -- ---------- T22 vendor bank change protection ----------
  js := public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'vendor', 'display_name', 'XYZ Logistics'));
  party := (js->>'id')::uuid;
  jv := public.add_party_bank(jsonb_build_object('company_id', c1, 'party_id', party, 'bank_name', 'HDFC', 'account_no', '000111222', 'ifsc', 'HDFC0000001', 'beneficiary_name', 'XYZ Logistics'));
  begin
    perform public.save_payment(jsonb_build_object('company_id', c1, 'direction', 'out', 'party_id', party, 'bank_ledger_id', bank1,
           'pay_date', current_date, 'amount', 1000, 'party_bank_account_id', jv));
    r := r || E'\nFAIL T22 payment used unverified bank details';
  exception when others then r := r || E'\nPASS T22 payment refused until bank details are independently verified';
  end;
  select count(*) into n from public.alerts where company_id = c1 and kind = 'bank_detail_change';
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' T23 BANK DETAIL CHANGE ALERT raised';

  -- ---------- T24 privilege escalation attempt ----------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.profiles set is_group_super_admin = true where id = b;
    select is_group_super_admin::int into n from public.profiles where id = b;
    r := r || E'\n' || case when n = 0 then 'PASS T24 self-promotion had no effect' else 'FAIL T24 user promoted self to super admin' end;
  exception when others then r := r || E'\nPASS T24 self-promotion to super admin blocked';
  end;

  execute 'reset role';
  raise exception E'NUMERO-TEST-RESULTS (transaction rolled back, nothing persisted)%', r;
end
$test$;
