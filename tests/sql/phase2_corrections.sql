-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · PHASE 2, CORRECTIONS FROM THE REVIEW
-- Migrations 0011 and 0012: loan recovery through payroll, the ledger of
-- a vendor advance, the dimension of a linked register item, the cash box
-- limit, advance approval in several steps, follow-up confidentiality.
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare
  a uuid := gen_random_uuid();   -- owner (Group Super Admin)
  b uuid := gen_random_uuid();   -- accountant + payroll officer: prepares
  d uuid := gen_random_uuid();   -- finance head: approves; not cleared for confidential records, no payroll permission
  g uuid; c1 uuid; r text := ''; v text; v2 text; n int; n2 int; x numeric; y numeric; z numeric; j uuid; j2 uuid; id1 uuid;
  bank uuid; cash uuid; emp_adv uuid; ven_adv uuid; staff_loans uuid; int_inc uuid; travel uuid; fin uuid;
  p1 uuid; vendor uuid; e1 uuid; s1 uuid; loan uuid; run uuid; adv uuid; trip uuid; trip_unit uuid; claim uuid; box uuid; item uuid; t1 uuid; t2 uuid; t3 uuid;
  m2 date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@p5.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker@p5.numero.invalid'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checker@p5.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('P5', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','CR','name','Corrections Test'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1010","name":"Petty Cash","type":"asset","subtype":"cash","control_type":"cash"},
      {"code":"1155","name":"Employee Advances","type":"asset","subtype":"advance","control_type":"advance_paid"},
      {"code":"1160","name":"Vendor Advances","type":"asset","subtype":"advance","control_type":"advance_paid"},
      {"code":"1195","name":"Loans Given","type":"asset","subtype":"other_current_asset"},
      {"code":"2150","name":"TDS Payable","type":"liability","subtype":"tax_payable","control_type":"tax"},
      {"code":"2160","name":"Salaries Payable","type":"liability","subtype":"employee_payable"},
      {"code":"2165","name":"Reimbursements Payable","type":"liability","subtype":"employee_payable"},
      {"code":"2170","name":"Statutory Dues","type":"liability","subtype":"tax_payable"},
      {"code":"4000","name":"Sales","type":"income","subtype":"revenue"},
      {"code":"4910","name":"Interest Income","type":"income","subtype":"other_income"},
      {"code":"6110","name":"Salaries","type":"expense","subtype":"employee_cost"},
      {"code":"6120","name":"Employer Contributions","type":"expense","subtype":"employee_cost"},
      {"code":"6140","name":"Bonus","type":"expense","subtype":"employee_cost"},
      {"code":"6410","name":"Travel","type":"expense","subtype":"operating_expense"}]'::jsonb,
    'account_map', '{"employee_advances":"1155","vendor_advances":"1160","employee_payable":"2165","salaries_payable":"2160","salary_expense":"6110","bonus_expense":"6140","employer_contribution_expense":"6120","statutory_payable":"2170","tds_payable":"2150"}'::jsonb,
    'tax_codes', '[]'::jsonb,
    'org_units', '[{"type_key":"department","code":"FIN","name":"Finance"}]'::jsonb));
  perform public.grant_membership('maker@p5.numero.invalid', c1, 'accountant');
  perform public.grant_membership('maker@p5.numero.invalid', c1, 'payroll_officer');
  perform public.grant_membership('checker@p5.numero.invalid', c1, 'finance_head');
  select id into bank from public.accounts where company_id = c1 and code = '1000';
  select id into cash from public.accounts where company_id = c1 and code = '1010';
  select id into emp_adv from public.accounts where company_id = c1 and code = '1155';
  select id into ven_adv from public.accounts where company_id = c1 and code = '1160';
  select id into staff_loans from public.accounts where company_id = c1 and code = '1195';
  select id into int_inc from public.accounts where company_id = c1 and code = '4910';
  select id into travel from public.accounts where company_id = c1 and code = '6410';
  select id into fin from public.org_units where company_id = c1 and code = 'FIN';
  -- advances of 40,000 and above need two approvals in this company: used by T139 to T141
  insert into public.approval_rules(group_id, company_id, entity, name, min_amount, max_amount, steps)
  values (g, c1, 'advance', 'Advances of 40,000 and above', 40000, null, array['*','*']);

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', m2, 'voucher_type', 'opening', 'narration', 'Opening', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', bank, 'debit', 5000000), jsonb_build_object('account_id', cash, 'debit', 50000),
    jsonb_build_object('account_id', (select id from public.accounts where company_id = c1 and code = '4000'), 'credit', 5050000))));
  perform public.submit_journal(j);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok'); perform public.post_journal(j);

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  p1 := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'employee', 'kind', 'person', 'display_name', 'Asha Finance')))->>'id')::uuid;
  vendor := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'vendor', 'display_name', 'Steel Supplier')))->>'id')::uuid;
  e1 := public.save_employee(jsonb_build_object('company_id', c1, 'party_id', p1, 'join_date', (m2 - 400), 'department_id', fin, 'designation', 'Manager'));
  s1 := public.save_salary_structure(jsonb_build_object('employee_id', e1, 'effective_from', (m2 - 400), 'reason', 'Joining salary', 'components', jsonb_build_array(
    jsonb_build_object('name', 'Basic', 'kind', 'earning', 'amount', 80000))));
  -- an interest-free staff loan of 60,000 in six instalments of 10,000
  loan := public.save_loan(jsonb_build_object('company_id', c1, 'direction', 'lent', 'kind', 'employee_loan', 'name', 'Staff loan — Asha', 'party_id', p1, 'principal', 60000, 'rate_pct', 0,
    'start_date', m2, 'first_due_date', (m2 + interval '1 month')::date, 'tenure_months', 6, 'repayment', 'equal_principal', 'loan_account_id', staff_loans, 'interest_account_id', int_inc));
  j := public.disburse_loan(jsonb_build_object('loan_id', loan, 'amount', 60000, 'bank_ledger_id', bank, 'date', m2));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_salary_structure(s1, 'approved', 'As per offer letter');
  perform public.approve_journal(j, 'ok');

  -- ------------------------------------------------------------ 1. loan recovery through payroll
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  run := public.create_payroll_run(jsonb_build_object('company_id', c1, 'month', m2, 'adjustments', jsonb_build_array(
    jsonb_build_object('employee_id', e1, 'name', 'Staff loan recovery', 'kind', 'deduction', 'type', 'loan_recovery', 'amount', 15000, 'loan_id', loan))));
  j := public.propose_payroll_run(run);
  execute 'reset role';
  select count(*) filter (where recovered > 0) into n from public.loan_schedule where loan_id = loan;
  select principal_repaid into x from public.loans where id = loan;
  r := r || E'\n' || case when n = 0 and x = 0 then 'PASS' else 'FAIL' end || ' T130 a recovery changes nothing on the loan until the payroll entry is approved';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  execute 'reset role';
  select status, recovered into v, x from public.loan_schedule where loan_id = loan and instalment_no = 1;
  select status, recovered into v2, y from public.loan_schedule where loan_id = loan and instalment_no = 2;
  select principal_repaid into z from public.loans where id = loan;
  r := r || E'\n' || case when v = 'paid' and x = 10000 and v2 = 'due' and y = 5000 and z = 15000 then 'PASS' else 'FAIL' end
         || ' T131 recovery of 15000 reaches the schedule: instalment 1 is ' || v || ' (' || x || ' recovered), instalment 2 is ' || v2 || ' with ' || y || ' recovered; principal repaid ' || z;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select id into id1 from public.loan_schedule where loan_id = loan and instalment_no = 2;
  j2 := public.pay_loan_instalment(jsonb_build_object('schedule_id', id1, 'bank_ledger_id', bank, 'date', current_date));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j2, 'ok');
  execute 'reset role';
  select coalesce(sum(credit), 0) into x from public.journal_lines where journal_id = j2 and account_id = staff_loans;
  select principal_repaid, disbursed_amount into y, z from public.loans where id = loan;
  r := r || E'\n' || case when x = 5000 and y = 20000 and y <= z then 'PASS' else 'FAIL' end
         || ' T132 the instalment takes only the principal not yet recovered: ' || x || '; principal repaid ' || y || ' of ' || z || ' (never counted twice)';

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
    perform public.reverse_journal(j, current_date, 'test');
    r := r || E'\nFAIL T133 the payroll was reversed although an instalment was recorded after its recovery';
  exception when others then
    r := r || E'\n' || case when sqlerrm like '%recorded after this recovery%' then 'PASS' else 'FAIL' end || ' T133 a payroll cannot be reversed past an instalment recorded after its recovery (' || left(sqlerrm, 90) || ')';
  end;
  execute 'reset role';

  -- ------------------------------------------------------------ 2. the ledger of an advance follows its recipient
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  adv := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', vendor, 'recipient_type', 'vendor', 'purpose', 'Advance against steel order', 'requested_amount', 30000));
  perform public.submit_advance(adv);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_advance(adv, null, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.release_advance(jsonb_build_object('advance_id', adv, 'amount', 30000, 'bank_ledger_id', bank, 'date', current_date));
  execute 'reset role';
  select count(*) filter (where account_id = ven_adv and debit = 30000), count(*) filter (where account_id = emp_adv) into n, n2 from public.journal_lines where journal_id = j;
  r := r || E'\n' || case when n = 1 and n2 = 0 then 'PASS' else 'FAIL' end || ' T134 an advance to a vendor sits in the vendor advances ledger, not with employee advances';

  -- ------------------------------------------------------------ 3. the dimension of a linked register item
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  trip := public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'trip', 'title', 'Kochi property expo', 'amount', 40000,
    'data', jsonb_build_object('traveller', 'Asha Finance', 'to_place', 'Kochi', 'purpose', 'Expo')));
  execute 'reset role';
  select org_unit_id into trip_unit from public.register_items where id = trip;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  claim := public.save_claim(jsonb_build_object('company_id', c1, 'claimant_party_id', p1, 'title', 'Kochi expo', 'register_item_id', trip,
    'lines', jsonb_build_array(jsonb_build_object('expense_date', current_date - 2, 'account_id', travel, 'description', 'Train tickets', 'amount', 3000, 'has_receipt', true))));
  perform public.submit_claim(claim);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_claim(claim, 'ok', null);
  execute 'reset role';
  select journal_id into j from public.expense_claims where id = claim;
  select count(*) into n from public.journal_lines l join public.journal_line_dims dm on dm.line_id = l.id
   where l.journal_id = j and l.account_id = travel and dm.org_unit_id = trip_unit;
  r := r || E'\n' || case when trip_unit is not null and n = 1 then 'PASS' else 'FAIL' end || ' T135 a claim linked to a trip carries the trip into its entry, so the trip can show what it cost';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');

  -- ------------------------------------------------------------ 4. cash box: maximum single payment
  box := public.save_cash_box(jsonb_build_object('company_id', c1, 'name', 'HO petty cash', 'ledger_account_id', cash, 'float_amount', 50000, 'min_balance', 5000, 'max_single_payment', 2000));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j2 := public.pay_claim(jsonb_build_object('claim_id', claim, 'bank_ledger_id', cash, 'date', current_date));
  execute 'reset role';
  select count(*) into n from public.alerts where company_id = c1 and kind = 'cash_box_limit_exceeded' and entity_id = j2;
  select status into v from public.workflow_postings where journal_id = j2;
  select count(*) into n2 from public.alerts where company_id = c1 and kind = 'cash_box_limit_exceeded' and (title ilike '%fraud%' or explanation ilike '%fraud%' or explanation ilike '%suspicious%');
  r := r || E'\n' || case when n = 1 and v = 'pending' and n2 = 0 then 'PASS' else 'FAIL' end
         || ' T136 a payment of 3000 from a cash box limited to 2000 is raised for review and still recorded (entry is ' || coalesce(v, '?') || ')';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  adv := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', p1, 'purpose', 'Stationery', 'requested_amount', 1500));
  perform public.submit_advance(adv);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_advance(adv, null, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.release_advance(jsonb_build_object('advance_id', adv, 'amount', 1500, 'bank_ledger_id', cash, 'date', current_date));
  execute 'reset role';
  select count(*) into n from public.alerts where kind = 'cash_box_limit_exceeded' and entity_id = j;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T137 a payment within the limit raises nothing';
  select count(*) into n from public.journal_lines where journal_id = j and account_id = emp_adv and debit = 1500;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' T138 an advance to an employee still sits in the employee advances ledger';

  -- ------------------------------------------------------------ 5. advance approval in several steps
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  adv := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', p1, 'purpose', 'Site mobilisation', 'requested_amount', 50000));
  perform public.submit_advance(adv);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  v := public.approve_advance(adv, 30000, 'Thirty thousand is enough for the first fortnight');
  execute 'reset role';
  select status, approved_amount into v2, x from public.advances where id = adv;
  r := r || E'\n' || case when v = 'pending' and v2 = 'requested' and x = 30000 then 'PASS' else 'FAIL' end
         || ' T139 first of two approvals: the advance is still ' || v2 || ' and the amount authorised so far, ' || x || ', is kept';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.approve_advance(adv, 40000, 'more');
    r := r || E'\nFAIL T140 a later approver raised the amount an earlier approver authorised';
  exception when others then
    r := r || E'\n' || case when sqlerrm like '%earlier approver authorised%' then 'PASS' else 'FAIL' end || ' T140 a later step may lower the amount, not raise it (' || left(sqlerrm, 80) || ')';
  end;
  v := public.approve_advance(adv, 25000, 'ok');
  execute 'reset role';
  select status, approved_amount into v2, x from public.advances where id = adv;
  r := r || E'\n' || case when v = 'approved' and v2 = 'approved' and x = 25000 then 'PASS' else 'FAIL' end || ' T141 final approval: ' || v2 || ' for ' || x;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  adv := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', p1, 'purpose', 'Second site', 'requested_amount', 45000));
  perform public.submit_advance(adv);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_advance(adv, 20000, 'step one');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.reject_advance(adv, 'Not needed this month');
  execute 'reset role';
  select status, approved_amount into v2, x from public.advances where id = adv;
  r := r || E'\n' || case when v2 = 'rejected' and x = 0 then 'PASS' else 'FAIL' end || ' T142 a rejected request keeps nothing authorised (' || v2 || ', ' || x || ')';

  -- ------------------------------------------------------------ 6. a follow-up is as confidential as its record
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  item := public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'dividend', 'title', 'Settlement with a former partner', 'amount', 900000, 'confidentiality', 'confidential'));
  t1 := public.save_task(jsonb_build_object('company_id', c1, 'entity', 'register_items', 'entity_id', item, 'title', 'Obtain the signed settlement deed', 'due_date', current_date + 7));
  t2 := public.save_task(jsonb_build_object('company_id', c1, 'entity', 'register_items', 'entity_id', trip, 'title', 'Collect the expo invoices', 'due_date', current_date + 7));
  t3 := public.save_task(jsonb_build_object('company_id', c1, 'entity', 'payroll_runs', 'entity_id', run, 'title', 'Confirm the bank advice for salaries', 'due_date', current_date + 3));
  execute 'reset role';
  select confidentiality into v from public.tasks where id = t1;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) filter (where id = t1), count(*) filter (where id = t2), count(*) filter (where id = t3) into n, n2, x from public.tasks;
  r := r || E'\n' || case when v = 'confidential' and n = 0 and n2 = 1 then 'PASS' else 'FAIL' end
         || ' T143 a follow-up on a confidential record is ' || v || ': a person not cleared sees ' || n || ' of it, and still sees the ordinary one (' || n2 || ')';
  r := r || E'\n' || case when x = 0 then 'PASS' else 'FAIL' end || ' T144 a follow-up on a payroll run is invisible without the payroll permission (' || x || ' visible to the finance head)';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) filter (where id = t3), count(*) filter (where id = t1) into n, n2 from public.tasks;
  r := r || E'\n' || case when n = 1 and n2 = 0 then 'PASS' else 'FAIL' end || ' T145 the payroll officer sees the payroll follow-up (' || n || ') and not the confidential one (' || n2 || ')';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.tasks where id in (t1, t2, t3);
  r := r || E'\n' || case when n = 3 then 'PASS' else 'FAIL' end || ' T146 a Group Super Admin sees all three';

  -- ------------------------------------------------------------ 7. stored files and privileges
  execute 'reset role';
  insert into public.documents(company_id, name, size_bytes, sha256, storage_path, uploaded_by)
  values (c1, 'deed.pdf', 10, repeat('a', 64), c1::text || '/registered-deed.pdf', a);
  r := r || E'\n' || case when numero_private.path_is_registered(c1::text || '/registered-deed.pdf') and not numero_private.path_is_registered(c1::text || '/never-registered.pdf')
                          then 'PASS' else 'FAIL' end || ' T147 only a stored file that never became a document can be removed by its uploader';
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname in ('apply_loan_recovery', 'advance_account', 'item_dims', 'check_cash_box_limit', 'record_confidentiality', 'task_inherits_confidentiality')
     and has_function_privilege('authenticated', p.oid, 'execute');
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T148 the new internal functions cannot be called by a signed-in user (' || n || ' callable)';
  select count(*) into n from public.journals jn where jn.status = 'posted'
    and (select coalesce(sum(debit), 0) from public.journal_lines where journal_id = jn.id) <> (select coalesce(sum(credit), 0) from public.journal_lines where journal_id = jn.id);
  select count(*) into n2 from public.journals where status = 'posted';
  r := r || E'\n' || case when n = 0 and n2 >= 5 then 'PASS' else 'FAIL' end || ' T149 every posted journal balances (' || n2 || ' posted, ' || n || ' unbalanced)';

  execute 'reset role';
  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', coalesce(r, ' <results lost: a value was null>');
end $t$;
