-- =====================================================================
-- GHL NUMERO · DATABASE TESTS · PHASE 3, PART 1 — INVENTORY
-- Items, lots and serial numbers, stock documents, valuation (weighted
-- average and first in first out), transfers, stock count, landed cost,
-- conditions noted on stock, agreement of stock ledger and general ledger.
-- Runs in one transaction that ALWAYS rolls back. Read the results from
-- the error message; every line must start with PASS.
-- =====================================================================
do $t$
declare
  a uuid := gen_random_uuid();   -- owner (Group Super Admin)
  b uuid := gen_random_uuid();   -- accountant: prepares stock documents
  d uuid := gen_random_uuid();   -- finance head: approves, reviews counts
  s uuid := gen_random_uuid();   -- store keeper: counts
  e uuid := gen_random_uuid();   -- employee: no inventory permission
  g uuid; c1 uuid; r text := ''; v text; v2 text; v3 text; spares uuid; wire uuid; res jsonb; n int; n2 int; x numeric; y numeric; z numeric; j uuid; j2 uuid; id1 uuid; id2 uuid; id3 uuid;
  inv uuid; grni uuid; cogs uuid; adj uuid; clr uuid; purchases uuid; cat uuid; catf uuid; wh uuid; wh2 uuid;
  bolt uuid; pump uuid; med uuid; mri uuid; lot1 uuid; vendor uuid; po uuid; pol uuid; grn uuid; grl uuid; cnt uuid; hold uuid;
  rcp1 uuid; rcp2 uuid; iss uuid; exp2 numeric;
