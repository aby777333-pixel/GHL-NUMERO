-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · PHASE 2, PART 2
-- Account mapping, loans, fixed deposits, purchase-to-pay, three-way
-- match, vendor selection, salary approval.
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare
  a uuid := gen_random_uuid();   -- owner (Group Super Admin)
  b uuid := gen_random_uuid();   -- accountant + payroll officer: prepares
  d uuid := gen_random_uuid();   -- finance head: approves; not cleared for payroll
  g uuid; c1 uuid; r text := ''; v text; n int; x numeric; y numeric; z numeric; j uuid; j2 uuid; id1 uuid; id2 uuid; id3 uuid;
  bank uuid; purchases uuid; loan_acc uuid; int_exp uuid; int_inc uuid; fd_acc uuid; sal uuid; fin uuid; ops uuid;
  vendor uuid; vendor2 uuid; lender uuid; p1 uuid; p2 uuid; p3 uuid; e1 uuid; e2 uuid; e3 uuid; s1 uuid; s2 uuid;
  req uuid; po uuid; pol uuid; grn uuid; bill uuid; rfq uuid; q1 uuid; q2 uuid; loan uuid; fd uuid; run uuid; adv uuid; res jsonb;
  m2 date := (date_trunc('month', current_date) - interval '1 month')::date; dim int; exp2 numeric;
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@p3.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker@p3.numero.invalid'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checker@p3.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('P3', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','T1','name','Treasury Test'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1100","name":"AR","type":"asset","subtype":"receivable","control_type":"receivable"},
      {"code":"1155","name":"Employee Advances","type":"asset","subtype":"advance","control_type":"advance_paid"},
      {"code":"1185","name":"TDS Receivable","type":"asset","subtype":"tax_receivable","control_type":"tax"},
      {"code":"1210","name":"Fixed Deposits","type":"asset","subtype":"investment"},
      {"code":"1200","name":"Investments","type":"asset","subtype":"investment","is_group":true},
      {"code":"2000","name":"AP","type":"liability","subtype":"payable","control_type":"payable"},
      {"code":"2150","name":"TDS Payable","type":"liability","subtype":"tax_payable","control_type":"tax"},
      {"code":"2160","name":"Salaries Payable","type":"liability","subtype":"employee_payable"},
      {"code":"2170","name":"Statutory Dues","type":"liability","subtype":"tax_payable"},
      {"code":"2210","name":"Term Loans","type":"liability","subtype":"loan"},
      {"code":"4000","name":"Sales","type":"income","subtype":"revenue"},
      {"code":"4910","name":"Interest Income","type":"income","subtype":"other_income"},
      {"code":"5010","name":"Purchases","type":"expense","subtype":"cogs"},
      {"code":"6110","name":"Salaries","type":"expense","subtype":"employee_cost"},
      {"code":"6120","name":"Employer Contributions","type":"expense","subtype":"employee_cost"},
      {"code":"6140","name":"Bonus","type":"expense","subtype":"employee_cost"},
      {"code":"7010","name":"Interest on Borrowings","type":"expense","subtype":"finance_cost"}]'::jsonb,
    'account_map', '{"ar_control":"1100","ap_control":"2000","employee_advances":"1155","salaries_payable":"2160","salary_expense":"6110","bonus_expense":"6140","employer_contribution_expense":"6120","statutory_payable":"2170","tds_payable":"2150","tds_receivable":"1185"}'::jsonb,
    'tax_codes', '[]'::jsonb,
    'org_units', '[{"type_key":"department","code":"FIN","name":"Finance"},{"type_key":"department","code":"OPS","name":"Operations"}]'::jsonb));
  perform public.grant_membership('maker@p3.numero.invalid', c1, 'accountant');
  perform public.grant_membership('maker@p3.numero.invalid', c1, 'payroll_officer');
  perform public.grant_membership('checker@p3.numero.invalid', c1, 'finance_head');
  select id into bank from public.accounts where company_id = c1 and code = '1000';
  select id into purchases from public.accounts where company_id = c1 and code = '5010';
  select id into loan_acc from public.accounts where company_id = c1 and code = '2210';
  select id into int_exp from public.accounts where company_id = c1 and code = '7010';
  select id into int_inc from public.accounts where company_id = c1 and code = '4910';
  select id into fd_acc from public.accounts where company_id = c1 and code = '1210';
  select id into sal from public.accounts where company_id = c1 and code = '6110';
  select id into fin from public.org_units where company_id = c1 and code = 'FIN';
  select id into ops from public.org_units where company_id = c1 and code = 'OPS';

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', m2, 'voucher_type', 'opening', 'narration', 'Opening', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', bank, 'debit', 5000000), jsonb_build_object('account_id', (select id from public.accounts where company_id = c1 and code = '4000'), 'credit', 5000000))));
  perform public.submit_journal(j);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok'); perform public.post_journal(j);

  -- ------------------------------------------------------------ account mapping
  begin
    perform public.set_account_map(c1, 'asset_disposal', (select id from public.accounts where company_id = c1 and code = '1200'));
    r := r || E'\nFAIL T82 a group heading was accepted in the account mapping';
  exception when others then r := r || E'\nPASS T82 the account mapping accepts only active posting ledgers';
  end;
  perform public.set_account_map(c1, 'asset_disposal', int_exp);
  select count(*) into n from public.company_account_map where company_id = c1 and key = 'asset_disposal' and account_id = int_exp;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' T83 an authorised person can map a ledger role to a ledger';

  -- ------------------------------------------------------------ loans
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  lender := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'lender', 'display_name', 'Test Bank Ltd')))->>'id')::uuid;
  vendor := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'vendor', 'display_name', 'Vendor One')))->>'id')::uuid;
  vendor2 := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'vendor', 'display_name', 'Vendor Two')))->>'id')::uuid;
  begin
    perform public.save_loan(jsonb_build_object('company_id', c1, 'name', 'Bad', 'party_id', lender, 'principal', 100, 'rate_pct', 12,
      'start_date', m2, 'first_due_date', m2, 'tenure_months', 12, 'loan_account_id', bank, 'interest_account_id', int_exp));
    r := r || E'\nFAIL T84 a borrowed loan was placed in an asset ledger';
  exception when others then r := r || E'\nPASS T84 a loan taken must sit in a liability ledger';
  end;
  loan := public.save_loan(jsonb_build_object('company_id', c1, 'name', 'Equipment term loan', 'party_id', lender, 'principal', 1200000, 'rate_pct', 12,
    'start_date', m2, 'first_due_date', (m2 + interval '1 month')::date, 'tenure_months', 12, 'loan_account_id', loan_acc, 'interest_account_id', int_exp));
  select count(*), sum(principal), min(closing_principal), max(total) filter (where instalment_no = 1), max(interest) filter (where instalment_no = 1)
    into n, x, y, z, exp2 from public.loan_schedule where loan_id = loan;
  r := r || E'\n' || case when n = 12 and x = 1200000 and y = 0 and exp2 = 12000 and z between 106618.50 and 106618.60 then 'PASS' else 'FAIL' end
         || ' T85 loan schedule: 12 instalments of ' || z || ', first interest ' || exp2 || ', principal sums to ' || x || ', closes at ' || y;

  -- maker-checker applies to workflow journals: the finance head proposes and may not approve the same entry
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.disburse_loan(jsonb_build_object('loan_id', loan, 'amount', 1200000, 'bank_ledger_id', bank, 'date', m2));
  begin
    perform public.approve_journal(j, 'self');
    r := r || E'\nFAIL T86 the proposer approved their own workflow journal';
  exception when others then r := r || E'\n' || case when sqlerrm like '%maker-checker%' then 'PASS' else 'FAIL' end || ' T86 maker-checker on workflow journals (' || left(sqlerrm, 80) || ')';
  end;
  begin
    perform public.disburse_loan(jsonb_build_object('loan_id', loan, 'amount', 1, 'bank_ledger_id', bank, 'date', m2));
    r := r || E'\nFAIL T87 a second entry was proposed while the first awaits approval';
  exception when others then r := r || E'\nPASS T87 one pending accounting entry per record at a time';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select status, disbursed_amount into v, x from public.loans where id = loan;
  r := r || E'\n' || case when v = 'active' and x = 1200000 then 'PASS' else 'FAIL' end || ' T88 disbursement posted: loan is ' || v || ', disbursed ' || x;

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.pay_loan_instalment(jsonb_build_object('schedule_id', (select id from public.loan_schedule where loan_id = loan and instalment_no = 2), 'bank_ledger_id', bank, 'date', current_date));
    r := r || E'\nFAIL T89 instalment 2 recorded before instalment 1';
  exception when others then r := r || E'\nPASS T89 instalments are recorded in order';
  end;
  select id, principal into id1, x from public.loan_schedule where loan_id = loan and instalment_no = 1;
  j := public.pay_loan_instalment(jsonb_build_object('schedule_id', id1, 'bank_ledger_id', bank, 'date', current_date, 'interest', 12100));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select principal_repaid, interest_paid into y, z from public.loans where id = loan;
  select sum(debit), sum(credit) into exp2, x from public.journal_lines where journal_id = j;
  r := r || E'\n' || case when z = 12100 and y = (select principal from public.loan_schedule where id = id1) and exp2 = x
                               and (select status from public.loan_schedule where id = id1) = 'paid' then 'PASS' else 'FAIL' end
         || ' T90 instalment splits principal ' || y || ' and the interest actually charged ' || z || '; entry balances';

  -- ------------------------------------------------------------ fixed deposits
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  fd := public.save_fixed_deposit(jsonb_build_object('company_id', c1, 'bank_name', 'Test Bank', 'principal', 500000, 'rate_pct', 7, 'compounding', 'quarterly',
    'start_date', m2, 'maturity_date', (m2 + 365), 'fd_account_id', fd_acc, 'interest_account_id', int_inc, 'lien_marked', true, 'lien_note', 'BG margin'));
  select maturity_amount into x from public.fixed_deposits where id = fd;
  r := r || E'\n' || case when x between 535929 and 535930 then 'PASS' else 'FAIL' end || ' T91 deposit maturity value, 7% compounded quarterly for a year = ' || x;
  j := public.place_fixed_deposit(jsonb_build_object('fd_id', fd, 'bank_ledger_id', bank));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.close_fixed_deposit(jsonb_build_object('fd_id', fd, 'bank_ledger_id', bank, 'date', current_date, 'proceeds', 532000, 'tax_deducted', 3500));
    r := r || E'\nFAIL T92 a deposit under lien was closed';
  exception when others then r := r || E'\nPASS T92 a deposit under lien cannot be closed until the lien is confirmed released';
  end;
  j := public.close_fixed_deposit(jsonb_build_object('fd_id', fd, 'bank_ledger_id', bank, 'date', current_date, 'proceeds', 532000, 'tax_deducted', 3500, 'lien_released', true));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select sum(debit), sum(credit), max(credit) filter (where account_id = int_inc) into x, y, z from public.journal_lines where journal_id = j;
  r := r || E'\n' || case when x = y and z = 35500 and (select status from public.fixed_deposits where id = fd) = 'closed' then 'PASS' else 'FAIL' end
         || ' T93 closure: interest is what the bank paid, 532000 + 3500 tax − 500000 = ' || z;

  -- ------------------------------------------------------------ purchase-to-pay
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'requisition', 'doc_date', current_date,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Monitors', 'quantity', 10, 'rate', 1000))));
    r := r || E'\nFAIL T94 requisition saved without a reason';
  exception when others then r := r || E'\nPASS T94 a requisition needs the reason for the purchase';
  end;
  req := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'requisition', 'doc_date', current_date, 'title', 'Monitors', 'reason', 'New joiners',
    'dims', jsonb_build_object('department', ops), 'lines', jsonb_build_array(jsonb_build_object('description', 'Monitors', 'quantity', 10, 'rate', 1000))));
  perform public.submit_purchase_doc(req);
  begin
    perform public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'purchase_order', 'doc_date', current_date, 'party_id', vendor, 'parent_id', req,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Monitors', 'quantity', 10, 'rate', 1000, 'account_id', purchases))));
    r := r || E'\nFAIL T95 an order was raised on an unapproved requisition';
  exception when others then r := r || E'\nPASS T95 a purchase order cannot be raised on a requisition that is not approved';
  end;
  begin
    perform public.approve_purchase_doc(req, 'self');
    r := r || E'\nFAIL T96 the requester approved their own requisition';
  exception when others then r := r || E'\nPASS T96 the requester cannot approve the requisition';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_purchase_doc(req, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  po := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'purchase_order', 'doc_date', current_date, 'party_id', vendor, 'parent_id', req,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Monitors', 'quantity', 10, 'rate', 1000, 'account_id', purchases, 'dims', jsonb_build_object('department', ops)))));
  perform public.submit_purchase_doc(po);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_purchase_doc(po, 'ok');
  select count(*) into n from public.journals where source not in ('manual','loan_disbursement','loan_instalment','fd_placement','fd_closure');
  r := r || E'\n' || case when (select status from public.purchase_docs where id = po) = 'approved' and (select status from public.purchase_docs where id = req) = 'ordered' and n = 0 then 'PASS' else 'FAIL' end
         || ' T97 an approved order is a COMMITMENT: requisition is ordered, and no journal exists for it';
  select id into pol from public.purchase_doc_lines where doc_id = po;

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  grn := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'goods_receipt', 'doc_date', current_date, 'parent_id', po,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Monitors', 'quantity', 6, 'source_line_id', pol, 'condition', 'Good'))));
  perform public.submit_purchase_doc(grn);
  select status into v from public.purchase_docs where id = po;
  begin
    perform public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'goods_receipt', 'doc_date', current_date, 'parent_id', po,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Monitors', 'quantity', 5, 'source_line_id', pol))));
    r := r || E'\nFAIL T98 more was received than was ordered';
  exception when others then r := r || E'\n' || case when v = 'partially_received' then 'PASS' else 'FAIL' end || ' T98 order is ' || v || ' after 6 of 10; receiving 5 more is refused';
  end;
  bill := public.save_invoice(jsonb_build_object('company_id', c1, 'doc_type', 'purchase_bill', 'party_id', vendor, 'doc_date', current_date, 'reference', 'V1-001',
    'lines', jsonb_build_array(jsonb_build_object('account_id', purchases, 'quantity', 10, 'rate', 1000, 'description', 'Monitors'))));
  begin
    perform public.link_bill_to_po(bill, po, null);
    perform public.link_bill_to_po((select public.save_invoice(jsonb_build_object('company_id', c1, 'doc_type', 'purchase_bill', 'party_id', vendor2, 'doc_date', current_date,
      'lines', jsonb_build_array(jsonb_build_object('account_id', purchases, 'amount', 10, 'description', 'x'))))), po, null);
    r := r || E'\nFAIL T99 a bill from another vendor was linked to the order';
  exception when others then r := r || E'\nPASS T99 a bill can be linked only to an order of the same vendor';
  end;
  perform public.link_bill_to_po(bill, po, null);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_invoice(bill);
  execute 'reset role';
  select count(*) filter (where kind = 'billed_before_receipt'), count(*) filter (where kind = 'bill_exceeds_po') into n, x from public.alerts where entity_id = bill;
  r := r || E'\n' || case when n = 1 and x = 0 and (select status from public.invoices where id = bill) = 'open' then 'PASS' else 'FAIL' end
         || ' T100 three-way match: billed 10000 against 6000 received is flagged for review, and the bill is still recorded';
  select count(*) into n from public.invoice_lines where invoice_id = bill and po_line_id = pol;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' T101 bill line is linked to the order line (document chain is traceable)';

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  grn := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'goods_receipt', 'doc_date', current_date, 'parent_id', po,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Monitors', 'quantity', 4, 'source_line_id', pol))));
  perform public.submit_purchase_doc(grn);
  id1 := public.save_invoice(jsonb_build_object('company_id', c1, 'doc_type', 'purchase_bill', 'party_id', vendor, 'doc_date', current_date, 'reference', 'V1-002',
    'lines', jsonb_build_array(jsonb_build_object('account_id', purchases, 'amount', 2000, 'description', 'Freight not on the order'))));
  perform public.link_bill_to_po(id1, po, null);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_invoice(id1);
  execute 'reset role';
  select count(*) into n from public.alerts where kind = 'bill_exceeds_po' and entity_id = id1;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' T102 three-way match: bills of 12000 against an order of 10000 are flagged';
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
    perform public.cancel_purchase_doc(grn, 'test');
    r := r || E'\nFAIL T103 a receipt was cancelled after the bill was recorded';
  exception when others then r := r || E'\nPASS T103 a receipt cannot be cancelled once a bill stands against the order';
  end;

  -- quotations: a person chooses, and says why
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id2 := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'requisition', 'doc_date', current_date, 'reason', 'Laptops for field team',
    'lines', jsonb_build_array(jsonb_build_object('description', 'Laptops', 'quantity', 5, 'rate', 60000))));
  perform public.submit_purchase_doc(id2);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_purchase_doc(id2, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  rfq := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'rfq', 'doc_date', current_date, 'parent_id', id2,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Laptops', 'quantity', 5))));
  perform public.submit_purchase_doc(rfq);
  q1 := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'quotation', 'doc_date', current_date, 'party_id', vendor, 'parent_id', rfq, 'warranty', '1 year',
    'lines', jsonb_build_array(jsonb_build_object('description', 'Laptops', 'quantity', 5, 'rate', 58000))));
  q2 := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'quotation', 'doc_date', current_date, 'party_id', vendor2, 'parent_id', rfq, 'warranty', '3 years on site',
    'lines', jsonb_build_array(jsonb_build_object('description', 'Laptops', 'quantity', 5, 'rate', 61000))));
  perform public.submit_purchase_doc(q1); perform public.submit_purchase_doc(q2);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.select_quotation(q2, '  ');
    r := r || E'\nFAIL T104 a vendor was selected without a recorded reason';
  exception when others then r := r || E'\nPASS T104 selecting a vendor requires the reason to be recorded';
  end;
  perform public.select_quotation(q2, 'Three-year on-site warranty outweighs the price difference');
  select (new_value->>'was_lowest')::boolean into strict v from public.audit_log where entity_id = q2 and action = 'vendor_selected';
  r := r || E'\n' || case when v = 'false' and (select status from public.purchase_docs where id = q1) = 'not_selected' and (select status from public.purchase_docs where id = rfq) = 'closed' then 'PASS' else 'FAIL' end
         || ' T105 the dearer vendor can be chosen by a person; the record shows it was not the lowest quote';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'purchase_order', 'doc_date', current_date, 'party_id', vendor, 'parent_id', q1,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Laptops', 'quantity', 5, 'rate', 58000, 'account_id', purchases))));
    r := r || E'\nFAIL T106 an order was raised on a quotation that was not selected';
  exception when others then r := r || E'\nPASS T106 only the selected quotation can become a purchase order';
  end;

  -- ------------------------------------------------------------ salary approval
  p1 := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'employee', 'kind', 'person', 'display_name', 'Asha Finance')))->>'id')::uuid;
  e1 := public.save_employee(jsonb_build_object('company_id', c1, 'party_id', p1, 'join_date', (m2 - 400), 'department_id', fin, 'designation', 'Manager'));
  select emp_no into v from public.employees where id = e1;
  s1 := public.save_salary_structure(jsonb_build_object('employee_id', e1, 'effective_from', (m2 - 400), 'reason', 'Joining salary', 'components', jsonb_build_array(
    jsonb_build_object('name', 'Basic', 'kind', 'earning', 'amount', 50000), jsonb_build_object('name', 'HRA', 'kind', 'earning', 'amount', 20000),
    jsonb_build_object('name', 'Provident fund', 'kind', 'deduction', 'type', 'statutory', 'amount', 6000))));
  begin
    perform public.decide_salary_structure(s1, 'approved', 'self');
    r := r || E'\nFAIL T107 the payroll officer approved a salary they entered';
  exception when others then r := r || E'\nPASS T107 entering a salary and approving it are different permissions (emp no ' || v || ')';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_salary_structure(s1, 'approved', 'As per offer letter');
  execute 'reset role';
  begin
    update public.salary_structures set monthly_gross = 1 where id = s1;
    r := r || E'\nFAIL T108 an approved salary was overwritten';
  exception when others then r := r || E'\nPASS T108 an approved salary is never overwritten (' || left(sqlerrm, 60) || ')';
  end;

  -- an advance cannot be over-recovered through payroll
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  adv := public.save_advance(jsonb_build_object('company_id', c1, 'recipient_party_id', p1, 'purpose', 'Salary advance', 'requested_amount', 8000));
  perform public.submit_advance(adv);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_advance(adv, null, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  j := public.release_advance(jsonb_build_object('advance_id', adv, 'amount', 8000, 'bank_ledger_id', bank, 'date', m2));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.create_payroll_run(jsonb_build_object('company_id', c1, 'month', m2, 'adjustments', jsonb_build_array(
      jsonb_build_object('employee_id', e1, 'name', 'Advance recovery', 'kind', 'deduction', 'type', 'advance_recovery', 'amount', 9000, 'advance_id', adv))));
    r := r || E'\nFAIL T109 more was recovered than the advance outstanding';
  exception when others then r := r || E'\nPASS T109 a salary recovery cannot exceed the unsettled advance';
  end;

  execute 'reset role';
  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', coalesce(r, ' <results lost: a value was null>');
end $t$;
