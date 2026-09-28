-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · PHASE 3, PART 2 — INVESTMENTS
-- Corporate structure, shareholders, holdings (purchase, sale, income,
-- valuation), funds, commitments, capital calls, units, distributions and
-- dividends, net asset value, management fee.
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare
  a uuid := gen_random_uuid();   -- owner (Group Super Admin)
  b uuid := gen_random_uuid();   -- accountant: prepares; cleared for confidential records
  d uuid := gen_random_uuid();   -- finance head: approves; cleared for confidential records
  u uuid := gen_random_uuid();   -- finance head of the same company, NOT cleared
  e uuid := gen_random_uuid();   -- employee
  g uuid; c1 uuid; c2 uuid; r text := ''; v text; n int; n2 int; x numeric; y numeric; z numeric; w numeric; j uuid; j2 uuid; id1 uuid; id2 uuid;
  bank uuid; port uuid; cap uuid; re uuid; gain uuid; unreal uuid; income uuid; dpay uuid;
  p_inv1 uuid; p_inv2 uuid; p_mgr uuid; p_co uuid; p_sh uuid; hold uuid; hold2 uuid; fund uuid; cm1 uuid; cm2 uuid; call uuid; l1 uuid; l2 uuid; dist uuid; nav uuid; link uuid;
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@p8.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker@p8.numero.invalid'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checker@p8.numero.invalid'),
    (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'uncleared@p8.numero.invalid'),
    (e, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@p8.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('P8', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','FND','name','Fund One'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1185","name":"TDS Receivable","type":"asset","subtype":"tax_receivable","control_type":"tax"},
      {"code":"1220","name":"Portfolio Investments","type":"asset","subtype":"investment"},
      {"code":"2110","name":"AP","type":"liability","subtype":"payable","control_type":"payable"},
      {"code":"2128","name":"Distributions Payable","type":"liability","subtype":"other_liability"},
      {"code":"2129","name":"Management Fees Payable","type":"liability","subtype":"other_liability"},
      {"code":"2150","name":"TDS Payable","type":"liability","subtype":"tax_payable","control_type":"tax"},
      {"code":"3110","name":"Unit Capital","type":"equity","subtype":"capital"},
      {"code":"3300","name":"Retained Earnings","type":"equity","subtype":"retained_earnings","control_type":"retained_earnings"},
      {"code":"4930","name":"Gain or Loss on Investments","type":"income","subtype":"other_income"},
      {"code":"4940","name":"Fair Value Changes","type":"income","subtype":"other_income"},
      {"code":"4950","name":"Dividend Income","type":"income","subtype":"other_income"},
      {"code":"6540","name":"Management Fees","type":"expense","subtype":"operating_expense"}]'::jsonb,
    'account_map', '{"ap_control":"2110","retained_earnings":"3300","tds_payable":"2150","tds_receivable":"1185","investment_gain_loss":"4930","unrealised_gain_loss":"4940","investment_income":"4950","distribution_payable":"2128","management_fee_expense":"6540","management_fee_payable":"2129"}'::jsonb,
    'tax_codes', '[]'::jsonb, 'org_units', '[]'::jsonb));
  c2 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','OPC','name','Operating Co'),
    'accounts', '[{"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},{"code":"3100","name":"Share Capital","type":"equity","subtype":"capital"}]'::jsonb,
    'account_map', '{}'::jsonb, 'tax_codes', '[]'::jsonb, 'org_units', '[]'::jsonb));
  perform public.grant_membership('maker@p8.numero.invalid', c1, 'accountant');
  perform public.grant_membership('checker@p8.numero.invalid', c1, 'finance_head');
  perform public.grant_membership('uncleared@p8.numero.invalid', c1, 'finance_head');
  perform public.grant_membership('staff@p8.numero.invalid', c1, 'employee');
  execute 'reset role';
  insert into public.vault_grants(user_id, company_id, max_level, granted_by, reason) values
    (b, c1, 'confidential', a, 'Works on the fund'), (d, c1, 'confidential', a, 'Approves for the fund');
  select id into bank from public.accounts where company_id = c1 and code = '1000';
  select id into port from public.accounts where company_id = c1 and code = '1220';
  select id into cap from public.accounts where company_id = c1 and code = '3110';
  select id into re from public.accounts where company_id = c1 and code = '3300';
  select id into gain from public.accounts where company_id = c1 and code = '4930';
  select id into unreal from public.accounts where company_id = c1 and code = '4940';
  select id into income from public.accounts where company_id = c1 and code = '4950';
  select id into dpay from public.accounts where company_id = c1 and code = '2128';

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  p_inv1 := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'investor', 'display_name', 'Investor One', 'force', true)))->>'id')::uuid;
  p_inv2 := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'investor', 'display_name', 'Investor Two', 'force', true)))->>'id')::uuid;
  p_mgr := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'vendor', 'display_name', 'Fund Manager LLP', 'force', true)))->>'id')::uuid;
  p_co := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'other', 'display_name', 'Portfolio Company A', 'force', true)))->>'id')::uuid;

  -- ------------------------------------------------------------ corporate structure
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_corporate_link(jsonb_build_object('parent_company_id', c1, 'child_company_id', c2, 'relation', 'subsidiary', 'ownership_pct', 60));
    r := r || E'\nFAIL T190 an employee changed the corporate structure';
  exception when others then r := r || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL' end || ' T190 the corporate structure cannot be changed without the permission';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  link := public.save_corporate_link(jsonb_build_object('parent_company_id', c1, 'child_company_id', c2, 'relation', 'subsidiary', 'ownership_pct', 60));
  v := '';
  begin
    perform public.save_corporate_link(jsonb_build_object('parent_party_id', p_co, 'child_company_id', c2, 'relation', 'associate', 'ownership_pct', 45));
    v := v || 'over-100 accepted;';
  exception when others then null;
  end;
  begin
    perform public.save_corporate_link(jsonb_build_object('parent_company_id', c2, 'child_company_id', c1, 'relation', 'subsidiary', 'ownership_pct', 10));
    v := v || 'circle accepted;';
  exception when others then null;
  end;
  perform public.save_corporate_link(jsonb_build_object('parent_party_id', p_co, 'child_company_id', c2, 'relation', 'associate', 'ownership_pct', 40));
  select count(*) into n from public.corporate_links;
  r := r || E'\n' || case when v = '' and n = 2 then 'PASS' else 'FAIL' end
         || ' T191 owners cannot hold more than the whole, and a company cannot own its own owner (' || n || ' links on record) ' || v;

  -- ------------------------------------------------------------ holdings
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_holding(jsonb_build_object('company_id', c1, 'name', 'Wrong', 'investment_account_id', income));
    r := r || E'\nFAIL T192 an income ledger was accepted as the ledger of an investment';
  exception when others then r := r || E'\nPASS T192 an investment is carried in an asset ledger';
  end;
  hold := public.save_holding(jsonb_build_object('company_id', c1, 'name', 'Portfolio Company A — equity', 'investee_party_id', p_co, 'investment_account_id', port, 'measurement', 'cost'));
  j := public.propose_holding_txn(jsonb_build_object('holding_id', hold, 'kind', 'purchase', 'date', current_date - 60, 'quantity', 1000, 'amount', 500000, 'bank_ledger_id', bank));
  select quantity, cost into x, y from public.holdings where id = hold;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select quantity, cost into z, w from public.holdings where id = hold;
  r := r || E'\n' || case when x = 0 and y = 0 and z = 1000 and w = 500000 then 'PASS' else 'FAIL' end
         || ' T193 a purchase changes the holding only when its entry is approved: ' || x || ' → ' || z || ' units at ' || w;

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.propose_holding_txn(jsonb_build_object('holding_id', hold, 'kind', 'sale', 'date', current_date - 30, 'quantity', 1500, 'amount', 900000, 'bank_ledger_id', bank));
    r := r || E'\nFAIL T194 more units were sold than are held';
  exception when others then r := r || E'\nPASS T194 more cannot be sold than is held';
  end;
  j := public.propose_holding_txn(jsonb_build_object('holding_id', hold, 'kind', 'sale', 'date', current_date - 30, 'quantity', 400, 'amount', 260000, 'bank_ledger_id', bank));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select quantity, cost, realised_gain into x, y, z from public.holdings where id = hold;
  select coalesce(sum(l.credit - l.debit), 0) into w from public.journal_lines l where l.journal_id = j and l.account_id = gain;
  r := r || E'\n' || case when x = 600 and y = 300000 and z = 60000 and w = 60000 then 'PASS' else 'FAIL' end
         || ' T195 sale of 400 for 260000: cost released 200000, gain ' || w || '; ' || x || ' units remain at ' || y;

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.propose_holding_txn(jsonb_build_object('holding_id', hold, 'kind', 'income', 'income_kind', 'dividend', 'date', current_date - 20, 'amount', 12000, 'tax_deducted', 1200, 'bank_ledger_id', bank));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select coalesce(sum(l.debit), 0) into x from public.journal_lines l where l.journal_id = j and l.account_id = bank;
  select coalesce(sum(l.credit), 0) into y from public.journal_lines l where l.journal_id = j and l.account_id = income;
  r := r || E'\n' || case when x = 10800 and y = 12000 and (select income_received from public.holdings where id = hold) = 12000 then 'PASS' else 'FAIL' end
         || ' T196 a dividend of 12000 less tax of 1200: bank ' || x || ', income ' || y;

  -- valuation of a holding carried at cost: beside the books
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.record_holding_valuation(jsonb_build_object('holding_id', hold, 'date', current_date - 10, 'fair_value', 420000));
    r := r || E'\nFAIL T197 a valuation was recorded without its method, its valuer and its basis';
  exception when others then r := r || E'\nPASS T197 a valuation states its method, who made it and what it rests on';
  end;
  select count(*) into n from public.journals where company_id = c1;
  id1 := public.record_holding_valuation(jsonb_build_object('holding_id', hold, 'date', current_date - 10, 'fair_value', 420000, 'method', 'Comparable transactions', 'valuer', 'Independent valuer', 'basis', 'Last funding round at 700 a share'));
  select count(*) into n2 from public.journals where company_id = c1;
  begin
    perform public.decide_holding_valuation(id1, 'approved', 'self');
    v := 'self-approved';
  exception when others then v := 'refused';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_holding_valuation(id1, 'approved', 'Agreed');
  select fair_value, cost into x, y from public.holdings where id = hold;
  r := r || E'\n' || case when n = n2 and v = 'refused' and x = 420000 and y = 300000 then 'PASS' else 'FAIL' end
         || ' T198 a holding carried at cost: the valuation (' || x || ') stands beside the books (' || y || '), proposes no entry, and is approved by a second person';

  -- a holding carried at fair value
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  hold2 := public.save_holding(jsonb_build_object('company_id', c1, 'name', 'Listed units', 'instrument', 'units', 'investment_account_id', port, 'measurement', 'fair_value'));
  j := public.propose_holding_txn(jsonb_build_object('holding_id', hold2, 'kind', 'purchase', 'date', current_date - 50, 'quantity', 100, 'amount', 100000, 'bank_ledger_id', bank));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.record_holding_valuation(jsonb_build_object('holding_id', hold2, 'date', current_date - 5, 'fair_value', 130000, 'method', 'Quoted price', 'valuer', 'Exchange close', 'basis', 'Closing price on the date'));
  select journal_id into j from public.holding_txns where id = id1;
  select fv_adjustment into x from public.holdings where id = hold2;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select fv_adjustment, fair_value into y, z from public.holdings where id = hold2;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.propose_holding_txn(jsonb_build_object('holding_id', hold2, 'kind', 'sale', 'date', current_date - 2, 'quantity', 100, 'amount', 125000, 'bank_ledger_id', bank));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select coalesce(sum(l.debit - l.credit), 0) into w from public.journal_lines l where l.journal_id = j and l.account_id = gain;
  select status into v from public.holdings where id = hold2;
  r := r || E'\n' || case when x = 0 and y = 30000 and z = 130000 and w = 5000 and v = 'exited' then 'PASS' else 'FAIL' end
         || ' T199 a holding at fair value: a rise of ' || y || ' is posted on approval; sold for 125000 against 130000 carried, the loss is ' || w || '; the holding is ' || v;

  -- ------------------------------------------------------------ confidentiality of a fund
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  fund := public.save_fund(jsonb_build_object('company_id', c1, 'name', 'GHL Growth Fund I', 'structure', 'aif_cat2', 'manager_party_id', p_mgr,
    'unit_face_value', 100, 'fee_pct', 2, 'fee_basis', 'committed', 'capital_account_id', cap));
  cm1 := public.save_commitment(jsonb_build_object('fund_id', fund, 'investor_party_id', p_inv1, 'committed_amount', 6000000, 'commitment_date', current_date - 90));
  cm2 := public.save_commitment(jsonb_build_object('fund_id', fund, 'investor_party_id', p_inv2, 'committed_amount', 4000000, 'commitment_date', current_date - 90));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.funds;
  select count(*) into n2 from public.fund_commitments;
  r := r || E'\n' || case when n = 0 and n2 = 0 then 'PASS' else 'FAIL' end
         || ' T200 a fund is confidential: a finance head who is not cleared reads ' || n || ' funds and ' || n2 || ' commitments';

  -- ------------------------------------------------------------ capital call
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  call := public.save_capital_call(jsonb_build_object('fund_id', fund, 'call_date', current_date - 45, 'due_date', current_date - 30, 'pct', 25, 'purpose', 'First investment'));
  perform public.submit_capital_call(call);
  begin
    perform public.decide_capital_call(call, 'approved', 'self');
    v := 'self-approved';
  exception when others then v := 'refused';
  end;
  select total_amount into x from public.capital_calls where id = call;
  select count(*) into n from public.journals where company_id = c1 and source = 'capital_receipt';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_capital_call(call, 'approved', 'ok');
  select called_amount into y from public.fund_commitments where id = cm1;
  select count(*) into n2 from public.journals where company_id = c1 and source = 'capital_receipt';
  r := r || E'\n' || case when v = 'refused' and x = 2500000 and y = 1500000 and n = 0 and n2 = 0 then 'PASS' else 'FAIL' end
         || ' T201 a call of 25% asks for ' || x || '; approved by a second person it is owed (' || y || ' of investor one) and nothing is posted: a call is not money';
  select id into l1 from public.capital_call_lines where call_id = call and commitment_id = cm1;
  select id into l2 from public.capital_call_lines where call_id = call and commitment_id = cm2;

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.propose_capital_receipt(jsonb_build_object('line_id', l1, 'amount', 1600000, 'bank_ledger_id', bank, 'date', current_date - 40));
    r := r || E'\nFAIL T202 more was received than was called';
  exception when others then r := r || E'\nPASS T202 a receipt cannot exceed what was called';
  end;
  j := public.propose_capital_receipt(jsonb_build_object('line_id', l1, 'amount', 1500000, 'bank_ledger_id', bank, 'date', current_date - 40, 'reference', 'UTR 1'));
  j2 := public.propose_capital_receipt(jsonb_build_object('line_id', l2, 'amount', 600000, 'bank_ledger_id', bank, 'date', current_date - 38, 'reference', 'UTR 2'));
  select units_outstanding into x from public.funds where id = fund;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok'); perform public.approve_journal(j2, 'ok');
  select units_outstanding into y from public.funds where id = fund;
  select units, contributed_amount into z, w from public.fund_commitments where id = cm2;
  select status into v from public.capital_call_lines where id = l2;
  r := r || E'\n' || case when x = 0 and y = 21000 and z = 6000 and w = 600000 and v = 'part_received' and (select status from public.capital_calls where id = call) = 'approved' then 'PASS' else 'FAIL' end
         || ' T203 units are issued when the money is posted: ' || x || ' → ' || y || ' units; investor two holds ' || z || ' and is ' || v;

  -- ------------------------------------------------------------ net asset value
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  nav := public.prepare_nav(jsonb_build_object('fund_id', fund, 'nav_date', current_date));
  select total_assets, total_liabilities, net_assets, nav_per_unit into x, y, z, w from public.nav_runs where id = nav;
  begin
    perform public.decide_nav(nav, 'approved', 'self');
    v := 'self-approved';
  exception when others then v := 'refused';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_nav(nav, 'approved', 'Agreed to the books');
  -- bank 2100000 - 500000 + 260000 + 10800 - 100000 + 125000 = 1895800; investments 300000; tax receivable 1200
  r := r || E'\n' || case when x = 2197000 and y = 0 and z = 2197000 and w = round(2197000 / 21000.0, 6) and v = 'refused' then 'PASS' else 'FAIL' end
         || ' T204 net asset value from the books: assets ' || x || ' less liabilities ' || y || ' over 21000 units = ' || w || ' a unit; approved by a second person';

  -- ------------------------------------------------------------ management fee
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.propose_fund_fee(jsonb_build_object('fund_id', fund, 'period_from', current_date - 72, 'period_to', current_date));
  select amount into x from public.fund_fees where journal_id = j;
  begin
    perform public.propose_fund_fee(jsonb_build_object('fund_id', fund, 'period_from', current_date - 10, 'period_to', current_date));
    r := r || E'\nFAIL T205 a fee was charged twice for the same days';
  exception when others then r := r || E'\n' || case when x = round(10000000 * 0.02 * 73 / 365.0, 2) and sqlerrm like '%already been proposed%' then 'PASS' else 'FAIL' end
         || ' T205 fee of 2% a year on 10000000 committed for 73 days is ' || x || '; the same days cannot be charged twice';
  end;
  begin
    perform public.propose_fund_fee(jsonb_build_object('fund_id', fund, 'period_from', current_date + 1, 'period_to', current_date + 20));
    r := r || E'\nFAIL T213 a fee was charged for days that have not passed';
  exception when others then r := r || E'\n' || case when sqlerrm like '%days that have passed%' then 'PASS' else 'FAIL' end
         || ' T213 a fee is charged only for days that have passed';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');

  -- ------------------------------------------------------------ distribution
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  dist := public.save_distribution(jsonb_build_object('company_id', c1, 'fund_id', fund, 'kind', 'distribution', 'declaration_date', current_date, 'record_date', current_date,
    'total_amount', 70000, 'tax_pct', 10, 'source_account_id', re));
  select gross_amount, tax_deducted, net_amount into x, y, z from public.distribution_lines where distribution_id = dist and holder_party_id = p_inv1;
  select sum(gross_amount) into w from public.distribution_lines where distribution_id = dist;
  r := r || E'\n' || case when x = 50000 and y = 5000 and z = 45000 and w = 70000 then 'PASS' else 'FAIL' end
         || ' T206 entitlement follows the units held on the record date: investor one, with 15000 of 21000 units, is entitled to ' || x || ' less tax ' || y;
  perform public.submit_distribution(dist);
  begin
    perform public.propose_distribution_payment(jsonb_build_object('distribution_id', dist, 'bank_ledger_id', bank, 'date', current_date));
    r := r || E'\nFAIL T207 a distribution was paid before it was declared';
  exception when others then r := r || E'\nPASS T207 payment cannot come before the declaration is approved and posted';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  v := public.decide_distribution(dist, 'approved', 'ok');
  select journal_id into j from public.fund_distributions where id = dist;
  begin
    perform public.approve_journal(j, 'self');
    v := v || ', entry self-approved';
  exception when others then v := v || ', entry needs another person';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select coalesce(sum(l.credit - l.debit), 0) into x from public.journal_lines l join public.journals jj on jj.id = l.journal_id where jj.status = 'posted' and l.account_id = dpay;
  r := r || E'\n' || case when v = 'approved, entry needs another person' and x = 70000 and (select status from public.fund_distributions where id = dist) = 'declared' then 'PASS' else 'FAIL' end
         || ' T208 the declaration is ' || v || '; once posted, ' || x || ' is owed to the holders';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.propose_distribution_payment(jsonb_build_object('distribution_id', dist, 'bank_ledger_id', bank, 'date', current_date,
    'line_ids', (select jsonb_agg(id) from public.distribution_lines where distribution_id = dist and holder_party_id = p_inv1)));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select coalesce(sum(l.credit), 0) into x from public.journal_lines l where l.journal_id = j and l.account_id = bank;
  select distributed_amount into y from public.fund_commitments where id = cm1;
  select status into v from public.fund_distributions where id = dist;
  r := r || E'\n' || case when x = 45000 and y = 50000 and v = 'part_paid' then 'PASS' else 'FAIL' end
         || ' T209 paying investor one: bank ' || x || ', tax withheld 5000, distributed to date ' || y || '; the distribution is ' || v;

  -- ------------------------------------------------------------ dividend of an ordinary company
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_distribution(jsonb_build_object('company_id', c2, 'kind', 'dividend', 'declaration_date', current_date, 'record_date', current_date,
      'total_amount', 1000, 'source_account_id', (select id from public.accounts where company_id = c2 and code = '3100')));
    r := r || E'\nFAIL T210 a dividend was declared with no shareholder on record';
  exception when others then r := r || E'\n' || case when sqlerrm like '%nobody is entitled%' then 'PASS' else 'FAIL' end || ' T210 a dividend cannot be declared while no shareholder is on record';
  end;

  -- ------------------------------------------------------------ integrity
  execute 'reset role';
  select count(*) into n from public.journals jj where jj.company_id = c1 and jj.status = 'posted'
     and (select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) from public.journal_lines where journal_id = jj.id) <> 0;
  select count(*) into n2 from public.journals jj where jj.company_id = c1 and jj.status = 'posted';
  select coalesce(sum(l.credit - l.debit), 0) into x from public.journal_lines l join public.journals jj on jj.id = l.journal_id where jj.status = 'posted' and l.account_id = cap;
  select coalesce(sum(contributed_amount), 0) into y from public.fund_commitments where fund_id = fund;
  r := r || E'\n' || case when n = 0 and n2 >= 10 and x = y and x = 2100000 then 'PASS' else 'FAIL' end
         || ' T211 every one of the ' || n2 || ' posted entries balances; capital in the books (' || x || ') equals capital contributed by the investors (' || y || ')';
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname in ('wf_holding_txn', 'wf_capital_receipt', 'wf_distribution', 'wf_distribution_payment', 'wf_fund_fee', 'fund_for', 'inv_party')
     and has_function_privilege('authenticated', p.oid, 'execute');
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T212 the internal investment functions cannot be called by a signed-in user (' || n || ' callable)';

  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', coalesce(r, ' <results lost: a value was null>');
end $t$;
