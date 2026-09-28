-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · PHASE 3, PART 4 — SCENARIOS AND PLATFORM
-- Simulations, drivers, scenario studio (workflows), notifications,
-- communications, register of integrations, feature flags, backup
-- records, system health, imports, analytical store, travel detail.
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare
  a uuid := gen_random_uuid();   -- owner (Group Super Admin)
  b uuid := gen_random_uuid();   -- accountant
  d uuid := gen_random_uuid();   -- finance head
  e uuid := gen_random_uuid();   -- employee
  it uuid := gen_random_uuid();  -- IT administrator
  g uuid; c1 uuid; c2 uuid; r text := ''; v text; v2 text; n int; n2 int; n3 int; x numeric; y numeric; z numeric; j uuid; id1 uuid; id2 uuid; id3 uuid; res jsonb;
  bank uuid; sales uuid; rent uuid; travel uuid; emp uuid; cust uuid; sc uuid; fl uuid; fc uuid; adv uuid; doc uuid; al uuid; tk uuid; bt uuid; cm uuid; ig uuid;
  m1 date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@p10.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker@p10.numero.invalid'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checker@p10.numero.invalid'),
    (e, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@p10.numero.invalid'),
    (it, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'it@p10.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('P10', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','PLT','name','Platform Test'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1155","name":"Employee Advances","type":"asset","subtype":"advance","control_type":"advance_paid"},
      {"code":"2165","name":"Reimbursements Payable","type":"liability","subtype":"employee_payable"},
      {"code":"4000","name":"Sales","type":"income","subtype":"revenue"},
      {"code":"6210","name":"Rent","type":"expense","subtype":"operating_expense"},
      {"code":"6410","name":"Travel","type":"expense","subtype":"operating_expense"}]'::jsonb,
    'account_map', '{"employee_advances":"1155","employee_payable":"2165"}'::jsonb, 'tax_codes', '[]'::jsonb, 'org_units', '[]'::jsonb));
  c2 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','OTH','name','Other Co'),
    'accounts', '[{"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"}]'::jsonb,
    'account_map', '{}'::jsonb, 'tax_codes', '[]'::jsonb, 'org_units', '[]'::jsonb));
  perform public.grant_membership('maker@p10.numero.invalid', c1, 'accountant');
  perform public.grant_membership('checker@p10.numero.invalid', c1, 'finance_head');
  perform public.grant_membership('staff@p10.numero.invalid', c1, 'employee');
  perform public.grant_membership('it@p10.numero.invalid', c1, 'it_admin');
  execute 'reset role';
  select id into bank from public.accounts where company_id = c1 and code = '1000';
  select id into sales from public.accounts where company_id = c1 and code = '4000';
  select id into rent from public.accounts where company_id = c1 and code = '6210';
  select id into travel from public.accounts where company_id = c1 and code = '6410';

  -- ------------------------------------------------------------ notifications on approval
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  emp := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'employee', 'kind', 'person', 'display_name', 'Asha Finance', 'force', true)))->>'id')::uuid;
  cust := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'customer', 'display_name', 'Kovai Traders', 'force', true)))->>'id')::uuid;
  j := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', m1, 'voucher_type', 'journal', 'narration', 'Opening', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', bank, 'debit', 500000), jsonb_build_object('account_id', sales, 'credit', 500000))));
  perform public.submit_journal(j);
  select count(*) into n from public.notifications;      -- the maker reads only their own: none
  execute 'reset role';
  select count(*) filter (where user_id = d), count(*) filter (where user_id = b), bool_and(mandatory)::text into n, n2, v from public.notifications where kind = 'approval_waiting';
  r := r || E'\n' || case when n = 1 and n2 = 0 and v = 'true' then 'PASS' else 'FAIL' end
         || ' T240 an entry awaiting approval is told to the person who can approve it (' || n || '), never to the person who made it (' || n2 || ')';
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.notifications;
  begin
    perform public.set_notification_pref('approval_waiting', 'in_app', false);
    r := r || E'\nFAIL T241 a governance notice was switched off';
  exception when others then
    perform public.set_notification_pref('deadline', 'in_app', false);
    n2 := public.mark_notifications(null, true);
    r := r || E'\n' || case when n = 1 and n2 = 1 and (select count(*) from public.notifications where read_at is null) = 0 then 'PASS' else 'FAIL' end
           || ' T241 a person reads their own notices (' || n || '), marks them read, and cannot switch off approvals that wait for them';
  end;
  perform public.approve_journal(j, 'ok'); perform public.post_journal(j);

  -- ------------------------------------------------------------ simulations
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_scenario(jsonb_build_object('company_id', c1, 'name', 'X', 'shocks', '[]'::jsonb));
    r := r || E'\nFAIL T242 a simulation was saved without the permission';
  exception when others then r := r || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL' end || ' T242 a simulation cannot be built without the permission';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  sc := public.save_scenario(jsonb_build_object('company_id', c1, 'name', 'Revenue falls 20%', 'kind', 'conservative', 'horizon_months', 12,
    'shocks', jsonb_build_array(jsonb_build_object('kind', 'revenue_pct', 'value', -20), jsonb_build_object('kind', 'collection_delay_days', 'value', 30))));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.scenarios;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.save_scenario(jsonb_build_object('id', sc, 'company_id', c1, 'name', 'Revenue falls 20%', 'shared', true,
    'shocks', jsonb_build_array(jsonb_build_object('kind', 'revenue_pct', 'value', -20), jsonb_build_object('kind', 'collection_delay_days', 'value', 30))));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n2 from public.scenarios;
  r := r || E'\n' || case when n = 0 and n2 = 1 then 'PASS' else 'FAIL' end
         || ' T243 a simulation belongs to the person who built it (others read ' || n || ') until it is shared (' || n2 || ')';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.journals;
  begin
    perform public.save_scenario_run(jsonb_build_object('scenario_id', sc, 'company_ids', jsonb_build_array(c1, c2), 'base', '{"revenue":500000}'::jsonb, 'result', '{"revenue":400000}'::jsonb));
    r := r || E'\nFAIL T244 a result was saved with figures of a company the person may not read';
  exception when others then
    id1 := public.save_scenario_run(jsonb_build_object('scenario_id', sc, 'company_ids', jsonb_build_array(c1), 'base', '{"revenue":500000}'::jsonb, 'result', '{"revenue":400000}'::jsonb));
    select count(*) into n2 from public.journals;
    select label into v from public.scenario_runs where id = id1;
    r := r || E'\n' || case when n = n2 and v = 'SIMULATION' then 'PASS' else 'FAIL' end
           || ' T244 a saved result is labelled ' || v || ', touches no entry (' || n || ' before, ' || n2 || ' after), and holds only companies its author may read';
  end;
  execute 'reset role';
  begin
    update public.scenario_runs set label = 'ACTUAL' where id = id1;
    r := r || E'\nFAIL T245 a simulation was relabelled as actual';
  exception when others then r := r || E'\nPASS T245 the result of a simulation cannot be relabelled as anything else, even by a privileged role';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id2 := public.save_twin_driver(jsonb_build_object('company_id', c1, 'key', 'Salary_Rise', 'name', 'Salary rise next April', 'unit', 'percent', 'value', 8, 'basis', 'Board minute of March'));
  begin
    perform public.decide_twin_driver(id2, 'approved');
    r := r || E'\nFAIL T246 an assumption was approved by the person who proposed it';
  exception when others then
    execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
    perform public.decide_twin_driver(id2, 'approved');
    select status, key into v, v2 from public.twin_drivers where id = id2;
    r := r || E'\n' || case when v = 'approved' and v2 = 'salary_rise' then 'PASS' else 'FAIL' end || ' T246 an assumption is used only after a second person approves it (' || v || ')';
    -- a new value is proposed: the approved driver stays in use until a second person approves its successor
    id3 := public.save_twin_driver(jsonb_build_object('company_id', c1, 'key', 'salary_rise', 'name', 'Salary rise next April', 'unit', 'percent', 'value', 10, 'basis', 'Board minute of June'));
    select status into v from public.twin_drivers where id = id2;
    select count(*) into n from public.twin_drivers where company_id = c1 and key = 'salary_rise' and status = 'approved';
    execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
    perform public.decide_twin_driver(id3, 'approved');
    select status into v2 from public.twin_drivers where id = id2;
    select value into x from public.twin_drivers where company_id = c1 and key = 'salary_rise' and status = 'approved';
    select count(*) into n2 from public.twin_drivers where company_id = c1 and key = 'salary_rise' and status = 'approved';
    r := r || E'\n' || case when v = 'approved' and n = 1 and v2 = 'retired' and x = 10 and n2 = 1 then 'PASS' else 'FAIL' end
           || ' T269 a driver in use stays in use while its successor awaits approval (' || v || '), and leaves when the successor is approved (' || v2 || ', value now ' || x || ')';
  end;

  -- ------------------------------------------------------------ scenario studio
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  v := '';
  begin
    perform public.save_flow_def(jsonb_build_object('company_id', c1, 'key', 'bad1', 'name', 'Bad', 'definition', jsonb_build_object('steps', jsonb_build_array(
      jsonb_build_object('key', 'release', 'name', 'Release the money', 'action', 'fund_release')))));
    v := v || 'money step without its record;';
  exception when others then null; end;
  begin
    perform public.save_flow_def(jsonb_build_object('company_id', c1, 'key', 'bad2', 'name', 'Bad', 'definition', jsonb_build_object('steps', jsonb_build_array(
      jsonb_build_object('key', 's', 'name', 'Step', 'action', 'review', 'actor_role', 'chief_wizard')))));
    v := v || 'unknown role;';
  exception when others then null; end;
  fl := public.save_flow_def(jsonb_build_object('company_id', c1, 'key', 'site_advance', 'name', 'Site advance', 'category', 'advance', 'trigger_kind', 'form',
    'definition', jsonb_build_object(
      'fields', jsonb_build_array(jsonb_build_object('key', 'site', 'label', 'Site', 'required', true)),
      'steps', jsonb_build_array(
        jsonb_build_object('key', 'request', 'name', 'Request', 'action', 'request'),
        jsonb_build_object('key', 'approve', 'name', 'Approval', 'action', 'approval'),
        jsonb_build_object('key', 'release', 'name', 'Money released', 'action', 'fund_release', 'links_to', 'advances', 'actor_role', 'accountant'),
        jsonb_build_object('key', 'evidence', 'name', 'Evidence', 'action', 'evidence', 'required_documents', jsonb_build_array('receipt')),
        jsonb_build_object('key', 'review', 'name', 'Review', 'action', 'review', 'optional', true)))));
  begin
    perform public.start_flow_case(jsonb_build_object('flow_id', fl, 'company_id', c1, 'title', 'Too early', 'data', jsonb_build_object('site', 'Rubycon')));
    v := v || 'draft started;';
  exception when others then null; end;
  perform public.set_flow_status(fl, 'active');
  r := r || E'\n' || case when v = '' then 'PASS' else 'FAIL' end
         || ' T247 a workflow is checked when it is designed: a step that releases money must point to the record that does; roles must exist; a draft cannot be started ' || v;

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.start_flow_case(jsonb_build_object('flow_id', fl, 'company_id', c1, 'title', 'Rubycon shuttering'));
    r := r || E'\nFAIL T248 a case started without its required field';
  exception when others then r := r || E'\n' || case when sqlerrm like '%Site%' then 'PASS' else 'FAIL' end || ' T248 the form of the workflow is enforced (' || left(sqlerrm, 70) || ')';
  end;
  fc := public.start_flow_case(jsonb_build_object('flow_id', fl, 'company_id', c1, 'title', 'Rubycon shuttering', 'amount', 40000, 'party_id', emp, 'data', jsonb_build_object('site', 'Rubycon')));
  v := public.complete_flow_step(jsonb_build_object('case_id', fc, 'note', 'Needed for shuttering material'));
  begin
    perform public.complete_flow_step(jsonb_build_object('case_id', fc, 'note', 'self'));
    r := r || E'\nFAIL T249 the person who started the case approved it';
  exception when others then r := r || E'\n' || case when sqlerrm like '%maker-checker%' then 'PASS' else 'FAIL' end || ' T249 the person who started a case cannot complete its approval step';
  end;
  -- where the group lets the owner override, that is the owner's alone: another person still cannot approve the case they started
  execute 'reset role';
  update public.groups set settings = jsonb_set(settings, '{controls,maker_checker}', '"owner_override"') where id = g;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.complete_flow_step(jsonb_build_object('case_id', fc, 'note', 'self, under override'));
    r := r || E'\nFAIL T270 with owner override on, a person who is not the owner approved the case they started';
  exception when others then r := r || E'\n' || case when sqlerrm like '%maker-checker%' then 'PASS' else 'FAIL' end || ' T270 owner override is the owner''s alone: another person still cannot approve the case they started';
  end;
  execute 'reset role';
  update public.groups set settings = jsonb_set(settings, '{controls,maker_checker}', '"enforced"') where id = g;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    null;
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.complete_flow_step(jsonb_build_object('case_id', fc, 'note', 'Approved for 40000'));
  v := '';
  begin perform public.complete_flow_step(jsonb_build_object('case_id', fc, 'entity_id', gen_random_uuid())); v := v || 'wrong role;'; exception when others then null; end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.complete_flow_step(jsonb_build_object('case_id', fc)); v := v || 'no record;'; exception when others then null; end;
  begin perform public.complete_flow_step(jsonb_build_object('case_id', fc, 'entity_id', gen_random_uuid())); v := v || 'record that does not exist;'; exception when others then null; end;
  select count(*) into n from public.journals;
  adv := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', emp, 'purpose', 'Rubycon shuttering', 'requested_amount', 40000));
  perform public.complete_flow_step(jsonb_build_object('case_id', fc, 'entity_id', adv, 'note', 'Advance requested under its own approval'));
  select count(*) into n2 from public.journals;
  r := r || E'\n' || case when v = '' and n = n2 then 'PASS' else 'FAIL' end
         || ' T250 the step that releases money is complete only when it points to a real advance, by the role it is for; the workflow itself posts nothing (' || n2 - n || ' entries) ' || v;
  begin
    perform public.complete_flow_step(jsonb_build_object('case_id', fc, 'note', 'Receipts'));
    r := r || E'\nFAIL T251 the evidence step passed without its document';
  exception when others then
    res := public.register_document(jsonb_build_object('company_id', c1, 'name', 'receipt.pdf', 'sha256', repeat('ab', 32), 'storage_path', c1::text || '/receipt.pdf', 'doc_kind', 'receipt'));
    perform public.link_document((res->>'id')::uuid, 'flow_cases', fc);
    perform public.complete_flow_step(jsonb_build_object('case_id', fc, 'note', 'Receipts attached'));
    v := public.complete_flow_step(jsonb_build_object('case_id', fc, 'skip', true, 'note', 'Small amount; reviewed with the claim'));
    r := r || E'\n' || case when v = 'completed' and (select count(*) from public.flow_case_steps where case_id = fc and status = 'done') = 4 then 'PASS' else 'FAIL' end
           || ' T251 the evidence step waits for a document of the required kind; an optional step is skipped with its reason; the case is ' || v;
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_flow_def(jsonb_build_object('id', fl, 'key', 'site_advance', 'name', 'Site advance (two approvals)', 'definition', jsonb_build_object('steps', jsonb_build_array(
    jsonb_build_object('key', 'request', 'name', 'Request', 'action', 'request'), jsonb_build_object('key', 'approve', 'name', 'Approval', 'action', 'approval')))));
  id2 := public.clone_flow_def(fl, 'travel_advance', 'Travel advance', c1);
  select count(*) into n from public.flow_case_steps where case_id = fc;
  r := r || E'\n' || case when id1 <> fl and (select version from public.flow_defs where id = id1) = 2 and (select status from public.flow_defs where id = fl) = 'active'
                            and n = 5 and (select cloned_from from public.flow_defs where id = id2) = fl then 'PASS' else 'FAIL' end
         || ' T252 a workflow in use is not edited: the change is version 2, the case keeps its ' || n || ' steps, and a copy can be made under another name';

  -- an employee may read workflows and nothing more: they raise a request and state it, and go no further
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id3 := public.start_flow_case(jsonb_build_object('flow_id', fl, 'company_id', c1, 'title', 'Monarch fencing', 'amount', 15000, 'data', jsonb_build_object('site', 'Monarch')));
  v := public.complete_flow_step(jsonb_build_object('case_id', id3, 'note', 'Fencing wire and posts'));
  select action into v2 from public.flow_case_steps where case_id = id3 and status = 'active';
  begin
    perform public.complete_flow_step(jsonb_build_object('case_id', id3, 'note', 'mine'));
    r := r || E'\nFAIL T271 a person with flow.view alone completed a step that was not theirs';
  exception when others then
    execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
    select count(*) into n from public.flow_cases where id = id3;
    execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', it, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
    begin
      perform public.complete_flow_step(jsonb_build_object('case_id', id3, 'note', 'not mine'));
      v := 'someone else completed it';
    exception when others then null;
    end;
    r := r || E'\n' || case when v = 'open' and v2 = 'approval' and n = 1 then 'PASS' else 'FAIL' end
           || ' T271 the person who started a case states their own request and goes no further (next step: ' || v2 || '); a person without the permission completes nothing';
  end;

  -- ------------------------------------------------------------ alerts and follow-ups
  execute 'reset role';
  insert into public.alerts(company_id, kind, attention, title, explanation, dedupe_key)
  values (c1, 'test_alert', 'critical', 'Bank details changed before a payment', 'Changed two hours before payment.', 't-9') returning id into al;
  insert into public.alerts(company_id, kind, attention, title, explanation, dedupe_key) values (c1, 'test_alert', 'review', 'Routine', 'Routine.', 't-10');
  select count(*) filter (where class = 'critical' and mandatory), count(distinct entity_id) into n, n2 from public.notifications where kind = 'alert';
  r := r || E'\n' || case when n >= 1 and n2 = 1 then 'PASS' else 'FAIL' end
         || ' T253 a critical alert is told to those who watch the company (' || n || ' people), as critical and not to be switched off; a routine alert tells nobody';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  tk := public.save_task(jsonb_build_object('company_id', c1, 'title', 'Call the bank', 'due_date', current_date, 'owner_user', d));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  n := public.refresh_notifications();
  n2 := public.refresh_notifications();
  select count(*) filter (where kind = 'follow_up_assigned'), count(*) filter (where kind = 'follow_up_due') into n3, x from public.notifications;
  r := r || E'\n' || case when n >= 1 and n2 = 0 and n3 = 1 and x = 1 then 'PASS' else 'FAIL' end
         || ' T254 a follow-up given to a person is told to them; what falls due is found when they open the application (' || n || ' new), and finding it again adds nothing (' || n2 || ')';

  -- ------------------------------------------------------------ communications
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.prepare_communication(jsonb_build_object('company_id', c1, 'party_id', cust, 'subject', 'X', 'body', 'Y'));
    r := r || E'\nFAIL T255 an employee prepared a communication to a customer';
  exception when others then r := r || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL' end || ' T255 a communication cannot be prepared without the permission';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_message_template(jsonb_build_object('company_id', c1, 'key', 'payment_reminder', 'name', 'Reminder', 'subject', 'Payment due — {{invoice_no}}', 'body', 'Dear {{party}}, {{amount}} is due.'));
  id2 := public.save_message_template(jsonb_build_object('company_id', c1, 'key', 'payment_reminder', 'name', 'Reminder', 'subject', 'Payment overdue — {{invoice_no}}', 'body', 'Dear {{party}}, {{amount}} is overdue.'));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  cm := public.prepare_communication(jsonb_build_object('company_id', c1, 'party_id', cust, 'template_key', 'payment_reminder', 'to_address', 'accounts@kovai.invalid',
    'subject', 'Payment overdue — INV-1', 'body', 'Dear Kovai Traders, 118000 is overdue.'));
  v := '';
  begin perform public.mark_communication(cm, 'sent_by_person', current_date, null); v := v || 'sent without saying how;'; exception when others then null; end;
  perform public.mark_communication(cm, 'sent_by_person', current_date, 'Sent from the accounts mailbox by Asha');
  execute 'reset role';
  begin update public.communications set body = 'rewritten' where id = cm; v := v || 'rewritten;'; exception when others then null; end;
  begin delete from public.communications where id = cm; v := v || 'deleted;'; exception when others then null; end;
  select count(*) filter (where is_active), max(version) into n, n2 from public.message_templates where company_id = c1 and key = 'payment_reminder';
  r := r || E'\n' || case when v = '' and n = 1 and n2 = 2 and (select status from public.communications where id = cm) = 'sent_by_person' then 'PASS' else 'FAIL' end
         || ' T256 NUMERO prepares, a person sends and says how; what was sent cannot be rewritten or removed; a changed template is version ' || n2 || ' ' || v;

  -- ------------------------------------------------------------ register of integrations
  perform set_config('request.jwt.claims', json_build_object('sub', it, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  v := '';
  begin
    perform public.save_integration(jsonb_build_object('company_id', c1, 'key', 'sms', 'name', 'SMS gateway', 'kind', 'sms', 'notes', 'api_key: 9f8e7d6c5b4a39281706'));
    v := v || 'a key was stored;';
  exception when others then null; end;
  begin
    perform public.save_integration(jsonb_build_object('company_id', c1, 'key', 'payouts', 'name', 'Bank payouts', 'kind', 'bank', 'direction', 'outbound', 'moves_money', true,
      'environment', 'production', 'status', 'testing', 'secret_location', 'Server secret BANK_PAYOUT_KEY'));
    v := v || 'money in production without a sandbox test;';
  exception when others then null; end;
  ig := public.save_integration(jsonb_build_object('company_id', c1, 'key', 'payouts', 'name', 'Bank payouts', 'kind', 'bank', 'direction', 'outbound', 'moves_money', true,
    'environment', 'sandbox', 'status', 'testing', 'secret_location', 'Server secret BANK_PAYOUT_KEY', 'tested_in_sandbox_on', current_date));
  begin
    perform public.save_integration(jsonb_build_object('id', ig, 'company_id', c1, 'key', 'payouts', 'name', 'Bank payouts', 'kind', 'bank', 'direction', 'outbound', 'moves_money', true,
      'environment', 'production', 'status', 'active', 'secret_location', 'Server secret BANK_PAYOUT_KEY'));
    v := v || 'made active by someone other than the group administrator;';
  exception when others then null; end;
  select risk into v2 from public.integrations where id = ig;
  r := r || E'\n' || case when v = '' and v2 = 'high' then 'PASS' else 'FAIL' end
         || ' T257 the register holds no secret; an integration that can move money is ' || v2 || ' risk, needs a recorded sandbox test, and is made active only by a Group Super Admin ' || v;

  -- ------------------------------------------------------------ feature flags, backups, health
  begin
    perform public.set_feature_flag(jsonb_build_object('module', 'inventory', 'company_id', c1, 'enabled', false));
    r := r || E'\nFAIL T258 a capability was switched off by someone other than the group administrator';
  exception when others then
    execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
    perform public.set_feature_flag(jsonb_build_object('module', 'inventory', 'company_id', c1, 'enabled', false, 'note', 'Not used by this company'));
    perform public.set_feature_flag(jsonb_build_object('module', 'inventory', 'company_id', c1, 'enabled', true, 'note', 'Trial from October'));
    select count(*), bool_and(enabled)::text into n, v from public.feature_flags where module = 'inventory';
    r := r || E'\n' || case when n = 1 and v = 'true' then 'PASS' else 'FAIL' end || ' T258 a capability is switched on or off for a company by a Group Super Admin only';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    res := public.system_health();
    r := r || E'\nFAIL T259 an employee read the health of the system';
  exception when others then r := r || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL' end || ' T259 the health of the system is not shown without the permission';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', it, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  res := public.system_health();
  v := res->'backups'->>'state';
  begin
    perform public.record_backup_check(jsonb_build_object('kind', 'backup', 'performed_on', current_date + 1, 'outcome', 'succeeded', 'evidence', 'x', 'performed_by_name', 'IT'));
    r := r || E'\nFAIL T260 a backup was recorded for a day that has not come';
  exception when others then null; end;
  bt := public.record_backup_check(jsonb_build_object('kind', 'backup', 'performed_on', current_date, 'outcome', 'succeeded', 'evidence', 'Supabase dashboard, daily backup listed', 'performed_by_name', 'IT'));
  res := public.system_health();
  execute 'reset role';
  v2 := '';
  begin update public.backup_checks set outcome = 'failed' where id = bt; v2 := v2 || 'changed;'; exception when others then null; end;
  r := r || E'\n' || case when v = 'not_recorded' and res->'backups'->>'state' = 'attention' and res->'backups'->>'recovery_readiness' like 'unproven%'
                            and (res->'posting_engine'->>'posted_entries_that_do_not_balance')::int = 0 and res->'posting_engine'->>'state' = 'ok'
                            and res->'queues_and_jobs'->>'state' = 'not_connected' and v2 = '' then 'PASS' else 'FAIL' end
         || ' T260 with nothing on record the backups are "' || v || '"; with a backup and no restore test, readiness is "' || (res->'backups'->>'recovery_readiness') || '"; a record cannot be changed ' || v2;

  -- ------------------------------------------------------------ a statement line matched in part is not reconciled
  execute 'reset role';
  insert into public.bank_accounts(company_id, ledger_account_id, name, currency, kind) values (c1, bank, 'Test bank', 'INR', 'bank') returning id into id3;
  insert into public.bank_transactions(company_id, bank_account_id, txn_date, amount, narration, fingerprint, status)
  values (c1, id3, current_date - 20, 1500, 'Matched in part', 'p3-t279', 'partial');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', it, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  res := public.system_health();
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  n := public.refresh_notifications();
  execute 'reset role';
  select count(*) into n2 from public.notifications where kind = 'reconciliation_incomplete' and user_id = d and entity_id = id3;
  r := r || E'\n' || case when (res->'bank_statements'->>'statement_lines_unmatched')::int = 1 and res->'bank_statements'->>'state' = 'attention' and n2 = 1 then 'PASS' else 'FAIL' end
         || ' T279 a statement line matched in part is not reconciled: the health of the system counts ' || coalesce(res->'bank_statements'->>'statement_lines_unmatched', '?') || ' and the person who reconciles is told (' || n2 || ')';

  -- ------------------------------------------------------------ imports
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.stage_import(jsonb_build_object('company_id', c1, 'kind', 'journals', 'file_name', 'legacy-april.csv', 'sha256', repeat('11', 32), 'rows', jsonb_build_array(
    jsonb_build_object('date', m1, 'ref', 'JV-1', 'account', '6210', 'debit', '25000', 'narration', 'Rent'),
    jsonb_build_object('date', m1, 'ref', 'JV-1', 'account', '1000', 'credit', '24000', 'narration', 'Rent'),
    jsonb_build_object('date', m1, 'ref', 'JV-2', 'account', 'R-99', 'debit', '500', 'narration', 'Misc'),
    jsonb_build_object('date', m1, 'ref', 'JV-2', 'account', '1000', 'credit', '500', 'narration', 'Misc'))));
  select ok::text, checks into v, res from public.import_batches where id = id1;
  begin
    perform public.commit_import(id1);
    r := r || E'\nFAIL T261 a file that failed its checks was committed';
  exception when others then
    r := r || E'\n' || case when v = 'false' and (res->'balance'->>'passed') = 'false' and (res->'mapping'->'unmapped') = '["R-99"]'::jsonb and (res->'validation'->>'passed') = 'false' then 'PASS' else 'FAIL' end
           || ' T261 a file with a voucher that does not balance and an account that is not mapped fails its checks and cannot be committed';
  end;
  select count(*) into n from public.journals where company_id = c1;
  id2 := public.stage_import(jsonb_build_object('company_id', c1, 'kind', 'journals', 'file_name', 'legacy-april.csv', 'sha256', repeat('22', 32), 'mapping', jsonb_build_object('R-99', '6410'),
    'rows', jsonb_build_array(
    jsonb_build_object('date', m1, 'ref', 'JV-1', 'account', '6210', 'debit', '25000', 'narration', 'Rent'),
    jsonb_build_object('date', m1, 'ref', 'JV-1', 'account', '1000', 'credit', '25000', 'narration', 'Rent'),
    jsonb_build_object('date', m1, 'ref', 'JV-2', 'account', 'R-99', 'debit', '500', 'narration', 'Misc'),
    jsonb_build_object('date', m1, 'ref', 'JV-2', 'account', '1000', 'credit', '500', 'narration', 'Misc'))));
  select count(*) into n2 from public.journals where company_id = c1;
  res := public.commit_import(id2);
  select count(*), count(*) filter (where status = 'draft' and origin = 'import') into n3, x from public.journals where company_id = c1 and source = 'import';
  id3 := public.stage_import(jsonb_build_object('company_id', c1, 'kind', 'journals', 'file_name', 'legacy-april-again.csv', 'sha256', repeat('22', 32), 'mapping', jsonb_build_object('R-99', '6410'),
    'rows', jsonb_build_array(
    jsonb_build_object('date', m1, 'ref', 'JV-1', 'account', '6210', 'debit', '25000', 'narration', 'Rent'),
    jsonb_build_object('date', m1, 'ref', 'JV-1', 'account', '1000', 'credit', '25000', 'narration', 'Rent'))));
  select ok::text, checks->'duplicates'->>'file_already_committed' into v, v2 from public.import_batches where id = id3;
  r := r || E'\n' || case when n = n2 and n3 = 2 and x = 2 and (res->>'records')::int = 2 and v = 'false' and v2 = 'true' then 'PASS' else 'FAIL' end
         || ' T262 staging a file adds nothing to the books; committing it enters ' || n3 || ' entries as drafts, not posted; the same file brought in again is refused';
  select coalesce(sum(l.debit - l.credit), 0) into y from public.journal_lines l join public.journals jj on jj.id = l.journal_id where jj.status = 'posted' and l.account_id = rent;
  id3 := public.stage_import(jsonb_build_object('company_id', c1, 'kind', 'legacy_trial_balance', 'file_name', 'tally-tb.csv', 'sha256', repeat('33', 32), 'period_end', current_date,
    'rows', jsonb_build_array(
    jsonb_build_object('account', '1000', 'name', 'Bank', 'debit', '500000'),
    jsonb_build_object('account', 'CAP', 'name', 'Capital in the old system', 'credit', '500000'))));
  res := public.commit_import(id3);
  select count(*) into n from public.legacy_balances where company_id = c1;
  select count(*) into n2 from public.journals where company_id = c1 and status = 'posted';
  r := r || E'\n' || case when n = 2 and n2 = 1 and y = 0 then 'PASS' else 'FAIL' end
         || ' T263 the trial balance of the earlier system is kept beside the books for comparison (' || n || ' balances); nothing of it is posted';

  -- ------------------------------------------------------------ analytical store
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  res := public.refresh_facts(c1);
  select coalesce(sum(debit), 0) into x from public.fact_ledger_monthly where company_id = c1 and org_unit_id is null;
  select coalesce(sum(l.debit), 0) into y from public.journal_lines l join public.journals jj on jj.id = l.journal_id where jj.company_id = c1 and jj.status = 'posted';
  r := r || E'\n' || case when x = y and x = 500000 and (res->>'journals')::int = 1 then 'PASS' else 'FAIL' end
         || ' T264 the monthly totals agree with the posted entries (' || x || ' against ' || y || ') and leave drafts out';

  -- ------------------------------------------------------------ travel detail and generator
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  v := '';
  begin
    perform public.save_claim(jsonb_build_object('company_id', c1, 'claimant_party_id', emp, 'title', 'Chennai', 'lines', jsonb_build_array(
      jsonb_build_object('expense_date', current_date - 2, 'account_id', travel, 'description', 'Train to Chennai', 'amount', 1850, 'has_receipt', true,
        'detail', jsonb_build_object('kind', 'train', 'operator', 'Indian Railways', 'booking_ref', 'PNR 4521', 'origin', 'Coimbatore', 'destination', 'Chennai', 'class', '2A',
          'base_fare', 1600, 'taxes', 80, 'booking_charges', 100)))));
    v := v || 'parts that do not add up;';
  exception when others then null; end;
  begin
    perform public.save_claim(jsonb_build_object('company_id', c1, 'claimant_party_id', emp, 'title', 'Chennai', 'lines', jsonb_build_array(
      jsonb_build_object('expense_date', current_date - 2, 'account_id', travel, 'description', 'Rocket', 'amount', 100, 'has_receipt', true, 'detail', jsonb_build_object('kind', 'rocket')))));
    v := v || 'unknown kind of booking;';
  exception when others then null; end;
  id1 := public.save_claim(jsonb_build_object('company_id', c1, 'claimant_party_id', emp, 'title', 'Chennai', 'lines', jsonb_build_array(
    jsonb_build_object('expense_date', current_date - 2, 'account_id', travel, 'description', 'Train to Chennai', 'amount', 1850, 'has_receipt', true,
      'detail', jsonb_build_object('kind', 'train', 'operator', 'Indian Railways', 'booking_ref', 'PNR 4521', 'origin', 'Coimbatore', 'destination', 'Chennai', 'class', '2A',
        'base_fare', 1600, 'taxes', 80, 'booking_charges', 170)),
    jsonb_build_object('expense_date', current_date - 2, 'account_id', travel, 'description', 'Auto to station', 'amount', 120, 'has_receipt', false))));
  select detail->>'booking_ref' into v2 from public.expense_claim_lines where claim_id = id1 and line_no = 1;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id2 := public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'generator', 'title', 'Head office generator 62.5 kVA', 'data', jsonb_build_object('located_at', 'Head office', 'fuel_type', 'Diesel')));
  select u.type_key into v from (select v as prior) q, public.register_items i join public.org_units u on u.id = i.org_unit_id where i.id = id2 and q.prior = '';
  r := r || E'\n' || case when v2 = 'PNR 4521' and v = 'equipment' then 'PASS' else 'FAIL' end
         || ' T265 a booking records its operator, reference, route and class, and its parts must add up to the line; a generator has a tag of its own (' || coalesce(v, 'a refusal was missed') || ')';

  -- ------------------------------------------------------------ the owner is told what needs the owner
  execute 'reset role';
  select count(*) filter (where user_id = a), count(*) filter (where user_id = d) into n, n2 from public.notifications where kind = 'approval_waiting' and entity = 'journal';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.save_attention_rule(jsonb_build_object('kind', 'approval:journal', 'min_amount', 500000, 'class', 'owner_action', 'note', 'Above five lakh the owner decides'));
  perform public.save_attention_rule(jsonb_build_object('kind', 'test_difference', 'min_amount', 150, 'class', 'owner_action', 'note', 'Short by more than 150'));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date, 'voucher_type', 'journal', 'narration', 'Rent for the year', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', rent, 'debit', 750000), jsonb_build_object('account_id', bank, 'credit', 750000))));
  perform public.submit_journal(j);
  id1 := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date, 'voucher_type', 'journal', 'narration', 'Rent for a day', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', rent, 'debit', 200), jsonb_build_object('account_id', bank, 'credit', 200))));
  perform public.submit_journal(id1);
  execute 'reset role';
  select count(*) filter (where user_id = a and entity_id = j and class = 'owner_action' and mandatory), count(*) filter (where user_id = d and entity_id = j),
         count(*) filter (where user_id = a and entity_id = id1) + 10 * count(*) filter (where user_id = d and entity_id = id1)
    into n3, x, y from public.notifications where kind = 'approval_waiting';
  r := r || E'\n' || case when n = 0 and n2 >= 1 and n3 = 1 and x = 1 and y = 10 then 'PASS' else 'FAIL' end
         || ' T276 of the approvals that wait, the owner was told of ' || n || ' that were routine (the approver of ' || n2 || '), and is told of the one the rules class for the owner (' || n3 || ')';
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, dedupe_key)
  values (c1, 'test_difference', 'priority', 'Cash short', 'Counted 4800 against 5000.', jsonb_build_object('difference', -200), 't-11') returning id into al;
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, dedupe_key)
  values (c1, 'test_difference', 'priority', 'Cash short a little', 'Counted 4900 against 5000.', jsonb_build_object('difference', -100), 't-12') returning id into id2;
  select string_agg(distinct class, ',') into v from public.notifications where kind = 'alert' and entity_id = al;
  select string_agg(distinct class, ',') into v2 from public.notifications where kind = 'alert' and entity_id = id2;
  r := r || E'\n' || case when v = 'owner_action' and v2 = 'management_action' then 'PASS' else 'FAIL' end
         || ' T277 an alert that carries a difference and no amount is classed by its size, whichever way it points: 200 short is ' || coalesce(v, 'not told') || ', 100 short is ' || coalesce(v2, 'not told');

  -- ------------------------------------------------------------ integrity
  execute 'reset role';
  -- ------------------------------------------------------------ how many rows the API hands over
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*), min(q.k), max(q.k) into n, n2, n3 from public.api_row_probe() as q(k);
  execute 'reset role';
  r := r || E'\n' || case when n = 1001 and n2 = 1 and n3 = 1001 and not has_function_privilege('anon', 'public.api_row_probe()', 'execute') then 'PASS' else 'FAIL' end
         || ' T278 the measure of a page returns ' || n || ' numbers to a signed-in person, reads no table, and cannot be called by someone who is not signed in';

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname in ('notify_holders', 'notify_user', 'attention_class', 'on_approval_request', 'on_alert', 'on_task_assigned', 'on_case_assigned',
       'guard_communication', 'guard_backup_check', 'check_flow_definition', 'check_travel_detail', 'flow_actions', 'flow_links')
     and has_function_privilege('authenticated', p.oid, 'execute');
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T266 the internal platform functions cannot be called by a signed-in user (' || n || ' callable)';
  select count(*) into n from pg_tables t where t.schemaname = 'public' and not t.rowsecurity;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T267 every table has row level security (' || n || ' without)';

  select count(*) into n from (
    select distinct p.oid from pg_policies pol
      join pg_proc p on (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) like '%numero_private.' || p.proname || '(%'
      join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'numero_private'
     where pol.schemaname in ('public', 'storage') and not has_function_privilege('authenticated', p.oid, 'execute')) q;
  r := r || E'
' || case when n = 0 then 'PASS' else 'FAIL' end || ' T268 every function that a read rule relies on can be run by a signed-in user (' || n || ' cannot)';

  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', coalesce(r, ' <results lost: a value was null>');
end $t$;
