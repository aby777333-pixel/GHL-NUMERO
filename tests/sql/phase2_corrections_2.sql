-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · PHASE 2, SECOND ROUND OF CORRECTIONS
-- Migration 0013: custom fields by sub-type, a follow-up follows its
-- record, a claim or advance is as confidential as the item it names.
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare
  a uuid := gen_random_uuid();   -- owner (Group Super Admin)
  b uuid := gen_random_uuid();   -- accountant: prepares
  d uuid := gen_random_uuid();   -- finance head: approves; not cleared for confidential records
  g uuid; c1 uuid; r text := ''; v text; v2 text; n int; n2 int; j uuid;
  travel uuid; p1 uuid; bro uuid; ven uuid; div uuid; veh uuid; trip uuid; t1 uuid; claim uuid; adv uuid;
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@p6.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker@p6.numero.invalid'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checker@p6.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('P6', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','C2','name','Corrections Two'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1155","name":"Employee Advances","type":"asset","subtype":"advance","control_type":"advance_paid"},
      {"code":"2165","name":"Reimbursements Payable","type":"liability","subtype":"employee_payable"},
      {"code":"4000","name":"Sales","type":"income","subtype":"revenue"},
      {"code":"6410","name":"Travel","type":"expense","subtype":"operating_expense"}]'::jsonb,
    'account_map', '{"employee_advances":"1155","employee_payable":"2165"}'::jsonb,
    'tax_codes', '[]'::jsonb, 'org_units', '[]'::jsonb));
  perform public.grant_membership('maker@p6.numero.invalid', c1, 'accountant');
  perform public.grant_membership('checker@p6.numero.invalid', c1, 'finance_head');
  select id into travel from public.accounts where company_id = c1 and code = '6410';
  insert into public.custom_field_defs(group_id, company_id, entity, scope_key, key, label, field_type, is_required, status)
  values (g, null, 'register_items', 'vehicle', 'fitness_cert', 'Fitness certificate number', 'text', true, 'active');

  -- ------------------------------------------------------------ custom fields by sub-type
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  p1 := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'employee', 'kind', 'person', 'display_name', 'Asha Finance')))->>'id')::uuid;
  div := public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'dividend', 'title', 'Interim dividend', 'amount', 100000));
  veh := public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'vehicle', 'title', 'Innova', 'data', jsonb_build_object('registration_no', 'TN01AB1234')));
  begin
    n := public.save_custom_values(c1, 'register_items', div, '{}'::jsonb);
    r := r || E'\nPASS T150 a required field of one sub-type does not block a record of another (' || n || ' stored)';
  exception when others then r := r || E'\nFAIL T150 a field that belongs to vehicles blocked a dividend (' || left(sqlerrm, 80) || ')';
  end;
  begin
    perform public.save_custom_values(c1, 'register_items', veh, '{}'::jsonb);
    r := r || E'\nFAIL T151 a vehicle was saved without its required field';
  exception when others then r := r || E'\n' || case when sqlerrm like '%Fitness certificate number%' then 'PASS' else 'FAIL' end || ' T151 the field is still required where it belongs (' || left(sqlerrm, 80) || ')';
  end;

  -- ------------------------------------------------------------ a follow-up follows its record
  t1 := public.save_task(jsonb_build_object('company_id', c1, 'entity', 'register_items', 'entity_id', div, 'title', 'Record the board resolution', 'due_date', current_date + 7));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.tasks where id = t1;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.save_register_item(jsonb_build_object('id', div, 'company_id', c1, 'kind', 'dividend', 'title', 'Interim dividend', 'amount', 100000,
    'confidentiality', 'confidential', 'reason', 'Now price-sensitive'));
  execute 'reset role';
  select confidentiality into v from public.tasks where id = t1;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n2 from public.tasks where id = t1;
  r := r || E'\n' || case when n = 1 and v = 'confidential' and n2 = 0 then 'PASS' else 'FAIL' end
         || ' T152 when a record is reclassified its follow-up follows: visible before (' || n || '), ' || v || ' after, visible to a person not cleared (' || n2 || ')';

  -- ------------------------------------------------------------ a claim or an advance is as confidential as its item
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  trip := public.save_register_item(jsonb_build_object('company_id', c1, 'kind', 'trip', 'title', 'Acquisition talks — Mumbai', 'amount', 80000, 'confidentiality', 'confidential',
    'data', jsonb_build_object('traveller', 'Asha Finance', 'to_place', 'Mumbai', 'purpose', 'Talks')));
  claim := public.save_claim(jsonb_build_object('company_id', c1, 'claimant_party_id', p1, 'title', 'Mumbai', 'register_item_id', trip,
    'lines', jsonb_build_array(jsonb_build_object('expense_date', current_date - 2, 'account_id', travel, 'description', 'Flight', 'amount', 9000, 'has_receipt', true))));
  adv := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', p1, 'purpose', 'Mumbai', 'requested_amount', 20000, 'register_item_id', trip));
  execute 'reset role';
  select confidentiality into v from public.expense_claims where id = claim;
  select confidentiality into v2 from public.advances where id = adv;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.expense_claims where id = claim;
  select count(*) into n2 from public.advances where id = adv;
  r := r || E'\n' || case when v = 'confidential' and v2 = 'confidential' and n = 0 and n2 = 0 then 'PASS' else 'FAIL' end
         || ' T153 a claim and an advance linked to a confidential trip are ' || v || ' and ' || v2 || '; a person not cleared sees ' || n || ' and ' || n2;

  -- ------------------------------------------------------------ a field of one party type
  execute 'reset role';
  insert into public.custom_field_defs(group_id, company_id, entity, scope_key, key, label, field_type, is_required, status)
  values (g, null, 'party', 'broker', 'licence_no', 'Licence number', 'text', true, 'active');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  bro := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'broker', 'display_name', 'Coastal Brokers', 'force', true)))->>'id')::uuid;
  ven := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'vendor', 'display_name', 'Steel Traders', 'force', true)))->>'id')::uuid;
  v := 'saved';
  begin perform public.save_custom_values(c1, 'party', ven, '{}'::jsonb); exception when others then v := left(sqlerrm, 80); end;
  v2 := 'saved';
  begin perform public.save_custom_values(c1, 'party', bro, '{}'::jsonb); exception when others then v2 := left(sqlerrm, 80); end;
  n := public.save_custom_values(c1, 'party', bro, '{"licence_no":"BRK/2026/44"}'::jsonb);
  r := r || E'\n' || case when v = 'saved' and v2 like '%Licence number%' and n = 1 then 'PASS' else 'FAIL' end
         || ' T154 a field required of brokers is asked of a broker and not of a vendor (vendor: ' || v || '; broker: ' || v2 || '; then ' || n || ' stored)';

  execute 'reset role';
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname in ('record_scopes', 'follow_ups_follow_record', 'inherit_item_confidentiality')
     and has_function_privilege('authenticated', p.oid, 'execute');
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T155 the new internal functions cannot be called by a signed-in user (' || n || ' callable)';

  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', coalesce(r, ' <results lost: a value was null>');
end $t$;
