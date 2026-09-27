-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · PHASE 2, PART 3
-- Payroll, payroll privacy, salary history, tasks, custom field values.
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare
  a uuid := gen_random_uuid();   -- owner (Group Super Admin)
  b uuid := gen_random_uuid();   -- accountant + payroll officer
  d uuid := gen_random_uuid();   -- finance head: has audit.view and journal.approve, not payroll
  g uuid; c1 uuid; r text := ''; v text; n int; n2 int; n3 int; x numeric; y numeric; z numeric; w numeric; j uuid; j2 uuid; id1 uuid;
  bank uuid; fin uuid; ops uuid; p1 uuid; p2 uuid; p3 uuid; e1 uuid; e2 uuid; e3 uuid; s1 uuid; s2 uuid; run uuid; adv uuid; fld uuid; item uuid;
  m2 date := (date_trunc('month', current_date) - interval '1 month')::date; dim int; exp2 numeric;
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@p4.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker@p4.numero.invalid'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checker@p4.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('P4', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','PY','name','Payroll Test'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1155","name":"Employee Advances","type":"asset","subtype":"advance","control_type":"advance_paid"},
      {"code":"2150","name":"TDS Payable","type":"liability","subtype":"tax_payable","control_type":"tax"},
      {"code":"2160","name":"Salaries Payable","type":"liability","subtype":"employee_payable"},
      {"code":"2170","name":"Statutory Dues","type":"liability","subtype":"tax_payable"},
      {"code":"4000","name":"Sales","type":"income","subtype":"revenue"},
      {"code":"6110","name":"Salaries","type":"expense","subtype":"employee_cost"},
      {"code":"6120","name":"Employer Contributions","type":"expense","subtype":"employee_cost"},
      {"code":"6140","name":"Bonus","type":"expense","subtype":"employee_cost"}]'::jsonb,
    'account_map', '{"employee_advances":"1155","salaries_payable":"2160","salary_expense":"6110","bonus_expense":"6140","employer_contribution_expense":"6120","statutory_payable":"2170","tds_payable":"2150"}'::jsonb,
    'tax_codes', '[]'::jsonb,
    'org_units', '[{"type_key":"department","code":"FIN","name":"Finance"},{"type_key":"department","code":"OPS","name":"Operations"}]'::jsonb));
  perform public.grant_membership('maker@p4.numero.invalid', c1, 'accountant');
  perform public.grant_membership('maker@p4.numero.invalid', c1, 'payroll_officer');
  perform public.grant_membership('checker@p4.numero.invalid', c1, 'finance_head');
  select id into bank from public.accounts where company_id = c1 and code = '1000';
  select id into fin from public.org_units where company_id = c1 and code = 'FIN';
  select id into ops from public.org_units where company_id = c1 and code = 'OPS';
  insert into public.custom_field_defs(group_id, company_id, entity, key, label, field_type, is_required, status)
  values (g, null, 'register_items', 'board_ref', 'Board approval reference', 'text', true, 'active') returning id into fld;

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', m2, 'voucher_type', 'opening', 'narration', 'Opening', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', bank, 'debit', 5000000), jsonb_build_object('account_id', (select id from public.accounts where company_id = c1 and code = '4000'), 'credit', 5000000))));
  perform public.submit_journal(j);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok'); perform public.post_journal(j);

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  p1 := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'employee', 'kind', 'person', 'display_name', 'Asha Finance')))->>'id')::uuid;
  p2 := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'employee', 'kind', 'person', 'display_name', 'Ravi Operations')))->>'id')::uuid;
  p3 := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'employee', 'kind', 'person', 'display_name', 'New Joiner')))->>'id')::uuid;
  e1 := public.save_employee(jsonb_build_object('company_id', c1, 'party_id', p1, 'join_date', (m2 - 400), 'department_id', fin, 'designation', 'Manager'));
  e2 := public.save_employee(jsonb_build_object('company_id', c1, 'party_id', p2, 'join_date', (m2 + 15), 'department_id', ops));
  e3 := public.save_employee(jsonb_build_object('company_id', c1, 'party_id', p3, 'join_date', (m2 - 10), 'department_id', ops));
  s1 := public.save_salary_structure(jsonb_build_object('employee_id', e1, 'effective_from', (m2 - 400), 'reason', 'Joining salary', 'components', jsonb_build_array(
    jsonb_build_object('name', 'Basic', 'kind', 'earning', 'amount', 50000), jsonb_build_object('name', 'HRA', 'kind', 'earning', 'amount', 20000),
    jsonb_build_object('name', 'Provident fund', 'kind', 'deduction', 'type', 'statutory', 'amount', 6000),
    jsonb_build_object('name', 'Income tax', 'kind', 'deduction', 'type', 'tax', 'amount', 4000),
    jsonb_build_object('name', 'Employer provident fund', 'kind', 'employer', 'amount', 6000))));
  s2 := public.save_salary_structure(jsonb_build_object('employee_id', e2, 'effective_from', (m2 + 15), 'reason', 'Joining salary', 'components', jsonb_build_array(
    jsonb_build_object('name', 'Consolidated', 'kind', 'earning', 'amount', 30000))));
  adv := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', p1, 'purpose', 'Salary advance', 'requested_amount', 8000));
  perform public.submit_advance(adv);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_salary_structure(s1, 'approved', 'As per offer letter');
  perform public.decide_salary_structure(s2, 'approved', 'As per offer letter');
  perform public.approve_advance(adv, null, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.release_advance(jsonb_build_object('advance_id', adv, 'amount', 8000, 'bank_ledger_id', bank, 'date', m2));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');

  -- ------------------------------------------------------------ payroll run
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  dim := ((m2 + interval '1 month')::date - m2);
  exp2 := round(30000::numeric * (dim - 15) / dim, 2);
  run := public.create_payroll_run(jsonb_build_object('company_id', c1, 'month', m2, 'adjustments', jsonb_build_array(
    jsonb_build_object('employee_id', e1, 'name', 'Performance bonus', 'kind', 'earning', 'type', 'bonus', 'amount', 10000),
    jsonb_build_object('employee_id', e1, 'name', 'Advance recovery', 'kind', 'deduction', 'type', 'advance_recovery', 'amount', 5000, 'advance_id', adv))));
  select headcount, gross, deductions, employer_cost, net, jsonb_array_length(exceptions) into n, x, y, z, w, n2 from public.payroll_runs where id = run;
  r := r || E'\n' || case when n = 2 and x = 80000 + exp2 and y = 15000 and z = 6000 and w = x - y then 'PASS' else 'FAIL' end
         || ' T110 payroll calculated: gross ' || x || ' (incl. part-month ' || exp2 || ' and bonus), deductions ' || y || ', employer cost ' || z || ', net ' || w;
  select exceptions->0->>'reason' into v from public.payroll_runs where id = run;
  r := r || E'\n' || case when n2 = 1 and v like 'NOT INCLUDED%' then 'PASS' else 'FAIL' end || ' T111 the person without an approved salary is listed, not silently dropped: ' || coalesce(v, '?');
  begin
    perform public.create_payroll_run(jsonb_build_object('company_id', c1, 'month', m2));
    r := r || E'\nFAIL T112 a second regular payroll was created for the same month';
  exception when others then r := r || E'\nPASS T112 one regular payroll per month';
  end;

  j := public.propose_payroll_run(run);
  select count(*) into n3 from public.journal_lines where journal_id = j;
  execute 'reset role';
  select confidentiality into v from public.journals where id = j;
  select sum(debit), sum(credit), count(*) filter (where party_id is not null), count(*) into x, y, n, n2 from public.journal_lines where journal_id = j;
  r := r || E'\n' || case when v = 'confidential' and x = y and x = 80000 + exp2 + 6000 and n = 1 and n3 = 0 then 'PASS' else 'FAIL' end
         || ' T113 payroll journal is confidential and balances at ' || x || '; only the advance recovery names a person (' || n || ' of ' || n2 || ' lines); the preparer without clearance sees ' || n3 || ' of them';
  select coalesce(sum(l.debit), 0) into x from public.journal_lines l join public.journal_line_dims dm on dm.line_id = l.id where l.journal_id = j and dm.org_unit_id = fin;
  select coalesce(sum(l.debit), 0) into y from public.journal_lines l join public.journal_line_dims dm on dm.line_id = l.id where l.journal_id = j and dm.org_unit_id = ops;
  r := r || E'\n' || case when x = 86000 and y = exp2 then 'PASS' else 'FAIL' end || ' T114 cost is charged by department: Finance ' || x || ', Operations ' || y;
  select coalesce(sum(credit), 0) into x from public.journal_lines where journal_id = j and account_id = (select id from public.accounts where company_id = c1 and code = '2170');
  select coalesce(sum(credit), 0) into y from public.journal_lines where journal_id = j and account_id = (select id from public.accounts where company_id = c1 and code = '2150');
  select coalesce(sum(credit), 0) into z from public.journal_lines where journal_id = j and account_id = (select id from public.accounts where company_id = c1 and code = '1155');
  r := r || E'\n' || case when x = 12000 and y = 4000 and z = 5000 then 'PASS' else 'FAIL' end
         || ' T115 dues split: statutory ' || x || ' (employee + employer), tax ' || y || ', advance recovered ' || z;

  -- the finance head may approve journals but is not cleared for confidential ones
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.approve_journal(j, 'blind');
    r := r || E'\nFAIL T116 a confidential journal was approved by someone who cannot read it';
  exception when others then r := r || E'\nPASS T116 nobody approves what they cannot read (' || left(sqlerrm, 60) || ')';
  end;
  select count(*) into n from public.employees;
  select count(*) into n2 from public.salary_structures;
  select count(*) into n3 from public.payroll_runs;
  select count(*) into x from public.payroll_lines;
  r := r || E'\n' || case when n = 0 and n2 = 0 and n3 = 0 and x = 0 then 'PASS' else 'FAIL' end || ' T117 the finance head, without payroll permission, sees no employees, salaries or payroll runs';
  select count(*) into n from public.audit_log where entity in ('employees','salary_structures','payroll_runs','payroll_lines');
  select count(*) into n2 from public.audit_log where entity = 'advances';
  r := r || E'\n' || case when n = 0 and n2 > 0 then 'PASS' else 'FAIL' end || ' T118 the audit trail hides payroll rows from people without payroll permission (' || n || ' payroll, ' || n2 || ' other)';
  select count(*) into n from public.journals where id = j;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T119 the confidential payroll journal is invisible to a person without clearance';
  select coalesce(sum(period_debit), 0) into x from public.ledger_balances(array[c1], m2, (current_date + 40), null, null) lb
    join public.accounts ac on ac.id = lb.account_id where ac.code = '6110';
  r := r || E'\n' || case when x = 0 then 'PASS' else 'FAIL' end || ' T120 nothing reaches the ledger before approval (salaries ' || x || ')';

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'Reviewed against the register');
  select status into v from public.payroll_runs where id = run;
  select returned_amount into x from public.advances where id = adv;
  r := r || E'\n' || case when v = 'posted' and x = 5000 and (select status from public.advances where id = adv) = 'partially_settled' then 'PASS' else 'FAIL' end
         || ' T121 payroll posted; 5000 recovered against the advance, which is now partially settled';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select coalesce(sum(period_debit), 0) into x from public.ledger_balances(array[c1], m2, (current_date + 40), null, null) lb
    join public.accounts ac on ac.id = lb.account_id where ac.code = '6110';
  r := r || E'\n' || case when x = 70000 + exp2 then 'PASS' else 'FAIL' end || ' T122 PRIVATE IS NOT FALSE: totals include the confidential payroll (' || x || ') for someone who cannot open it';

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j2 := public.pay_payroll_run(jsonb_build_object('run_id', run, 'bank_ledger_id', bank, 'date', current_date, 'reference', 'BULK-1'));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.reverse_journal(j, current_date, 'test');
    r := r || E'\nFAIL T123 payroll reversed while its payment awaits approval';
  exception when others then r := r || E'\nPASS T123 payroll cannot be reversed while its payment is pending or made';
  end;
  perform public.approve_journal(j2, 'ok');
  select status into v from public.payroll_runs where id = run;
  select coalesce(sum(credit - debit), 0) into x from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where jj.status = 'posted' and l.account_id = (select id from public.accounts where company_id = c1 and code = '2160');
  r := r || E'\n' || case when v = 'paid' and x = 0 then 'PASS' else 'FAIL' end || ' T124 salaries paid; salaries payable is ' || x;

  -- salary revision keeps history
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_salary_structure(jsonb_build_object('employee_id', e1, 'effective_from', current_date, 'reason', 'Annual increment', 'components', jsonb_build_array(
    jsonb_build_object('name', 'Basic', 'kind', 'earning', 'amount', 60000), jsonb_build_object('name', 'HRA', 'kind', 'earning', 'amount', 24000))));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_salary_structure(id1, 'approved', null);
  select count(*) into n from public.salary_structures where employee_id = e1 and status = 'approved';
  select old_value->>'previous_structure' into v from public.audit_log where entity = 'salary_structures' and entity_id = id1 and action = 'approved';
  r := r || E'\n' || case when n = 2 and v = s1::text then 'PASS' else 'FAIL' end || ' T125 a revision adds a new salary record; the earlier one remains (' || n || ' records)';

  -- ------------------------------------------------------------ tasks and custom fields
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_task(jsonb_build_object('company_id', c1, 'entity', 'advances', 'entity_id', adv, 'title', 'Ask for the balance to be settled', 'due_date', current_date + 7));
  begin
    perform public.save_task(jsonb_build_object('id', id1, 'company_id', c1, 'title', 'Ask for the balance to be settled', 'status', 'done'));
    r := r || E'\nFAIL T126 a task was closed without its outcome';
  exception when others then r := r || E'\nPASS T126 closing a follow-up requires its outcome';
  end;
  item := public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'dividend', 'title', 'Interim dividend', 'amount', 100000));
  begin
    perform public.save_custom_values(c1, 'register_items', item, '{"board_ref": ""}'::jsonb);
    r := r || E'\nFAIL T127 a required custom field was left empty';
  exception when others then r := r || E'\nPASS T127 required custom fields are enforced by the database (' || left(sqlerrm, 70) || ')';
  end;
  n := public.save_custom_values(c1, 'register_items', item, '{"board_ref": "BR/2026/14", "unknown_key": "ignored"}'::jsonb);
  select value #>> '{}' into v from public.custom_field_values where field_id = fld and entity_id = item;
  r := r || E'\n' || case when n = 1 and v = 'BR/2026/14' then 'PASS' else 'FAIL' end || ' T128 custom values are stored against defined fields only (' || n || ' stored)';

  execute 'reset role';
  select count(*) into n from public.journals jj where jj.status in ('posted','reversed')
     and (select sum(debit) from public.journal_lines l where l.journal_id = jj.id) <> (select sum(credit) from public.journal_lines l where l.journal_id = jj.id);
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T129 every posted journal balances';
  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', coalesce(r, ' <results lost: a value was null>');
end $t$;