begin
  insert into auth.users(id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@p7.numero.invalid'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maker@p7.numero.invalid'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checker@p7.numero.invalid'),
    (s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store@p7.numero.invalid'),
    (e, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@p7.numero.invalid');
  delete from public.app_config where key = 'owner_email';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  g := public.bootstrap_group('P7', 'INR', 'enforced');
  c1 := public.create_company(jsonb_build_object('company', jsonb_build_object('code','INV','name','Inventory Test'),
    'accounts', '[
      {"code":"1000","name":"Bank","type":"asset","subtype":"bank","control_type":"bank"},
      {"code":"1140","name":"Inventory","type":"asset","subtype":"inventory"},
      {"code":"1145","name":"Spares","type":"asset","subtype":"inventory"},
      {"code":"2110","name":"AP","type":"liability","subtype":"payable","control_type":"payable"},
      {"code":"2125","name":"Goods Received Not Invoiced","type":"liability","subtype":"accrued"},
      {"code":"2127","name":"Landed Cost Clearing","type":"liability","subtype":"accrued"},
      {"code":"4000","name":"Sales","type":"income","subtype":"revenue"},
      {"code":"5010","name":"Cost of Goods Sold","type":"expense","subtype":"cogs"},
      {"code":"5150","name":"Stock Adjustments","type":"expense","subtype":"cogs"}]'::jsonb,
    'account_map', '{"ap_control":"2110","grni":"2125","landed_cost_clearing":"2127","stock_loss":"5150","stock_gain":"5150"}'::jsonb,
    'tax_codes', '[]'::jsonb, 'org_units', '[]'::jsonb));
  perform public.grant_membership('maker@p7.numero.invalid', c1, 'accountant');
  perform public.grant_membership('checker@p7.numero.invalid', c1, 'finance_head');
  perform public.grant_membership('store@p7.numero.invalid', c1, 'store_keeper');
  perform public.grant_membership('staff@p7.numero.invalid', c1, 'employee');
  select id into inv from public.accounts where company_id = c1 and code = '1140';
  select id into grni from public.accounts where company_id = c1 and code = '2125';
  select id into cogs from public.accounts where company_id = c1 and code = '5010';
  select id into adj from public.accounts where company_id = c1 and code = '5150';
  select id into clr from public.accounts where company_id = c1 and code = '2127';

  -- ------------------------------------------------------------ permission
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_inv_category(jsonb_build_object('company_id', c1, 'name', 'X', 'inventory_account_id', inv, 'cogs_account_id', cogs));
    r := r || E'\nFAIL T160 a person without the permission created an inventory category';
  exception when others then r := r || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL' end || ' T160 inventory cannot be maintained without the permission (' || sqlstate || ')';
  end;

  -- ------------------------------------------------------------ master data
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_inv_category(jsonb_build_object('company_id', c1, 'name', 'Wrong', 'inventory_account_id', cogs, 'cogs_account_id', cogs));
    r := r || E'\nFAIL T161 an expense ledger was accepted as the stock ledger';
  exception when others then r := r || E'\nPASS T161 the stock ledger of a category must be an asset';
  end;
  cat := public.save_inv_category(jsonb_build_object('company_id', c1, 'name', 'Hardware', 'inventory_account_id', inv, 'cogs_account_id', cogs, 'valuation_method', 'weighted_average'));
  catf := public.save_inv_category(jsonb_build_object('company_id', c1, 'name', 'Equipment', 'inventory_account_id', inv, 'cogs_account_id', cogs, 'valuation_method', 'fifo'));
  wh := public.save_warehouse(jsonb_build_object('company_id', c1, 'code', 'main', 'name', 'Main warehouse'));
  wh2 := public.save_warehouse(jsonb_build_object('company_id', c1, 'code', 'site', 'name', 'Site store', 'kind', 'site'));
  bolt := public.save_inv_item(jsonb_build_object('company_id', c1, 'sku', 'bolt', 'name', 'Anchor bolt', 'category_id', cat, 'unit', 'pcs', 'reorder_level', 40));
  pump := public.save_inv_item(jsonb_build_object('company_id', c1, 'sku', 'pump', 'name', 'Infusion pump', 'category_id', catf));
  med := public.save_inv_item(jsonb_build_object('company_id', c1, 'sku', 'med', 'name', 'Sterile kit', 'category_id', cat, 'tracking', 'lot', 'shelf_life_days', 365));
  mri := public.save_inv_item(jsonb_build_object('company_id', c1, 'sku', 'mri', 'name', 'Scanner', 'category_id', catf, 'tracking', 'serial'));
  select count(*) into n from public.inv_items where company_id = c1;
  select valuation_method into v from public.inv_items where id = pump;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n2 from public.inv_items where company_id = c1;
  r := r || E'\n' || case when n = 4 and v = 'fifo' and n2 = 0 then 'PASS' else 'FAIL' end
         || ' T162 four items; an item takes the method of its category (' || v || '); a person without the permission reads ' || n2;

  -- ------------------------------------------------------------ receipt: nothing changes before approval
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 100, 'unit_cost', 10))));
  j := public.propose_stock_doc(id1);
  select qty_on_hand, value_on_hand into x, y from public.inv_items where id = bolt;
  select status into v from public.journals where id = j;
  r := r || E'\n' || case when x = 0 and y = 0 and v = 'submitted' then 'PASS' else 'FAIL' end
         || ' T163 a receipt proposes its entry (' || v || ') and changes nothing until it is approved: in stock ' || x;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id2 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 1, 'unit_cost', 10))));
  j2 := public.propose_stock_doc(id2);
  begin
    perform public.approve_journal(j2, 'self');
    r := r || E'\nFAIL T164 the person who proposed the receipt approved its entry';
  exception when others then r := r || E'\n' || case when sqlerrm like '%maker-checker%' then 'PASS' else 'FAIL' end || ' T164 the person who proposes a stock document cannot approve its entry';
  end;
  perform public.approve_journal(j, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.reject_journal(j2, 'Test entry');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select qty_on_hand, value_on_hand into x, y from public.inv_items where id = bolt;
  select coalesce(sum(l.debit - l.credit), 0) into z from public.journal_lines l join public.journals jj on jj.id = l.journal_id where jj.status = 'posted' and l.account_id = grni;
  r := r || E'\n' || case when x = 100 and y = 1000 and z = -1000 and (select status from public.stock_docs where id = id1) = 'posted' then 'PASS' else 'FAIL' end
         || ' T165 on approval: 100 in stock at 1000; goods received not invoiced ' || z;

  -- ------------------------------------------------------------ weighted average
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id2 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 100, 'unit_cost', 14))));
  j := public.propose_stock_doc(id2);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id3 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'issue', 'doc_date', current_date, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 50))));
  j := public.propose_stock_doc(id3); iss := id3;
  select total_value into x from public.stock_docs where id = id3;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select qty_on_hand, value_on_hand into y, z from public.inv_items where id = bolt;
  r := r || E'\n' || case when x = 600 and y = 150 and z = 1800 then 'PASS' else 'FAIL' end
         || ' T166 weighted average: 100 at 10 and 100 at 14, issue of 50 costs ' || x || '; ' || y || ' remain at ' || z;

  -- ------------------------------------------------------------ first in, first out
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date - 5, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', pump, 'qty', 10, 'unit_cost', 100))));
  j := public.propose_stock_doc(id1); rcp1 := id1;
  id2 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date - 2, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', pump, 'qty', 10, 'unit_cost', 120, 'weight', 30))));
  j2 := public.propose_stock_doc(id2); rcp2 := id2;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok'); perform public.approve_journal(j2, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id3 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'issue', 'doc_date', current_date, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', pump, 'qty', 15))));
  j := public.propose_stock_doc(id3);
  select total_value into x from public.stock_docs where id = id3;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select qty_on_hand, value_on_hand into y, z from public.inv_items where id = pump;
  r := r || E'\n' || case when x = 1600 and y = 5 and z = 600 then 'PASS' else 'FAIL' end
         || ' T167 first in, first out: 10 at 100 then 10 at 120, issue of 15 costs ' || x || '; ' || y || ' remain at ' || z;

  -- ------------------------------------------------------------ what awaits approval is reserved
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id1 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'issue', 'doc_date', current_date, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 100))));
  j := public.propose_stock_doc(id1);
  id2 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'issue', 'doc_date', current_date, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 100))));
  begin
    perform public.propose_stock_doc(id2);
    r := r || E'\nFAIL T168 the same stock was issued twice';
  exception when others then
    select qty_reserved into x from public.inv_items where id = bolt;
    r := r || E'\n' || case when x = 100 then 'PASS' else 'FAIL' end || ' T168 stock awaiting approval on one document cannot be issued on another (reserved ' || x || ')';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.reject_journal(j, 'Not needed');
  select qty_reserved, value_reserved, qty_on_hand into x, y, z from public.inv_items where id = bolt;
  select coalesce(sum(remaining_qty), 0) into exp2 from public.inv_movements where item_id = bolt and is_layer and status = 'posted';
  r := r || E'\n' || case when x = 0 and y = 0 and z = 150 and exp2 = 150 and (select status from public.stock_docs where id = id1) = 'rejected' then 'PASS' else 'FAIL' end
         || ' T169 rejecting the entry releases the stock: reserved ' || x || ', in stock ' || z || ', receipts hold ' || exp2;

  -- ------------------------------------------------------------ lots and serial numbers
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date, 'warehouse_id', wh,
      'lines', jsonb_build_array(jsonb_build_object('item_id', med, 'qty', 20, 'unit_cost', 50))));
    r := r || E'\nFAIL T170 an item tracked by lot was received without its lot';
  exception when others then r := r || E'\nPASS T170 an item tracked by lot cannot be received without its lot';
  end;
  id1 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', med, 'qty', 20, 'unit_cost', 50, 'lot_no', 'L-01', 'mfg_date', current_date - 300))));
  j := public.propose_stock_doc(id1);
  select id, expiry_date::text into lot1, v from public.inv_lots where item_id = med and lot_no = 'L-01';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  r := r || E'\n' || case when v = (current_date + 65)::text then 'PASS' else 'FAIL' end
         || ' T171 the lot is created with the receipt, and its expiry follows the shelf life of the item (' || v || ')';
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date, 'warehouse_id', wh,
      'lines', jsonb_build_array(jsonb_build_object('item_id', mri, 'qty', 2, 'unit_cost', 900000, 'lot_no', 'SN-1'))));
    r := r || E'\nFAIL T172 two units were received under one serial number';
  exception when others then r := r || E'\nPASS T172 a serial number is one unit';
  end;

  -- ------------------------------------------------------------ transfer: place changes, value does not
  select count(*) into n from public.journals;
  id1 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'transfer', 'doc_date', current_date, 'warehouse_id', wh, 'to_warehouse_id', wh2,
    'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 30))));
  j := public.propose_stock_doc(id1);
  select count(*) into n2 from public.journals;
  select qty into x from public.stock_on_hand(array[c1]) where item_id = bolt and warehouse_id = wh2;
  select qty into y from public.stock_on_hand(array[c1]) where item_id = bolt and warehouse_id = wh;
  select value_on_hand into z from public.inv_items where id = bolt;
  r := r || E'\n' || case when j is null and n = n2 and x = 30 and y = 120 and z = 1800 then 'PASS' else 'FAIL' end
         || ' T173 a transfer proposes no entry: ' || y || ' here, ' || x || ' there, value still ' || z;

  -- ------------------------------------------------------------ adjustment
  begin
    perform public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'adjustment', 'doc_date', current_date, 'warehouse_id', wh, 'reason', 'Found broken',
      'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', -5))));
    r := r || E'\nFAIL T174 stock was adjusted without saying what happened to it';
  exception when others then r := r || E'\nPASS T174 an adjustment line must say what happened to the stock';
  end;
  hold := public.save_inv_hold(jsonb_build_object('company_id', c1, 'item_id', bolt, 'warehouse_id', wh, 'qty', 5, 'condition', 'damaged', 'note', 'Rusted in the rain'));
  begin
    perform public.save_inv_hold(jsonb_build_object('company_id', c1, 'item_id', bolt, 'warehouse_id', wh, 'qty', 500, 'condition', 'damaged'));
    r := r || E'\nFAIL T175 more stock was noted as damaged than exists';
  exception when others then
    select value_on_hand into x from public.inv_items where id = bolt;
    r := r || E'\n' || case when x = 1800 then 'PASS' else 'FAIL' end || ' T175 a condition noted on stock cannot exceed the stock, and changes no value (' || x || ')';
  end;
  id1 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'adjustment', 'doc_date', current_date, 'warehouse_id', wh, 'reason', 'Rusted bolts scrapped',
    'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', -5, 'reason_code', 'damage', 'hold_id', hold))));
  j := public.propose_stock_doc(id1);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select coalesce(sum(l.debit - l.credit), 0) into x from public.journal_lines l where l.journal_id = j and l.account_id = adj;
  select qty_on_hand into y from public.inv_items where id = bolt;
  r := r || E'\n' || case when x = 60 and y = 145 and (select status from public.inv_holds where id = hold) = 'written_off' then 'PASS' else 'FAIL' end
         || ' T176 an approved loss of 5 is charged at ' || x || '; ' || y || ' remain; the condition noted is closed';

  -- ------------------------------------------------------------ stock count
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  cnt := public.create_stock_count(jsonb_build_object('company_id', c1, 'warehouse_id', wh));
  select count(*) into n from public.stock_count_lines where count_id = cnt;
  begin
    id2 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'issue', 'doc_date', current_date, 'warehouse_id', wh,
      'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 1))));
    perform public.propose_stock_doc(id2);
    r := r || E'\nFAIL T177 stock moved in a location that is being counted';
  exception when others then r := r || E'\n' || case when n = 3 then 'PASS' else 'FAIL' end || ' T177 the count lists ' || n || ' lines from the books, and the location is frozen while it is open';
  end;
  v := public.record_stock_count(jsonb_build_object('count_id', cnt, 'lines', (
    select jsonb_agg(jsonb_build_object('id', l.id, 'counted_qty', case when l.item_id = bolt then 112 when l.item_id = med then 21 else l.book_qty end)) from public.stock_count_lines l where l.count_id = cnt)));
  begin
    perform public.review_stock_count(cnt, 'reviewed', 'ok');
    r := r || E'\nFAIL T178 the store keeper reviewed the count';
  exception when others then r := r || E'\n' || case when v = 'counted' and sqlstate = '42501' then 'PASS' else 'FAIL' end || ' T178 the count is ' || v || '; reviewing it needs its own permission';
  end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin
    perform public.review_stock_count(cnt, 'reviewed', 'ok');
    r := r || E'\nFAIL T179 differences passed review without a reason';
  exception when others then r := r || E'\nPASS T179 a difference cannot pass review without its reason';
  end;
  perform public.review_stock_count(cnt, 'recount', 'Reasons are missing');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.record_stock_count(jsonb_build_object('count_id', cnt, 'lines', (
    select jsonb_agg(jsonb_build_object('id', l.id, 'counted_qty', case when l.item_id = bolt then 112 when l.item_id = med then 21 else l.book_qty end,
      'reason_code', case when l.item_id = bolt then 'shrinkage' when l.item_id = med then 'found' end)) from public.stock_count_lines l where l.count_id = cnt)));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.review_stock_count(cnt, 'reviewed', 'Agreed with the store keeper');
  select qty_on_hand into x from public.inv_items where id = bolt;
  j := public.propose_stock_count(cnt);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select qty_on_hand into y from public.inv_items where id = bolt;
  select qty_on_hand into z from public.inv_items where id = med;
  select status into v from public.stock_counts where id = cnt;
  r := r || E'\n' || case when x = 145 and y = 142 and z = 21 and v = 'posted' then 'PASS' else 'FAIL' end
         || ' T180 the books are unchanged by counting (' || x || '); after the approved adjustment bolts are ' || y || ' and kits ' || z || '; the count is ' || v;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  cnt := public.create_stock_count(jsonb_build_object('company_id', c1, 'warehouse_id', wh2));
  perform public.record_stock_count(jsonb_build_object('count_id', cnt, 'lines', (
    select jsonb_agg(jsonb_build_object('id', l.id, 'counted_qty', l.book_qty)) from public.stock_count_lines l where l.count_id = cnt)));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.review_stock_count(cnt, 'reviewed', null);
  select count(*) into n from public.journals;
  j := public.propose_stock_count(cnt);
  select count(*) into n2 from public.journals;
  r := r || E'\n' || case when j is null and n = n2 and (select status from public.stock_counts where id = cnt) = 'closed' then 'PASS' else 'FAIL' end
         || ' T181 a count that agrees with the books is closed and proposes nothing';

  -- ------------------------------------------------------------ landed cost
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select value_on_hand into x from public.inv_items where id = pump;
  id1 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'landed_cost', 'doc_date', current_date, 'receipt_doc_id', rcp2,
    'meta', jsonb_build_object('method', 'value', 'charges', jsonb_build_array(
      jsonb_build_object('name', 'Freight', 'amount', 300), jsonb_build_object('name', 'Customs duty', 'amount', 200)))));
  j := public.propose_stock_doc(id1);
  select value, expensed into y, z from public.stock_doc_lines where doc_id = id1;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  select value_on_hand into exp2 from public.inv_items where id = pump;
  select coalesce(sum(l.credit), 0) into x from public.journal_lines l where l.journal_id = j and l.account_id = clr;
  r := r || E'\n' || case when y = 250 and z = 250 and exp2 = 850 and x = 500 then 'PASS' else 'FAIL' end
         || ' T182 landed cost of 500 on a receipt of which half has left: ' || y || ' joins the stock (now ' || exp2 || '), ' || z || ' is a cost now, ' || x || ' is owed';

  -- ------------------------------------------------------------ reversal
  begin
    perform public.reverse_journal((select journal_id from public.stock_docs where id = rcp1), current_date, 'Test');
    r := r || E'\nFAIL T183 a receipt was reversed after its goods had left stock';
  exception when others then r := r || E'\n' || case when sqlerrm like '%have since left stock%' then 'PASS' else 'FAIL' end || ' T183 a receipt cannot be reversed once its goods have left (' || left(sqlerrm, 90) || ')';
  end;
  select qty_on_hand, value_on_hand into x, y from public.inv_items where id = bolt;
  perform public.reverse_journal((select journal_id from public.stock_docs where id = iss), current_date, 'Issued in error');
  select qty_on_hand, value_on_hand into z, exp2 from public.inv_items where id = bolt;
  r := r || E'\n' || case when z = x + 50 and exp2 = y + 600 and (select status from public.stock_docs where id = iss) = 'reversed' then 'PASS' else 'FAIL' end
         || ' T184 reversing an issue brings the stock back: ' || x || ' → ' || z || ', value ' || y || ' → ' || exp2;

  -- ------------------------------------------------------------ goods receipt of the purchase order
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  vendor := ((public.create_party(jsonb_build_object('company_id', c1, 'type_key', 'vendor', 'display_name', 'Fastener Works', 'force', true)))->>'id')::uuid;
  po := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'purchase_order', 'doc_date', current_date, 'party_id', vendor,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Anchor bolts', 'quantity', 40, 'rate', 11, 'account_id', grni))));
  perform public.submit_purchase_doc(po);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_purchase_doc(po, 'ok');
  select id into pol from public.purchase_doc_lines where doc_id = po;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  grn := public.save_purchase_doc(jsonb_build_object('company_id', c1, 'kind', 'goods_receipt', 'doc_date', current_date, 'parent_id', po,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Anchor bolts', 'quantity', 25, 'source_line_id', pol))));
  perform public.submit_purchase_doc(grn);
  select id into grl from public.purchase_doc_lines where doc_id = grn;
  id1 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date, 'warehouse_id', wh2, 'purchase_doc_id', grn,
    'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 25, 'source_line_id', grl))));
  select unit_cost, value into x, y from public.stock_doc_lines where doc_id = id1;
  begin
    perform public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date, 'warehouse_id', wh2, 'purchase_doc_id', grn,
      'lines', jsonb_build_array(jsonb_build_object('item_id', bolt, 'qty', 1, 'source_line_id', grl))));
    r := r || E'\nFAIL T185 more was taken into stock than the goods receipt records';
  exception when others then r := r || E'\n' || case when x = 11 and y = 275 and (select party_id from public.stock_docs where id = id1) = vendor then 'PASS' else 'FAIL' end
         || ' T185 stock received against a goods receipt takes the vendor and the rate of the order (' || x || '), and cannot exceed what was received';
  end;
  j := public.propose_stock_doc(id1);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');

  -- ------------------------------------------------------------ the two ledgers agree
  execute 'reset role';
  select coalesce(sum(value_on_hand), 0) into x from public.inv_items where company_id = c1;
  select coalesce(sum(l.debit - l.credit), 0) into y from public.journal_lines l join public.journals jj on jj.id = l.journal_id
   where jj.company_id = c1 and jj.status in ('posted','reversed') and l.account_id = inv;
  select coalesce(sum(value) filter (where status = 'posted'), 0) into z from public.inv_movements where company_id = c1 and kind not in ('transfer_in','transfer_out');
  select count(*) into n from public.inv_items where company_id = c1 and (qty_reserved <> 0 or value_reserved <> 0);
  r := r || E'\n' || case when x = y and x = z and x > 0 and n = 0 then 'PASS' else 'FAIL' end
         || ' T186 the stock ledger and the general ledger agree: items ' || x || ', stock ledger ' || z || ', general ledger ' || y || '; nothing is left reserved';

  -- ------------------------------------------------------------ the age of stock, the date of a document, a stock ledger without items
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  wire := public.save_inv_item(jsonb_build_object('company_id', c1, 'sku', 'wire', 'name', 'Binding wire', 'category_id', cat, 'unit', 'kg'));
  id1 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date - 20, 'warehouse_id', wh,
    'lines', jsonb_build_array(jsonb_build_object('item_id', wire, 'qty', 50, 'unit_cost', 4))));
  j := public.propose_stock_doc(id1);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  id2 := public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'transfer', 'doc_date', current_date, 'warehouse_id', wh, 'to_warehouse_id', wh2,
    'lines', jsonb_build_array(jsonb_build_object('item_id', wire, 'qty', 20))));
  j := public.propose_stock_doc(id2);
  select qty, last_in::text, coalesce(last_out::text, 'never') into x, v, v2 from public.stock_on_hand(array[c1]) where item_id = wire and warehouse_id = wh2;
  select coalesce(last_out::text, 'never') into v3 from public.stock_on_hand(array[c1]) where item_id = wire and warehouse_id = wh;
  r := r || E'\n' || case when x = 20 and v = (current_date - 20)::text and v2 = 'never' and v3 = 'never' then 'PASS' else 'FAIL' end
         || ' T272 stock moved to another place is as old as its receipt (' || v || ', not the day it was moved), and a transfer is not stock leaving (' || v2 || ')';
  begin
    perform public.save_stock_doc(jsonb_build_object('company_id', c1, 'kind', 'receipt', 'doc_date', current_date + 2, 'warehouse_id', wh,
      'lines', jsonb_build_array(jsonb_build_object('item_id', wire, 'qty', 1, 'unit_cost', 4))));
    r := r || E'\nFAIL T273 a stock document was dated on a day that has not come';
  exception when others then r := r || E'\n' || case when sqlerrm like '%a day that has not come%' then 'PASS' else 'FAIL' end || ' T273 a stock document is not dated on a day that has not come';
  end;
  select id into spares from public.accounts where company_id = c1 and code = '1145';
  perform public.save_inv_category(jsonb_build_object('company_id', c1, 'name', 'Spares, nothing recorded yet', 'inventory_account_id', spares, 'cogs_account_id', cogs));
  j := public.save_journal_draft(jsonb_build_object('company_id', c1, 'journal_date', current_date, 'voucher_type', 'journal', 'narration', 'Spares bought, entered by hand', 'lines', jsonb_build_array(
    jsonb_build_object('account_id', spares, 'debit', 5000), jsonb_build_object('account_id', grni, 'credit', 5000))));
  perform public.submit_journal(j);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_journal(j, 'ok'); perform public.post_journal(j);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  res := public.system_health();
  select count(*), coalesce(sum((q->>'difference')::numeric), 0), coalesce(max(q->>'ledger'), '') into n, x, v from jsonb_array_elements(res->'stock_and_ledger'->'differences') q;
  r := r || E'\n' || case when res->'stock_and_ledger'->>'state' = 'attention' and n = 1 and x = -5000 and v = 'Spares' then 'PASS' else 'FAIL' end
         || ' T274 a stock ledger that holds no item is compared with the books all the same: ' || n || ' difference, ' || x || ' in ' || v;
  execute 'reset role';

  -- ------------------------------------------------------------ the stock ledger is evidence
  begin
    delete from public.inv_movements where company_id = c1;
    r := r || E'\nFAIL T187 stock movements were deleted';
  exception when others then
    begin
      update public.inv_movements set qty = qty + 1 where company_id = c1 and status = 'posted';
      r := r || E'\nFAIL T187 the quantity of a posted movement was changed';
    exception when others then r := r || E'\nPASS T187 a stock movement can be neither deleted nor altered, even by a privileged role';
    end;
  end;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname in ('take_stock', 'give_back_stock', 'apply_stock_doc', 'wf_stock_doc', 'assert_not_counting', 'stock_available', 'guard_movement')
     and has_function_privilege('authenticated', p.oid, 'execute');
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' T188 the internal stock functions cannot be called by a signed-in user (' || n || ' callable)';
  select count(*) into n from public.journals jj where jj.company_id = c1 and jj.status = 'posted'
     and (select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) from public.journal_lines where journal_id = jj.id) <> 0;
  select count(*) into n2 from public.journals jj where jj.company_id = c1 and jj.status = 'posted';
  r := r || E'\n' || case when n = 0 and n2 >= 10 then 'PASS' else 'FAIL' end || ' T189 every one of the ' || n2 || ' posted entries balances';

  raise exception E'NUMERO-TEST-RESULTS (rolled back)%', coalesce(r, ' <results lost: a value was null>');
end $t$;
