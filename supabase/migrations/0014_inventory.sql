-- >>> applied as migration 20260927124305 · p3_01_permissions_roles
-- =====================================================================
-- GHL NUMERO · 0014 · PHASE 3 — PERMISSIONS AND ROLES
-- Inventory, investments, reality and control, scenarios, platform.
-- Additive only. Nothing from 0001-0013 is dropped.
--
-- Principles carried forward:
--   * An operation never writes to the ledger. It PROPOSES a journal.
--   * A simulation never touches the books and is always labelled.
--   * NUMERO records that money moved. It never moves money.
-- =====================================================================
create or replace function numero_private.seed_roles(gid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_role uuid; p text;
  base_perms text[] := array[
    'company.view','company.configure','account.view','account.configure','orgunit.configure',
    'journal.view','journal.create','journal.edit','journal.submit','journal.approve','journal.reject','journal.post','journal.reverse',
    'invoice.view','invoice.create','invoice.approve','bill.view','bill.create','bill.approve',
    'payment.view','payment.create','payment.approve',
    'party.view','party.create','party.edit','party.bank.verify',
    'bank.view','bank.import','bank.reconcile',
    'budget.view','budget.edit','budget.approve',
    'period.lock','period.reopen',
    'report.view','report.export','audit.view',
    'sentinel.view','sentinel.review','vault.view','numi.use','tax.configure','approval.configure','field.configure'];
  ops_perms text[] := array[
    'register.view','register.manage','document.view','document.upload',
    'asset.view','asset.manage',
    'purchase.view','purchase.create','purchase.approve',
    'expense.view','expense.create','expense.approve',
    'treasury.view','treasury.manage'];
  payroll_perms text[] := array['payroll.view','payroll.manage','payroll.approve'];
  -- phase 3
  p3_all text[] := array[
    'inventory.view','inventory.manage','inventory.count','inventory.approve',
    'investment.view','investment.manage','investment.approve',
    'reality.view','reality.manage',
    'scenario.view','scenario.manage',
    'flow.view','flow.manage','flow.configure',
    'allocation.manage','import.manage',
    'system.health','integration.manage','communication.send'];
  p3_finance text[] := array[
    'inventory.view','inventory.manage','inventory.count','inventory.approve',
    'investment.view','investment.manage','investment.approve',
    'reality.view','reality.manage','scenario.view','scenario.manage',
    'flow.view','flow.manage','flow.configure','allocation.manage','import.manage','system.health','communication.send'];
  p3_accountant text[] := array[
    'inventory.view','inventory.manage','inventory.count','investment.view','investment.manage',
    'reality.view','reality.manage','scenario.view','flow.view','flow.manage','allocation.manage','import.manage','communication.send'];
  p3_read text[] := array['inventory.view','investment.view','reality.view','scenario.view','flow.view'];
begin
  for r in select * from (values
    ('owner','Owner', base_perms || ops_perms || payroll_perms || p3_all),
    ('group_cfo','Group CFO', base_perms || ops_perms || payroll_perms || p3_all),
    ('company_director','Company Director', array['company.view','account.view','journal.view','journal.approve','journal.reject','invoice.view','invoice.approve','bill.view','bill.approve','payment.view','payment.approve','party.view','bank.view','budget.view','budget.approve','report.view','report.export','audit.view','sentinel.view','numi.use',
        'register.view','document.view','asset.view','purchase.view','purchase.approve','expense.view','expense.create','expense.approve','treasury.view']
        || p3_read || array['investment.approve','inventory.approve','scenario.manage','flow.manage']),
    ('finance_head','Finance Head', array['company.view','account.view','account.configure','orgunit.configure','journal.view','journal.create','journal.edit','journal.submit','journal.approve','journal.reject','journal.post','journal.reverse','invoice.view','invoice.create','invoice.approve','bill.view','bill.create','bill.approve','payment.view','payment.create','payment.approve','party.view','party.create','party.edit','party.bank.verify','bank.view','bank.import','bank.reconcile','budget.view','budget.edit','budget.approve','period.lock','report.view','report.export','audit.view','sentinel.view','sentinel.review','numi.use','tax.configure','approval.configure']
        || ops_perms || p3_finance),
    ('accountant','Accountant', array['company.view','account.view','journal.view','journal.create','journal.edit','journal.submit','journal.post','invoice.view','invoice.create','bill.view','bill.create','payment.view','payment.create','party.view','party.create','party.edit','bank.view','bank.import','bank.reconcile','budget.view','report.view','report.export','sentinel.view','numi.use',
        'register.view','register.manage','document.view','document.upload','asset.view','asset.manage','purchase.view','purchase.create','expense.view','expense.create','treasury.view','treasury.manage']
        || p3_accountant),
    ('junior_accountant','Junior Accountant', array['company.view','account.view','journal.view','journal.create','journal.edit','journal.submit','invoice.view','invoice.create','bill.view','bill.create','payment.view','payment.create','party.view','bank.view','report.view','numi.use',
        'register.view','document.view','document.upload','asset.view','purchase.view','expense.view','expense.create',
        'inventory.view','inventory.count','reality.view','flow.view','flow.manage']),
    ('auditor','Auditor', array['company.view','account.view','journal.view','invoice.view','bill.view','payment.view','party.view','bank.view','budget.view','report.view','report.export','audit.view','sentinel.view','numi.use',
        'register.view','document.view','asset.view','purchase.view','expense.view','treasury.view']
        || p3_read || array['reality.manage','system.health']),
    ('tax_consultant','Tax Consultant', array['company.view','account.view','journal.view','invoice.view','bill.view','report.view','report.export','numi.use','document.view','register.view','inventory.view']),
    ('department_head','Department Head', array['company.view','budget.view','report.view','journal.view','numi.use',
        'register.view','document.upload','purchase.view','purchase.create','expense.create','expense.approve','party.view',
        'inventory.view','scenario.view','flow.view','flow.manage']),
    ('project_manager','Project Manager', array['company.view','budget.view','report.view','numi.use',
        'register.view','document.upload','purchase.view','purchase.create','expense.create','party.view',
        'inventory.view','scenario.view','flow.view','flow.manage']),
    ('purchase_manager','Purchase Manager', array['company.view','bill.view','bill.create','party.view','party.create','report.view','numi.use',
        'register.view','document.view','document.upload','purchase.view','purchase.create','expense.create',
        'inventory.view','inventory.manage','inventory.count','flow.view','flow.manage']),
    ('sales_manager','Sales Manager', array['company.view','invoice.view','invoice.create','party.view','party.create','report.view','numi.use',
        'register.view','register.manage','document.upload','expense.create','inventory.view','flow.view','flow.manage','communication.send']),
    ('payroll_officer','Payroll Officer', array['company.view','party.view','numi.use','document.upload','expense.create','payroll.view','payroll.manage','flow.view']),
    ('hr_head','HR Head', array['company.view','party.view','party.create','numi.use','document.upload','expense.create','expense.approve','payroll.view','payroll.manage','payroll.approve','flow.view','flow.manage']),
    ('store_keeper','Store Keeper', array['company.view','party.view','numi.use','document.upload','expense.create','purchase.view',
        'inventory.view','inventory.manage','inventory.count','flow.view']),
    ('investment_manager','Investment Manager', array['company.view','account.view','party.view','party.create','report.view','numi.use','document.view','document.upload','register.view',
        'investment.view','investment.manage','scenario.view','scenario.manage','flow.view']),
    ('it_admin','IT Administrator', array['company.view','numi.use','system.health','integration.manage']),
    ('employee','Employee', array['company.view','numi.use','expense.create','document.upload','flow.view']),
    ('read_only','Read Only', array['company.view','account.view','journal.view','invoice.view','bill.view','payment.view','party.view','bank.view','budget.view','report.view',
        'register.view','document.view','asset.view','purchase.view','expense.view','treasury.view'] || p3_read)
  ) as t(key, name, perms)
  loop
    insert into public.roles(group_id, key, name, is_system) values (gid, r.key, r.name, true)
      on conflict (group_id, key) do update set name = excluded.name
      returning id into v_role;
    foreach p in array r.perms loop
      insert into public.role_permissions(role_id, permission) values (v_role, p) on conflict do nothing;
    end loop;
  end loop;
end $$;

do $$ declare g record; begin
  for g in select id from public.groups loop perform numero_private.seed_roles(g.id); end loop;
end $$;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927124523 · p3_02_inventory_tables
-- =====================================================================
-- GHL NUMERO · 0014 · INVENTORY — TABLES
-- Spec: 24, 28, 29, 153, 568, 570, 573, 700, 1387
--
-- The stock ledger (inv_movements) and the general ledger say the same
-- thing: every movement that changes the value of stock belongs to a
-- stock document whose accounting entry was PROPOSED and approved.
-- A transfer between two warehouses of one company changes no value and
-- proposes nothing.
-- =====================================================================
create table public.inv_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  inventory_account_id uuid not null references public.accounts(id),
  cogs_account_id uuid not null references public.accounts(id),
  valuation_method text not null default 'weighted_average' check (valuation_method in ('weighted_average','fifo')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (company_id, name)
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  kind text not null default 'warehouse' check (kind in ('warehouse','store','site','office','transit','service_van')),
  org_unit_id uuid references public.org_units(id),
  address text,
  keeper_party_id uuid references public.parties(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (company_id, code)
);

create table public.inv_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  sku text not null,
  name text not null,
  category_id uuid not null references public.inv_categories(id),
  description text,
  unit text not null default 'unit',
  tracking text not null default 'none' check (tracking in ('none','lot','serial')),
  valuation_method text not null check (valuation_method in ('weighted_average','fifo')),
  tax_code_id uuid references public.tax_codes(id),
  hsn_code text,
  reorder_level numeric(20,4) check (reorder_level is null or reorder_level >= 0),
  reorder_qty numeric(20,4) check (reorder_qty is null or reorder_qty >= 0),
  shelf_life_days int check (shelf_life_days is null or shelf_life_days > 0),
  slow_after_days int check (slow_after_days is null or slow_after_days > 0),
  manufacturer text,
  model text,
  sale_price numeric(20,4) check (sale_price is null or sale_price >= 0),
  unit_weight numeric(20,4) check (unit_weight is null or unit_weight >= 0),
  attrs jsonb not null default '{}'::jsonb,
  qty_on_hand numeric(20,4) not null default 0 check (qty_on_hand >= 0),
  value_on_hand numeric(20,4) not null default 0,
  qty_reserved numeric(20,4) not null default 0 check (qty_reserved >= 0),
  value_reserved numeric(20,4) not null default 0,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (company_id, sku),
  check (qty_reserved <= qty_on_hand)
);
create index inv_items_company_idx on public.inv_items(company_id, status);

create table public.inv_lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.inv_items(id),
  lot_no text not null,
  is_serial boolean not null default false,
  mfg_date date,
  expiry_date date,
  supplier_party_id uuid references public.parties(id),
  import_details jsonb not null default '{}'::jsonb,
  landed_cost numeric(20,4),
  -- a serial-numbered unit after it is sold
  sold_to_party_id uuid references public.parties(id),
  sale_invoice_id uuid references public.invoices(id),
  sold_on date,
  installed_on date,
  customer_location text,
  warranty_until date,
  service_item_id uuid references public.register_items(id),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (item_id, lot_no)
);
create index inv_lots_expiry_idx on public.inv_lots(company_id, expiry_date) where expiry_date is not null;

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  warehouse_id uuid not null references public.warehouses(id),
  count_no text not null,
  count_date date not null,
  status text not null default 'open' check (status in ('open','counted','reviewed','proposed','posted','closed','cancelled')),
  frozen boolean not null default true,
  snapshot_at timestamptz not null default now(),
  scope jsonb not null default '{}'::jsonb,
  counted_by uuid,
  counted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  doc_id uuid,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, count_no)
);
create unique index stock_counts_one_open on public.stock_counts(warehouse_id)
  where status in ('open','counted','reviewed','proposed');

create table public.stock_docs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null check (kind in ('receipt','issue','transfer','return_in','return_out','adjustment','landed_cost')),
  doc_no text not null,
  doc_date date not null,
  warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id uuid references public.warehouses(id),
  party_id uuid references public.parties(id),
  purchase_doc_id uuid references public.purchase_docs(id),
  invoice_id uuid references public.invoices(id),
  receipt_doc_id uuid references public.stock_docs(id),
  count_id uuid references public.stock_counts(id),
  counter_account_id uuid references public.accounts(id),
  reason text,
  dims jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','proposed','posted','rejected','reversed','cancelled')),
  total_value numeric(20,4) not null default 0,
  journal_id uuid references public.journals(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, kind, doc_no),
  check (kind <> 'transfer' or (to_warehouse_id is not null and to_warehouse_id <> warehouse_id))
);
create index stock_docs_company_idx on public.stock_docs(company_id, kind, status);
create index stock_docs_purchase_idx on public.stock_docs(purchase_doc_id) where purchase_doc_id is not null;
alter table public.stock_counts add constraint stock_counts_doc_fk foreign key (doc_id) references public.stock_docs(id);

create table public.inv_holds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.inv_items(id),
  warehouse_id uuid not null references public.warehouses(id),
  lot_id uuid references public.inv_lots(id),
  qty numeric(20,4) not null check (qty > 0),
  condition text not null check (condition in ('damaged','expired','obsolete','quarantine','missing')),
  noted_on date not null,
  note text,
  status text not null default 'open' check (status in ('open','released','written_off')),
  resolved_doc_id uuid references public.stock_docs(id),
  resolved_at timestamptz,
  resolved_note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index inv_holds_open_idx on public.inv_holds(company_id, status);

create table public.stock_doc_lines (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.stock_docs(id),
  company_id uuid not null references public.companies(id),
  line_no int not null,
  item_id uuid not null references public.inv_items(id),
  lot_id uuid references public.inv_lots(id),
  qty numeric(20,4) not null check (qty <> 0),          -- negative only on an adjustment (stock lost)
  unit_cost numeric(20,6) not null default 0 check (unit_cost >= 0),
  value numeric(20,4) not null default 0,               -- signed like qty; for landed cost: the amount added to stock
  expensed numeric(20,4) not null default 0,            -- landed cost of units that have already left stock
  weight numeric(20,4),
  reason_code text check (reason_code is null or reason_code in
    ('damage','expiry','theft','breakage','obsolescence','shrinkage','count_difference','found','sample','other')),
  source_line_id uuid references public.purchase_doc_lines(id),
  receipt_line_id uuid references public.stock_doc_lines(id),
  hold_id uuid references public.inv_holds(id),
  note text,
  unique (doc_id, line_no)
);
create index stock_doc_lines_item_idx on public.stock_doc_lines(item_id);
create index stock_doc_lines_source_idx on public.stock_doc_lines(source_line_id) where source_line_id is not null;

-- The stock ledger. Rows are never deleted; a rejected or reversed movement keeps its row.
create table public.inv_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.inv_items(id),
  warehouse_id uuid not null references public.warehouses(id),
  lot_id uuid references public.inv_lots(id),
  doc_id uuid not null references public.stock_docs(id),
  doc_line_id uuid references public.stock_doc_lines(id),
  kind text not null,
  move_date date not null,
  qty numeric(20,4) not null,                            -- positive in, negative out, zero for a value-only movement
  value numeric(20,4) not null,
  unit_cost numeric(20,6) not null default 0,
  is_layer boolean not null default false,               -- a receipt that later issues draw from
  remaining_qty numeric(20,4) not null default 0 check (remaining_qty >= 0),
  remaining_value numeric(20,4) not null default 0,
  status text not null default 'proposed' check (status in ('proposed','posted','rejected','reversed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index inv_movements_item_idx on public.inv_movements(item_id, status, move_date);
create index inv_movements_wh_idx on public.inv_movements(warehouse_id, item_id, lot_id) where status in ('proposed','posted');
create index inv_movements_doc_idx on public.inv_movements(doc_id);
create index inv_movements_layer_idx on public.inv_movements(item_id, move_date, created_at) where is_layer and status = 'posted' and remaining_qty > 0;

-- Which receipts an outgoing movement drew from, and at what cost.
create table public.inv_layer_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  movement_id uuid not null references public.inv_movements(id),
  layer_id uuid not null references public.inv_movements(id),
  qty numeric(20,4) not null check (qty > 0),
  value numeric(20,4) not null,
  released boolean not null default false
);
create index inv_layer_usage_mv_idx on public.inv_layer_usage(movement_id);
create index inv_layer_usage_layer_idx on public.inv_layer_usage(layer_id);

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts(id),
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.inv_items(id),
  lot_id uuid references public.inv_lots(id),
  book_qty numeric(20,4) not null default 0,
  unit_cost numeric(20,6) not null default 0,
  counted_qty numeric(20,4) check (counted_qty is null or counted_qty >= 0),
  reason_code text check (reason_code is null or reason_code in
    ('damage','expiry','theft','breakage','obsolescence','shrinkage','count_difference','found','other')),
  note text,
  added_in_count boolean not null default false
);
create unique index stock_count_lines_key on public.stock_count_lines(count_id, item_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- The life of a serial-numbered unit: installation, engineer visits, spare parts, warranty.
create table public.inv_unit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lot_id uuid not null references public.inv_lots(id),
  event_type text not null check (event_type in ('installation','engineer_visit','spare_part','warranty_claim','service_contract','relocation','note')),
  event_date date not null,
  party_id uuid references public.parties(id),
  engineer_name text,
  cost numeric(20,4),
  chargeable boolean,
  invoice_id uuid references public.invoices(id),
  detail jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index inv_unit_events_lot_idx on public.inv_unit_events(lot_id, event_date desc);

-- ---------- audit ----------
create trigger audit_inv_categories after insert or update or delete on public.inv_categories for each row execute function numero_private.audit_row();
create trigger audit_warehouses after insert or update or delete on public.warehouses for each row execute function numero_private.audit_row();
create trigger audit_inv_lots after insert or update or delete on public.inv_lots for each row execute function numero_private.audit_row();
create trigger audit_stock_docs after insert or update or delete on public.stock_docs for each row execute function numero_private.audit_row();
create trigger audit_stock_counts after insert or update or delete on public.stock_counts for each row execute function numero_private.audit_row();
create trigger audit_inv_holds after insert or update or delete on public.inv_holds for each row execute function numero_private.audit_row();

-- An item's running quantity and value change with every posting; the stock ledger is their history.
-- The audit trail records changes to what a person maintains, not each change of balance.
create or replace function numero_private.audit_inv_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - array['qty_on_hand','value_on_hand','qty_reserved','value_reserved'];
    v_new := to_jsonb(new) - array['qty_on_hand','value_on_hand','qty_reserved','value_reserved'];
    if v_old = v_new then return new; end if;
  end if;
  insert into public.audit_log(actor, group_id, company_id, entity, entity_id, action, old_value, new_value, reason)
  values ((select auth.uid()), (select group_id from public.companies where id = coalesce(new.company_id, old.company_id)),
          coalesce(new.company_id, old.company_id), 'inv_items', coalesce(new.id, old.id), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end,
          nullif(current_setting('numero.reason', true), ''));
  return coalesce(new, old);
end $$;
create trigger audit_inv_items after insert or update or delete on public.inv_items for each row execute function numero_private.audit_inv_item();

-- The stock ledger is evidence: a movement is never deleted, and its facts never change.
create or replace function numero_private.guard_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'NUMERO: a stock movement is never deleted. Reject or reverse its document.' using errcode = 'P0001';
  end if;
  if new.item_id <> old.item_id or new.warehouse_id <> old.warehouse_id or new.lot_id is distinct from old.lot_id
     or new.doc_id <> old.doc_id or new.qty <> old.qty or new.move_date <> old.move_date or new.kind <> old.kind
     or new.value <> old.value then
    raise exception 'NUMERO: the facts of a stock movement cannot be changed.' using errcode = 'P0001';
  end if;
  if old.status in ('rejected','reversed') and new.status <> old.status then
    raise exception 'NUMERO: a rejected or reversed stock movement stays as it is.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_movement before update or delete on public.inv_movements for each row execute function numero_private.guard_movement();

-- ---------- row level security ----------
alter table public.inv_categories enable row level security;
alter table public.warehouses enable row level security;
alter table public.inv_items enable row level security;
alter table public.inv_lots enable row level security;
alter table public.stock_docs enable row level security;
alter table public.stock_doc_lines enable row level security;
alter table public.inv_movements enable row level security;
alter table public.inv_layer_usage enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.inv_holds enable row level security;
alter table public.inv_unit_events enable row level security;

create policy inv_categories_select on public.inv_categories for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')) or (select numero_private.can(company_id, 'inventory.count')));
create policy warehouses_select on public.warehouses for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')) or (select numero_private.can(company_id, 'inventory.count')));
create policy inv_items_select on public.inv_items for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')) or (select numero_private.can(company_id, 'inventory.count')));
create policy inv_lots_select on public.inv_lots for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')) or (select numero_private.can(company_id, 'inventory.count')));
create policy stock_docs_select on public.stock_docs for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')));
create policy stock_doc_lines_select on public.stock_doc_lines for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')));
create policy inv_movements_select on public.inv_movements for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')));
create policy inv_layer_usage_select on public.inv_layer_usage for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')));
create policy stock_counts_select on public.stock_counts for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')) or (select numero_private.can(company_id, 'inventory.count')));
create policy stock_count_lines_select on public.stock_count_lines for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')) or (select numero_private.can(company_id, 'inventory.count')));
create policy inv_holds_select on public.inv_holds for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')));
create policy inv_unit_events_select on public.inv_unit_events for select to authenticated
  using ((select numero_private.can(company_id, 'inventory.view')));

insert into numero_private.internal_functions(name) values ('guard_movement'), ('audit_inv_item') on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927124643 · p3_03_inventory_master_data
-- =====================================================================
-- INVENTORY — what a person maintains: categories, warehouses, items,
-- lots and serial-numbered units, conditions noted on stock.
-- =====================================================================
create or replace function numero_private.inv_posting_account(p_company uuid, p_id uuid, p_what text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = p_id;
  if not found or a.company_id <> p_company or a.is_group or not a.is_active then
    raise exception 'NUMERO: choose an active posting account of this company for %.', p_what using errcode = 'P0001';
  end if;
  return a.id;
end $$;

create or replace function numero_private.save_inv_category(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_inv public.accounts; v_method text := coalesce(p->>'valuation_method', 'weighted_average');
begin
  if not numero_private.can(v_company, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to maintain inventory for this company.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: a name is required.' using errcode = 'P0001'; end if;
  if v_method not in ('weighted_average','fifo') then raise exception 'NUMERO: the valuation method must be weighted average or first in, first out.' using errcode = 'P0001'; end if;
  perform numero_private.inv_posting_account(v_company, (p->>'inventory_account_id')::uuid, 'the stock ledger');
  perform numero_private.inv_posting_account(v_company, (p->>'cogs_account_id')::uuid, 'the cost of goods sold');
  select * into v_inv from public.accounts where id = (p->>'inventory_account_id')::uuid;
  if v_inv.type <> 'asset' then raise exception 'NUMERO: the stock ledger must be an asset.' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.inv_categories(company_id, name, inventory_account_id, cogs_account_id, valuation_method)
    values (v_company, trim(p->>'name'), (p->>'inventory_account_id')::uuid, (p->>'cogs_account_id')::uuid, v_method)
    returning id into v_id;
  else
    -- the stock ledger of a category cannot change while its items hold stock: the books would no longer agree
    if exists (select 1 from public.inv_categories c where c.id = v_id and c.company_id = v_company
                 and c.inventory_account_id <> (p->>'inventory_account_id')::uuid)
       and exists (select 1 from public.inv_items i where i.category_id = v_id and (i.qty_on_hand <> 0 or i.value_on_hand <> 0)) then
      raise exception 'NUMERO: the stock ledger of a category cannot be changed while its items hold stock.' using errcode = 'P0001';
    end if;
    update public.inv_categories set name = trim(p->>'name'), inventory_account_id = (p->>'inventory_account_id')::uuid,
      cogs_account_id = (p->>'cogs_account_id')::uuid, valuation_method = v_method,
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id and company_id = v_company;
    if not found then raise exception 'NUMERO: category not found.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function numero_private.save_warehouse(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_gid uuid;
begin
  if not numero_private.can(v_company, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to maintain inventory for this company.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'code'), '') = '' or coalesce(trim(p->>'name'), '') = '' then
    raise exception 'NUMERO: a code and a name are required.' using errcode = 'P0001';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  if p->>'org_unit_id' is not null and not exists (
       select 1 from public.org_units u where u.id = (p->>'org_unit_id')::uuid and u.company_id = v_company) then
    raise exception 'NUMERO: the selected branch, site or office belongs to another company.' using errcode = 'P0001';
  end if;
  if p->>'keeper_party_id' is not null and not exists (
       select 1 from public.parties x where x.id = (p->>'keeper_party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: unknown party.' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.warehouses(company_id, code, name, kind, org_unit_id, address, keeper_party_id)
    values (v_company, upper(trim(p->>'code')), trim(p->>'name'), coalesce(p->>'kind', 'warehouse'), (p->>'org_unit_id')::uuid,
            p->>'address', (p->>'keeper_party_id')::uuid)
    returning id into v_id;
  else
    if coalesce((p->>'is_active')::boolean, true) = false and exists (
         select 1 from public.inv_movements m where m.warehouse_id = v_id and m.status in ('proposed','posted')
          group by m.item_id, m.lot_id having sum(m.qty) <> 0) then
      raise exception 'NUMERO: this location still holds stock. Transfer or adjust it before closing the location.' using errcode = 'P0001';
    end if;
    update public.warehouses set code = upper(trim(p->>'code')), name = trim(p->>'name'), kind = coalesce(p->>'kind', kind),
      org_unit_id = (p->>'org_unit_id')::uuid, address = p->>'address', keeper_party_id = (p->>'keeper_party_id')::uuid,
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id and company_id = v_company;
    if not found then raise exception 'NUMERO: location not found.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function numero_private.save_inv_item(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; c public.inv_categories; it public.inv_items;
        v_method text; v_tracking text := coalesce(p->>'tracking', 'none');
begin
  if not numero_private.can(v_company, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to maintain inventory for this company.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'sku'), '') = '' or coalesce(trim(p->>'name'), '') = '' then
    raise exception 'NUMERO: an item needs a code (SKU) and a name.' using errcode = 'P0001';
  end if;
  select * into c from public.inv_categories where id = (p->>'category_id')::uuid;
  if not found or c.company_id <> v_company then raise exception 'NUMERO: choose a category of this company.' using errcode = 'P0001'; end if;
  v_method := coalesce(p->>'valuation_method', c.valuation_method);
  if v_method not in ('weighted_average','fifo') then raise exception 'NUMERO: the valuation method must be weighted average or first in, first out.' using errcode = 'P0001'; end if;
  if v_tracking not in ('none','lot','serial') then raise exception 'NUMERO: tracking must be none, by lot or by serial number.' using errcode = 'P0001'; end if;
  if p->>'tax_code_id' is not null and not exists (
       select 1 from public.tax_codes t where t.id = (p->>'tax_code_id')::uuid and t.company_id = v_company) then
    raise exception 'NUMERO: the tax code belongs to another company.' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.inv_items(company_id, sku, name, category_id, description, unit, tracking, valuation_method, tax_code_id, hsn_code,
      reorder_level, reorder_qty, shelf_life_days, slow_after_days, manufacturer, model, sale_price, unit_weight, attrs)
    values (v_company, upper(trim(p->>'sku')), trim(p->>'name'), c.id, p->>'description', coalesce(nullif(trim(p->>'unit'), ''), 'unit'),
      v_tracking, v_method, (p->>'tax_code_id')::uuid, p->>'hsn_code', (p->>'reorder_level')::numeric, (p->>'reorder_qty')::numeric,
      (p->>'shelf_life_days')::int, (p->>'slow_after_days')::int, p->>'manufacturer', p->>'model', (p->>'sale_price')::numeric,
      (p->>'unit_weight')::numeric, coalesce(p->'attrs', '{}'::jsonb))
    returning id into v_id;
  else
    select * into it from public.inv_items where id = v_id and company_id = v_company for update;
    if not found then raise exception 'NUMERO: item not found.' using errcode = 'P0001'; end if;
    -- method, tracking and category decide how stock is valued and where it sits in the books:
    -- they cannot change while the item holds stock or has an entry awaiting approval
    if (it.valuation_method <> v_method or it.tracking <> v_tracking
        or (it.category_id <> c.id and (select inventory_account_id from public.inv_categories where id = it.category_id) <> c.inventory_account_id))
       and (it.qty_on_hand <> 0 or it.value_on_hand <> 0
            or exists (select 1 from public.inv_movements m where m.item_id = it.id and m.status = 'proposed')) then
      raise exception 'NUMERO: the valuation method, the tracking and the stock ledger of an item cannot change while it holds stock. Bring the stock to zero first.' using errcode = 'P0001';
    end if;
    if coalesce(p->>'status', it.status) = 'inactive' and it.qty_on_hand <> 0 then
      raise exception 'NUMERO: an item that holds stock cannot be made inactive.' using errcode = 'P0001';
    end if;
    perform set_config('numero.reason', coalesce(p->>'reason', ''), true);
    update public.inv_items set sku = upper(trim(p->>'sku')), name = trim(p->>'name'), category_id = c.id, description = p->>'description',
      unit = coalesce(nullif(trim(p->>'unit'), ''), unit), tracking = v_tracking, valuation_method = v_method,
      tax_code_id = (p->>'tax_code_id')::uuid, hsn_code = p->>'hsn_code', reorder_level = (p->>'reorder_level')::numeric,
      reorder_qty = (p->>'reorder_qty')::numeric, shelf_life_days = (p->>'shelf_life_days')::int, slow_after_days = (p->>'slow_after_days')::int,
      manufacturer = p->>'manufacturer', model = p->>'model', sale_price = (p->>'sale_price')::numeric,
      unit_weight = (p->>'unit_weight')::numeric, attrs = coalesce(p->'attrs', attrs), status = coalesce(p->>'status', status)
    where id = v_id;
  end if;
  return v_id;
end $$;

-- What is known about a lot or a serial-numbered unit. Its quantity is never set here: that is the stock ledger.
create or replace function numero_private.save_inv_lot(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.inv_lots; v_gid uuid;
begin
  select * into l from public.inv_lots where id = (p->>'id')::uuid for update;
  if not found then raise exception 'NUMERO: lot not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(l.company_id, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to maintain inventory for this company.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = l.company_id;
  if p->>'sold_to_party_id' is not null and not exists (
       select 1 from public.parties x where x.id = (p->>'sold_to_party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: unknown party.' using errcode = 'P0001';
  end if;
  if p->>'service_item_id' is not null and not exists (
       select 1 from public.register_items r where r.id = (p->>'service_item_id')::uuid and r.company_id = l.company_id) then
    raise exception 'NUMERO: the service contract belongs to another company.' using errcode = 'P0001';
  end if;
  update public.inv_lots set
    mfg_date = case when p ? 'mfg_date' then (p->>'mfg_date')::date else mfg_date end,
    expiry_date = case when p ? 'expiry_date' then (p->>'expiry_date')::date else expiry_date end,
    import_details = case when p ? 'import_details' then coalesce(p->'import_details', '{}'::jsonb) else import_details end,
    sold_to_party_id = case when p ? 'sold_to_party_id' then (p->>'sold_to_party_id')::uuid else sold_to_party_id end,
    sold_on = case when p ? 'sold_on' then (p->>'sold_on')::date else sold_on end,
    installed_on = case when p ? 'installed_on' then (p->>'installed_on')::date else installed_on end,
    customer_location = case when p ? 'customer_location' then p->>'customer_location' else customer_location end,
    warranty_until = case when p ? 'warranty_until' then (p->>'warranty_until')::date else warranty_until end,
    service_item_id = case when p ? 'service_item_id' then (p->>'service_item_id')::uuid else service_item_id end,
    note = case when p ? 'note' then p->>'note' else note end
  where id = l.id;
  return l.id;
end $$;

create or replace function numero_private.record_unit_event(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.inv_lots; v_id uuid; v_type text := p->>'event_type'; v_gid uuid;
begin
  select * into l from public.inv_lots where id = (p->>'lot_id')::uuid for update;
  if not found then raise exception 'NUMERO: unit not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(l.company_id, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to maintain inventory for this company.' using errcode = '42501';
  end if;
  if v_type is null or v_type not in ('installation','engineer_visit','spare_part','warranty_claim','service_contract','relocation','note') then
    raise exception 'NUMERO: unknown event.' using errcode = 'P0001';
  end if;
  if (p->>'event_date') is null then raise exception 'NUMERO: the date is required.' using errcode = 'P0001'; end if;
  select group_id into v_gid from public.companies where id = l.company_id;
  if p->>'party_id' is not null and not exists (
       select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: unknown party.' using errcode = 'P0001';
  end if;
  insert into public.inv_unit_events(company_id, lot_id, event_type, event_date, party_id, engineer_name, cost, chargeable, invoice_id, detail)
  values (l.company_id, l.id, v_type, (p->>'event_date')::date, (p->>'party_id')::uuid, p->>'engineer_name', (p->>'cost')::numeric,
          (p->>'chargeable')::boolean, (p->>'invoice_id')::uuid, coalesce(p->'detail', '{}'::jsonb))
  returning id into v_id;
  if v_type = 'installation' then
    update public.inv_lots set installed_on = (p->>'event_date')::date,
      customer_location = coalesce(p->'detail'->>'location', customer_location),
      warranty_until = coalesce((p->'detail'->>'warranty_until')::date, warranty_until)
    where id = l.id;
  elsif v_type = 'relocation' then
    update public.inv_lots set customer_location = coalesce(p->'detail'->>'location', customer_location) where id = l.id;
  end if;
  return v_id;
end $$;

-- Quantity in one place, counting what is posted and what is awaiting approval.
create or replace function numero_private.stock_available(p_item uuid, p_warehouse uuid, p_lot uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(m.qty) filter (where m.status = 'posted' or m.qty < 0), 0)
    from public.inv_movements m
   where m.item_id = p_item and m.warehouse_id = p_warehouse and m.lot_id is not distinct from p_lot
     and m.status in ('proposed','posted');
$$;

create or replace function numero_private.save_inv_hold(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; it public.inv_items; v_qty numeric := (p->>'qty')::numeric; v_id uuid; v_held numeric; v_have numeric;
begin
  if not numero_private.can(v_company, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to maintain inventory for this company.' using errcode = '42501';
  end if;
  select * into it from public.inv_items where id = (p->>'item_id')::uuid;
  if not found or it.company_id <> v_company then raise exception 'NUMERO: item not found.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.warehouses w where w.id = (p->>'warehouse_id')::uuid and w.company_id = v_company) then
    raise exception 'NUMERO: location not found.' using errcode = 'P0001';
  end if;
  if p->>'condition' is null or p->>'condition' not in ('damaged','expired','obsolete','quarantine','missing') then
    raise exception 'NUMERO: state the condition: damaged, expired, obsolete, quarantine or missing.' using errcode = 'P0001';
  end if;
  if v_qty is null or v_qty <= 0 then raise exception 'NUMERO: the quantity must be greater than zero.' using errcode = 'P0001'; end if;
  v_have := numero_private.stock_available(it.id, (p->>'warehouse_id')::uuid, (p->>'lot_id')::uuid);
  select coalesce(sum(h.qty), 0) into v_held from public.inv_holds h
   where h.item_id = it.id and h.warehouse_id = (p->>'warehouse_id')::uuid and h.lot_id is not distinct from (p->>'lot_id')::uuid and h.status = 'open';
  if v_held + v_qty > v_have then
    raise exception 'NUMERO: only % % of this item are in this location, and % are already noted. The quantity noted cannot exceed the stock.', v_have, it.unit, v_held using errcode = 'P0001';
  end if;
  insert into public.inv_holds(company_id, item_id, warehouse_id, lot_id, qty, condition, noted_on, note)
  values (v_company, it.id, (p->>'warehouse_id')::uuid, (p->>'lot_id')::uuid, v_qty, p->>'condition',
          coalesce((p->>'noted_on')::date, current_date), p->>'note')
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.release_inv_hold(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.inv_holds;
begin
  select * into h from public.inv_holds where id = p_id for update;
  if not found then raise exception 'NUMERO: record not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(h.company_id, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to maintain inventory for this company.' using errcode = '42501';
  end if;
  if h.status <> 'open' then raise exception 'NUMERO: this note is already %.', replace(h.status, '_', ' ') using errcode = 'P0001'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'NUMERO: say why the stock is released.' using errcode = 'P0001'; end if;
  update public.inv_holds set status = 'released', resolved_at = now(), resolved_note = p_note where id = p_id;
end $$;

create or replace function public.save_inv_category(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_inv_category(p); $$;
create or replace function public.save_warehouse(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_warehouse(p); $$;
create or replace function public.save_inv_item(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_inv_item(p); $$;
create or replace function public.save_inv_lot(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_inv_lot(p); $$;
create or replace function public.record_unit_event(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.record_unit_event(p); $$;
create or replace function public.save_inv_hold(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_inv_hold(p); $$;
create or replace function public.release_inv_hold(p_id uuid, p_note text) returns void language sql set search_path = '' as $$ select numero_private.release_inv_hold(p_id, p_note); $$;

insert into numero_private.internal_functions(name) values ('inv_posting_account'), ('stock_available') on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927125032 · p3_04_stock_documents
-- =====================================================================
-- INVENTORY — STOCK DOCUMENTS
-- receipt · issue · transfer · return in · return out · adjustment · landed cost
--
-- A stock document is prepared by a person, then PROPOSED. Proposing it
-- works out the cost, reserves the quantity and places the accounting
-- entry in the approval queue. The stock ledger and the item balances
-- change only when that entry is approved.
-- =====================================================================

-- A movement keeps its facts. Its cost may be set only while it awaits approval.
create or replace function numero_private.guard_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'NUMERO: a stock movement is never deleted. Reject or reverse its document.' using errcode = 'P0001';
  end if;
  if new.item_id <> old.item_id or new.warehouse_id <> old.warehouse_id or new.lot_id is distinct from old.lot_id
     or new.doc_id <> old.doc_id or new.qty <> old.qty or new.move_date <> old.move_date or new.kind <> old.kind
     or (new.value <> old.value and old.status <> 'proposed') then
    raise exception 'NUMERO: the facts of a stock movement cannot be changed.' using errcode = 'P0001';
  end if;
  if old.status in ('rejected','reversed') and new.status <> old.status then
    raise exception 'NUMERO: a rejected or reversed stock movement stays as it is.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- While a stock count is open for a location, nothing else may move there: the count would be of a moving target.
create or replace function numero_private.assert_not_counting(p_warehouse uuid, p_count uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare c public.stock_counts;
begin
  select * into c from public.stock_counts
   where warehouse_id = p_warehouse and frozen and status in ('open','counted','reviewed','proposed') and id is distinct from p_count
   limit 1;
  if found then
    raise exception 'NUMERO: stock count % is open for this location, so its stock is frozen. Complete or cancel the count first.', c.count_no using errcode = 'P0001';
  end if;
end $$;

create or replace function numero_private.save_stock_doc(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_kind text := p->>'kind';
  v_date date := (p->>'doc_date')::date; v_gid uuid; d public.stock_docs; wh public.warehouses; gr public.purchase_docs;
  rc public.stock_docs; l jsonb; v_no int := 0; it public.inv_items; lot public.inv_lots; v_lot uuid; v_qty numeric; v_cost numeric;
  src public.purchase_doc_lines; v_done numeric; v_total numeric := 0; v_in boolean; k jsonb; v_prefix text; h public.inv_holds;
  rl public.stock_doc_lines; v_dim record;
begin
  if not numero_private.can(v_company, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to prepare stock documents.' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('receipt','issue','transfer','return_in','return_out','adjustment','landed_cost') then
    raise exception 'NUMERO: unknown stock document.' using errcode = 'P0001';
  end if;
  if v_date is null then raise exception 'NUMERO: the date is required.' using errcode = 'P0001'; end if;
  select group_id into v_gid from public.companies where id = v_company;

  if v_kind = 'landed_cost' then
    select * into rc from public.stock_docs where id = (p->>'receipt_doc_id')::uuid;
    if not found or rc.company_id <> v_company or rc.kind <> 'receipt' or rc.status <> 'posted' then
      raise exception 'NUMERO: landed cost is added to a stock receipt that has been posted.' using errcode = 'P0001';
    end if;
    if coalesce(p->'meta'->>'method', 'value') not in ('value','quantity','weight') then
      raise exception 'NUMERO: landed cost is shared by value, by quantity or by weight.' using errcode = 'P0001';
    end if;
    if jsonb_typeof(p->'meta'->'charges') is distinct from 'array' or jsonb_array_length(p->'meta'->'charges') = 0 then
      raise exception 'NUMERO: list the charges that make up the landed cost.' using errcode = 'P0001';
    end if;
    for k in select * from jsonb_array_elements(p->'meta'->'charges') loop
      if coalesce(trim(k->>'name'), '') = '' or coalesce((k->>'amount')::numeric, 0) <= 0 then
        raise exception 'NUMERO: each charge needs a name and an amount greater than zero.' using errcode = 'P0001';
      end if;
      if k->>'account_id' is not null then
        perform numero_private.inv_posting_account(v_company, (k->>'account_id')::uuid, 'the charge "' || (k->>'name') || '"');
      end if;
      if k->>'party_id' is not null and not exists (
           select 1 from public.parties x where x.id = (k->>'party_id')::uuid and x.group_id = v_gid) then
        raise exception 'NUMERO: unknown party on the charge "%".', k->>'name' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  select * into wh from public.warehouses where id = coalesce((p->>'warehouse_id')::uuid, rc.warehouse_id);
  if not found or wh.company_id <> v_company or not wh.is_active then
    raise exception 'NUMERO: choose an active location of this company.' using errcode = 'P0001';
  end if;
  if v_kind = 'transfer' then
    if not exists (select 1 from public.warehouses w where w.id = (p->>'to_warehouse_id')::uuid and w.company_id = v_company and w.is_active)
       or (p->>'to_warehouse_id')::uuid = wh.id then
      raise exception 'NUMERO: a transfer needs another active location of the same company to receive the stock.' using errcode = 'P0001';
    end if;
  end if;
  if p->>'party_id' is not null and not exists (
       select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: unknown party.' using errcode = 'P0001';
  end if;
  if p->>'counter_account_id' is not null then
    perform numero_private.inv_posting_account(v_company, (p->>'counter_account_id')::uuid, 'the other side of the entry');
  end if;
  for v_dim in select key, value from jsonb_each_text(coalesce(p->'dims', '{}'::jsonb)) loop
    if coalesce(v_dim.value, '') <> '' and not exists (
         select 1 from public.org_units u where u.id = v_dim.value::uuid and u.company_id = v_company) then
      raise exception 'NUMERO: the selected dimension belongs to another company.' using errcode = 'P0001';
    end if;
  end loop;
  if p->>'purchase_doc_id' is not null then
    if v_kind not in ('receipt','return_out') then
      raise exception 'NUMERO: only a stock receipt or a return to the vendor refers to a goods receipt.' using errcode = 'P0001';
    end if;
    select * into gr from public.purchase_docs where id = (p->>'purchase_doc_id')::uuid;
    if not found or gr.company_id <> v_company or gr.kind <> 'goods_receipt' or gr.status <> 'confirmed' then
      raise exception 'NUMERO: stock is received against a goods receipt that has been confirmed.' using errcode = 'P0001';
    end if;
  end if;
  if p->>'invoice_id' is not null and not exists (
       select 1 from public.invoices i where i.id = (p->>'invoice_id')::uuid and i.company_id = v_company) then
    raise exception 'NUMERO: the invoice belongs to another company.' using errcode = 'P0001';
  end if;
  if v_kind = 'adjustment' and coalesce(trim(p->>'reason'), '') = '' then
    raise exception 'NUMERO: an adjustment of stock needs its reason.' using errcode = 'P0001';
  end if;

  if v_id is not null then
    select * into d from public.stock_docs where id = v_id for update;
    if not found or d.company_id <> v_company or d.kind <> v_kind then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
    if d.status not in ('draft','rejected') then raise exception 'NUMERO: only a draft can be edited. This document is %.', d.status using errcode = 'P0001'; end if;
    if d.count_id is not null then raise exception 'NUMERO: this adjustment belongs to a stock count and is changed through the count.' using errcode = 'P0001'; end if;
    update public.stock_docs set status = 'draft', doc_date = v_date, warehouse_id = wh.id, to_warehouse_id = (p->>'to_warehouse_id')::uuid,
      party_id = coalesce((p->>'party_id')::uuid, gr.party_id), purchase_doc_id = (p->>'purchase_doc_id')::uuid, invoice_id = (p->>'invoice_id')::uuid,
      receipt_doc_id = rc.id, counter_account_id = (p->>'counter_account_id')::uuid, reason = p->>'reason',
      dims = coalesce(p->'dims', '{}'::jsonb), meta = coalesce(p->'meta', '{}'::jsonb), journal_id = null
    where id = v_id;
    delete from public.stock_doc_lines where doc_id = v_id;
  else
    v_prefix := case v_kind when 'receipt' then 'SR' when 'issue' then 'SI' when 'transfer' then 'ST' when 'return_in' then 'SRI'
                            when 'return_out' then 'SRO' when 'adjustment' then 'SA' else 'LC' end;
    insert into public.stock_docs(company_id, kind, doc_no, doc_date, warehouse_id, to_warehouse_id, party_id, purchase_doc_id, invoice_id,
      receipt_doc_id, count_id, counter_account_id, reason, dims, meta)
    values (v_company, v_kind, numero_private.next_doc_no(v_company, 'stock_' || v_kind, v_prefix, v_date), v_date, wh.id,
      (p->>'to_warehouse_id')::uuid, coalesce((p->>'party_id')::uuid, gr.party_id), (p->>'purchase_doc_id')::uuid, (p->>'invoice_id')::uuid,
      rc.id, (p->>'count_id')::uuid, (p->>'counter_account_id')::uuid, p->>'reason', coalesce(p->'dims', '{}'::jsonb), coalesce(p->'meta', '{}'::jsonb))
    returning id into v_id;
  end if;

  if v_kind = 'landed_cost' then
    -- one line for each line of the receipt; the amounts are worked out when the document is proposed
    for rl in select * from public.stock_doc_lines where doc_id = rc.id order by line_no loop
      v_no := v_no + 1;
      select * into it from public.inv_items where id = rl.item_id;
      insert into public.stock_doc_lines(doc_id, company_id, line_no, item_id, lot_id, qty, weight, receipt_line_id)
      values (v_id, v_company, v_no, rl.item_id, rl.lot_id, rl.qty,
              coalesce((select (x->>'weight')::numeric from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x where (x->>'receipt_line_id')::uuid = rl.id limit 1),
                       rl.weight, it.unit_weight * rl.qty), rl.id);
    end loop;
    select coalesce(sum((x->>'amount')::numeric), 0) into v_total from jsonb_array_elements(p->'meta'->'charges') x;
  else
    for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
      v_no := v_no + 1;
      select * into it from public.inv_items where id = (l->>'item_id')::uuid;
      if not found or it.company_id <> v_company then raise exception 'NUMERO: line % — item not found.', v_no using errcode = 'P0001'; end if;
      if it.status <> 'active' then raise exception 'NUMERO: line % — item % is inactive.', v_no, it.sku using errcode = 'P0001'; end if;
      v_qty := (l->>'qty')::numeric;
      if v_qty is null or v_qty = 0 or (v_kind <> 'adjustment' and v_qty < 0) then
        raise exception 'NUMERO: line % — the quantity must be greater than zero.', v_no using errcode = 'P0001';
      end if;
      v_in := v_kind in ('receipt','return_in') or (v_kind = 'adjustment' and v_qty > 0);
      if v_kind = 'adjustment' and (l->>'reason_code') is null then
        raise exception 'NUMERO: line % — state what happened to the stock: damage, expiry, theft, breakage, obsolescence, shrinkage, a difference on counting, or stock found.', v_no using errcode = 'P0001';
      end if;

      -- lot or serial number
      v_lot := null;
      if it.tracking = 'none' then
        if l->>'lot_id' is not null or coalesce(trim(l->>'lot_no'), '') <> '' then
          raise exception 'NUMERO: line % — item % is not tracked by lot or serial number.', v_no, it.sku using errcode = 'P0001';
        end if;
      else
        if l->>'lot_id' is not null then
          select * into lot from public.inv_lots where id = (l->>'lot_id')::uuid and item_id = it.id;
          if not found then raise exception 'NUMERO: line % — that lot does not belong to item %.', v_no, it.sku using errcode = 'P0001'; end if;
          v_lot := lot.id;
        elsif coalesce(trim(l->>'lot_no'), '') <> '' then
          select * into lot from public.inv_lots where item_id = it.id and lot_no = trim(l->>'lot_no');
          if found then v_lot := lot.id;
          elsif v_in then
            insert into public.inv_lots(company_id, item_id, lot_no, is_serial, mfg_date, expiry_date, supplier_party_id, import_details)
            values (v_company, it.id, trim(l->>'lot_no'), it.tracking = 'serial', (l->>'mfg_date')::date,
                    coalesce((l->>'expiry_date')::date, case when it.shelf_life_days is not null then coalesce((l->>'mfg_date')::date, v_date) + it.shelf_life_days end),
                    coalesce((p->>'party_id')::uuid, gr.party_id), coalesce(l->'import_details', '{}'::jsonb))
            returning id into v_lot;
          else
            raise exception 'NUMERO: line % — no lot "%" of item % is on record.', v_no, trim(l->>'lot_no'), it.sku using errcode = 'P0001';
          end if;
        else
          raise exception 'NUMERO: line % — item % is tracked by %: state the % number.', v_no, it.sku,
            case when it.tracking = 'serial' then 'serial number' else 'lot' end, case when it.tracking = 'serial' then 'serial' else 'lot' end using errcode = 'P0001';
        end if;
        if it.tracking = 'serial' then
          if abs(v_qty) <> 1 then raise exception 'NUMERO: line % — a serial number is one unit.', v_no using errcode = 'P0001'; end if;
          if v_in and exists (select 1 from public.inv_movements m where m.lot_id = v_lot and m.status in ('proposed','posted')
                               group by m.lot_id having sum(m.qty) > 0) then
            raise exception 'NUMERO: line % — serial number % is already in stock.', v_no, trim(coalesce(l->>'lot_no', lot.lot_no)) using errcode = 'P0001';
          end if;
        end if;
      end if;

      -- cost of what comes in
      v_cost := coalesce((l->>'unit_cost')::numeric, 0);
      src := null;
      if l->>'source_line_id' is not null then
        if gr.id is null then raise exception 'NUMERO: line % refers to a goods receipt, but the document names none.', v_no using errcode = 'P0001'; end if;
        select * into src from public.purchase_doc_lines where id = (l->>'source_line_id')::uuid and doc_id = gr.id;
        if not found then raise exception 'NUMERO: line % does not belong to goods receipt %.', v_no, gr.doc_no using errcode = 'P0001'; end if;
        if v_kind = 'receipt' then
          select coalesce(sum(sl.qty), 0) into v_done
            from public.stock_doc_lines sl join public.stock_docs sd on sd.id = sl.doc_id
           where sl.source_line_id = src.id and sd.kind = 'receipt' and sd.status in ('draft','proposed','posted') and sd.id <> v_id;
          if v_done + v_qty > src.quantity then
            raise exception 'NUMERO: line % — taking % into stock would exceed the % received on % (already taken into stock: %).', v_no, v_qty, src.quantity, gr.doc_no, v_done using errcode = 'P0001';
          end if;
          if (l->>'unit_cost') is null then v_cost := round(src.rate * gr.fx_rate, 6); end if;
        end if;
      end if;
      if v_cost < 0 then raise exception 'NUMERO: line % — the cost cannot be negative.', v_no using errcode = 'P0001'; end if;
      if v_kind in ('receipt','return_in') and (l->>'unit_cost') is null and src.id is null then
        raise exception 'NUMERO: line % — state the cost of one %.', v_no, it.unit using errcode = 'P0001';
      end if;

      if l->>'hold_id' is not null then
        select * into h from public.inv_holds where id = (l->>'hold_id')::uuid;
        if not found or h.status <> 'open' or h.item_id <> it.id or h.warehouse_id <> wh.id or h.lot_id is distinct from v_lot then
          raise exception 'NUMERO: line % — the condition noted does not match this item, lot and location, or is no longer open.', v_no using errcode = 'P0001';
        end if;
      end if;

      insert into public.stock_doc_lines(doc_id, company_id, line_no, item_id, lot_id, qty, unit_cost, value, weight, reason_code, source_line_id, hold_id, note)
      values (v_id, v_company, v_no, it.id, v_lot, v_qty, v_cost, case when v_in then round(v_qty * v_cost, 2) else 0 end,
              coalesce((l->>'weight')::numeric, it.unit_weight * abs(v_qty)), l->>'reason_code', src.id, (l->>'hold_id')::uuid, l->>'note');
      if v_in then v_total := v_total + round(v_qty * v_cost, 2); end if;
    end loop;
  end if;
  if v_no = 0 then raise exception 'NUMERO: the document needs at least one line.' using errcode = 'P0001'; end if;
  update public.stock_docs set total_value = v_total where id = v_id;
  perform numero_private.log_event(v_company, 'stock_docs', v_id, 'draft_saved', null,
    jsonb_build_object('kind', v_kind, 'lines', v_no), null);
  return v_id;
end $$;

-- Takes a quantity out of the receipts it came from (oldest first) and returns its cost.
-- Weighted average: the cost is the average of what is in stock. First in, first out: the cost of the receipts drawn from.
create or replace function numero_private.take_stock(p_item uuid, p_lot uuid, p_qty numeric, p_movement uuid) returns numeric
language plpgsql security definer set search_path = '' as $$
declare it public.inv_items; ly record; v_left numeric := p_qty; v_take numeric; v_val numeric; v_fifo numeric := 0; v_free numeric; v_cost numeric;
begin
  select * into it from public.inv_items where id = p_item for update;
  v_free := it.qty_on_hand - it.qty_reserved;
  if p_qty > v_free then
    raise exception 'NUMERO: only % % of % are free in stock (% in stock, % awaiting approval on other documents).', v_free, it.unit, it.sku, it.qty_on_hand, it.qty_reserved using errcode = 'P0001';
  end if;
  for ly in select * from public.inv_movements
             where item_id = p_item and is_layer and status = 'posted' and remaining_qty > 0 and lot_id is not distinct from p_lot
             order by move_date, created_at, id for update loop
    v_take := least(ly.remaining_qty, v_left);
    v_val := case when v_take = ly.remaining_qty then ly.remaining_value else round(ly.remaining_value * v_take / ly.remaining_qty, 2) end;
    update public.inv_movements set remaining_qty = remaining_qty - v_take, remaining_value = remaining_value - v_val where id = ly.id;
    insert into public.inv_layer_usage(company_id, movement_id, layer_id, qty, value) values (it.company_id, p_movement, ly.id, v_take, v_val);
    v_fifo := v_fifo + v_val; v_left := v_left - v_take;
    exit when v_left = 0;
  end loop;
  if v_left > 0 then
    raise exception 'NUMERO: the receipts on record for % do not cover % %. % remain unaccounted for.', it.sku, p_qty, it.unit, v_left using errcode = 'P0001';
  end if;
  if it.valuation_method = 'fifo' then
    v_cost := v_fifo;
  elsif p_qty = v_free then
    v_cost := it.value_on_hand - it.value_reserved;          -- the last of the stock takes the last of the value
  else
    v_cost := round(p_qty * (it.value_on_hand - it.value_reserved) / v_free, 2);
  end if;
  update public.inv_items set qty_reserved = qty_reserved + p_qty, value_reserved = value_reserved + v_cost where id = p_item;
  return v_cost;
end $$;

-- Gives back to the receipts what a movement had drawn from them.
create or replace function numero_private.give_back_stock(p_movement uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u record;
begin
  for u in select * from public.inv_layer_usage where movement_id = p_movement and not released for update loop
    update public.inv_movements set remaining_qty = remaining_qty + u.qty, remaining_value = remaining_value + u.value where id = u.layer_id;
    update public.inv_layer_usage set released = true where id = u.id;
  end loop;
end $$;

create or replace function numero_private.propose_stock_doc(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  d public.stock_docs; l public.stock_doc_lines; it public.inv_items; c public.inv_categories; rc public.stock_docs; ly public.inv_movements;
  v_lines jsonb := '[]'::jsonb; v_acc jsonb := '{}'::jsonb; v_key text; v_mv uuid; v_q numeric; v_cost numeric; v_unit numeric; v_have numeric;
  v_total numeric := 0; v_j uuid; v_counter uuid; v_in boolean; v_basis numeric; v_sum numeric := 0; v_alloc numeric; v_left numeric; v_charges numeric := 0;
  v_stock numeric; v_n int; v_i int := 0; k jsonb; v_what text; r record;
begin
  select * into d from public.stock_docs where id = p_id for update;
  if not found then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to propose stock documents.' using errcode = '42501';
  end if;
  if d.status not in ('draft','rejected') then raise exception 'NUMERO: this document is %.', d.status using errcode = 'P0001'; end if;
  perform numero_private.assert_not_counting(d.warehouse_id, d.count_id);
  if d.to_warehouse_id is not null then perform numero_private.assert_not_counting(d.to_warehouse_id, d.count_id); end if;
  perform numero_private.assert_period_open(d.company_id, d.doc_date);

  if d.kind = 'landed_cost' then
    select * into rc from public.stock_docs where id = d.receipt_doc_id;
    if rc.status <> 'posted' then raise exception 'NUMERO: the stock receipt is no longer posted.' using errcode = 'P0001'; end if;
    select coalesce(sum((x->>'amount')::numeric), 0) into v_charges from jsonb_array_elements(d.meta->'charges') x;
    v_charges := round(v_charges, 2);
    select count(*), coalesce(sum(case coalesce(d.meta->>'method', 'value') when 'quantity' then sl.qty when 'weight' then coalesce(sl.weight, 0)
                                  else (select rl.value from public.stock_doc_lines rl where rl.id = sl.receipt_line_id) end), 0)
      into v_n, v_sum from public.stock_doc_lines sl where sl.doc_id = d.id;
    if coalesce(d.meta->>'method', 'value') = 'weight' and exists (
         select 1 from public.stock_doc_lines sl where sl.doc_id = d.id and coalesce(sl.weight, 0) <= 0) then
      raise exception 'NUMERO: to share the cost by weight, every line needs its weight.' using errcode = 'P0001';
    end if;
    if v_sum <= 0 then raise exception 'NUMERO: the receipt carries nothing to share the cost over.' using errcode = 'P0001'; end if;
    v_left := v_charges;
    for l in select * from public.stock_doc_lines where doc_id = d.id order by line_no loop
      v_i := v_i + 1;
      select * into it from public.inv_items where id = l.item_id for update;
      select * into c from public.inv_categories where id = it.category_id;
      v_basis := case coalesce(d.meta->>'method', 'value') when 'quantity' then l.qty when 'weight' then l.weight
                   else (select rl.value from public.stock_doc_lines rl where rl.id = l.receipt_line_id) end;
      v_alloc := case when v_i = v_n then v_left else round(v_charges * v_basis / v_sum, 2) end;
      v_left := v_left - v_alloc;
      select * into ly from public.inv_movements where doc_line_id = l.receipt_line_id and is_layer and status = 'posted';
      if not found then raise exception 'NUMERO: line % of the receipt is not in the stock ledger.', l.line_no using errcode = 'P0001'; end if;
      -- the part of the receipt still in stock carries its share in stock; the part that has left is a cost now
      v_stock := case when ly.qty = 0 then 0 else round(v_alloc * ly.remaining_qty / ly.qty, 2) end;
      update public.stock_doc_lines set unit_cost = round(v_alloc / l.qty, 6), value = v_stock, expensed = v_alloc - v_stock where id = l.id;
      if v_stock <> 0 then
        insert into public.inv_movements(company_id, item_id, warehouse_id, lot_id, doc_id, doc_line_id, kind, move_date, qty, value, unit_cost)
        values (d.company_id, it.id, ly.warehouse_id, l.lot_id, d.id, l.id, 'landed_cost', d.doc_date, 0, v_stock, round(v_alloc / l.qty, 6));
        v_key := c.inventory_account_id::text || ':debit';
        v_acc := jsonb_set(v_acc, array[v_key], to_jsonb(coalesce((v_acc->>v_key)::numeric, 0) + v_stock));
      end if;
      if v_alloc - v_stock <> 0 then
        v_key := c.cogs_account_id::text || ':debit';
        v_acc := jsonb_set(v_acc, array[v_key], to_jsonb(coalesce((v_acc->>v_key)::numeric, 0) + v_alloc - v_stock));
      end if;
    end loop;
    for r in select key, value from jsonb_each_text(v_acc) loop
      v_lines := v_lines || jsonb_build_object('account_id', split_part(r.key, ':', 1), 'debit', r.value::numeric,
        'description', 'Landed cost on ' || rc.doc_no || ' — ' || (select name from public.accounts where id = split_part(r.key, ':', 1)::uuid));
    end loop;
    for k in select * from jsonb_array_elements(d.meta->'charges') loop
      v_lines := v_lines || jsonb_build_object(
        'account_id', coalesce((k->>'account_id')::uuid, numero_private.map_account(d.company_id, 'landed_cost_clearing')),
        'credit', round((k->>'amount')::numeric, 2), 'party_id', k->>'party_id', 'description', (k->>'name') || ' — ' || rc.doc_no);
    end loop;
    v_total := v_charges;
    v_what := 'Landed cost ' || d.doc_no || ' on receipt ' || rc.doc_no || ', shared by ' || coalesce(d.meta->>'method', 'value');
  else
    for l in select * from public.stock_doc_lines where doc_id = d.id order by line_no loop
      select * into it from public.inv_items where id = l.item_id for update;
      select * into c from public.inv_categories where id = it.category_id;
      v_in := d.kind in ('receipt','return_in') or (d.kind = 'adjustment' and l.qty > 0);
      v_q := abs(l.qty);
      if v_in then
        v_unit := l.unit_cost;
        if d.kind = 'adjustment' and v_unit = 0 and it.qty_on_hand > 0 then
          v_unit := round(it.value_on_hand / it.qty_on_hand, 6);       -- stock found is valued as the stock beside it
        end if;
        v_cost := round(v_q * v_unit, 2);
        insert into public.inv_movements(company_id, item_id, warehouse_id, lot_id, doc_id, doc_line_id, kind, move_date, qty, value, unit_cost, is_layer)
        values (d.company_id, it.id, d.warehouse_id, l.lot_id, d.id, l.id, d.kind, d.doc_date, v_q, v_cost, v_unit, true);
        update public.stock_doc_lines set unit_cost = v_unit, value = v_cost where id = l.id;
        v_counter := case d.kind when 'receipt' then coalesce(d.counter_account_id, numero_private.map_account(d.company_id, 'grni'))
                                 when 'return_in' then coalesce(d.counter_account_id, c.cogs_account_id)
                                 else numero_private.map_account(d.company_id, 'stock_gain') end;
        if v_cost <> 0 then
          v_key := c.inventory_account_id::text || ':debit';
          v_acc := jsonb_set(v_acc, array[v_key], to_jsonb(coalesce((v_acc->>v_key)::numeric, 0) + v_cost));
          v_key := v_counter::text || ':credit';
          v_acc := jsonb_set(v_acc, array[v_key], to_jsonb(coalesce((v_acc->>v_key)::numeric, 0) + v_cost));
        end if;
      else
        v_have := numero_private.stock_available(it.id, d.warehouse_id, l.lot_id);
        if v_q > v_have then
          raise exception 'NUMERO: line % — % % of % are asked for, and % are in this location%.', l.line_no, v_q, it.unit, it.sku, v_have,
            case when l.lot_id is not null then ' in this lot' else '' end using errcode = 'P0001';
        end if;
        if d.kind = 'transfer' then
          -- the goods change place, not value: nothing is proposed, and the receipts they came from are untouched
          v_cost := case when it.qty_on_hand = 0 then 0 else round(v_q * it.value_on_hand / it.qty_on_hand, 2) end;
          insert into public.inv_movements(company_id, item_id, warehouse_id, lot_id, doc_id, doc_line_id, kind, move_date, qty, value, unit_cost, status)
          values (d.company_id, it.id, d.warehouse_id, l.lot_id, d.id, l.id, 'transfer_out', d.doc_date, -v_q, -v_cost, case when v_q = 0 then 0 else round(v_cost / v_q, 6) end, 'posted'),
                 (d.company_id, it.id, d.to_warehouse_id, l.lot_id, d.id, l.id, 'transfer_in', d.doc_date, v_q, v_cost, case when v_q = 0 then 0 else round(v_cost / v_q, 6) end, 'posted');
          update public.stock_doc_lines set unit_cost = case when v_q = 0 then 0 else round(v_cost / v_q, 6) end, value = v_cost where id = l.id;
        else
          v_mv := gen_random_uuid();
          insert into public.inv_movements(id, company_id, item_id, warehouse_id, lot_id, doc_id, doc_line_id, kind, move_date, qty, value)
          values (v_mv, d.company_id, it.id, d.warehouse_id, l.lot_id, d.id, l.id, d.kind, d.doc_date, -v_q, 0);
          v_cost := numero_private.take_stock(it.id, l.lot_id, v_q, v_mv);
          update public.inv_movements set value = -v_cost, unit_cost = round(v_cost / v_q, 6) where id = v_mv;
          update public.stock_doc_lines set unit_cost = round(v_cost / v_q, 6), value = v_cost where id = l.id;
          v_counter := case d.kind when 'issue' then coalesce(d.counter_account_id, c.cogs_account_id)
                                   when 'return_out' then coalesce(d.counter_account_id, numero_private.map_account(d.company_id, 'grni'))
                                   else numero_private.map_account(d.company_id, 'stock_loss') end;
          if v_cost <> 0 then
            v_key := v_counter::text || ':debit';
            v_acc := jsonb_set(v_acc, array[v_key], to_jsonb(coalesce((v_acc->>v_key)::numeric, 0) + v_cost));
            v_key := c.inventory_account_id::text || ':credit';
            v_acc := jsonb_set(v_acc, array[v_key], to_jsonb(coalesce((v_acc->>v_key)::numeric, 0) + v_cost));
          end if;
        end if;
      end if;
      v_total := v_total + v_cost;
    end loop;
    for r in select key, value from jsonb_each_text(v_acc) order by split_part(key, ':', 2) desc, key loop
      v_lines := v_lines || jsonb_build_object('account_id', split_part(r.key, ':', 1), split_part(r.key, ':', 2), r.value::numeric,
        'party_id', case when (select a.control_type from public.accounts a where a.id = split_part(r.key, ':', 1)::uuid) in ('payable','receivable') then d.party_id::text end,
        'dims', case when (select a.type from public.accounts a where a.id = split_part(r.key, ':', 1)::uuid) in ('expense','income') then d.dims else '{}'::jsonb end,
        'description', initcap(replace(d.kind, '_', ' ')) || ' ' || d.doc_no || ' — ' || (select name from public.accounts where id = split_part(r.key, ':', 1)::uuid));
    end loop;
    v_what := case d.kind when 'receipt' then 'Stock received' when 'issue' then 'Stock issued' when 'return_in' then 'Stock returned by customer'
                when 'return_out' then 'Stock returned to vendor' when 'transfer' then 'Stock transferred' else 'Stock adjusted' end
              || ' ' || d.doc_no || coalesce(' — ' || nullif(trim(d.reason), ''), '');
  end if;

  update public.stock_docs set total_value = v_total where id = d.id;
  if d.kind = 'transfer' then
    update public.stock_docs set status = 'posted' where id = d.id;
    perform numero_private.log_event(d.company_id, 'stock_docs', d.id, 'transferred', null,
      jsonb_build_object('doc_no', d.doc_no, 'value', v_total, 'rule', 'A transfer inside one company changes the place of stock, not its value. No accounting entry.'), null);
    return null;
  end if;
  if jsonb_array_length(v_lines) = 0 then
    -- nothing of value moves (goods received at no cost): there is no accounting entry to approve
    perform numero_private.apply_stock_doc(d.id, 'posted', null);
    perform numero_private.log_event(d.company_id, 'stock_docs', d.id, 'posted_without_value', null,
      jsonb_build_object('doc_no', d.doc_no, 'rule', 'The document carries no value. The quantities are recorded; no accounting entry exists.'), null);
    return null;
  end if;
  v_j := numero_private.propose_posting(d.company_id, 'journal', d.doc_date, v_what, 'stock_doc', d.id, v_lines,
           jsonb_build_object('kind', d.kind, 'doc_no', d.doc_no, 'amount', v_total), 'internal');
  update public.stock_docs set status = 'proposed', journal_id = v_j where id = d.id;
  if d.count_id is not null then update public.stock_counts set status = 'proposed' where id = d.count_id; end if;
  return v_j;
end $$;

-- Brings the stock ledger and the item balances in line with what happened to the accounting entry.
create or replace function numero_private.apply_stock_doc(p_doc uuid, p_event text, p_journal uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.stock_docs; m public.inv_movements; ly public.inv_movements; l public.stock_doc_lines;
begin
  select * into d from public.stock_docs where id = p_doc for update;
  if p_event = 'posted' then
    for m in select * from public.inv_movements where doc_id = d.id and status = 'proposed' order by created_at, id for update loop
      if m.qty > 0 then
        update public.inv_items set qty_on_hand = qty_on_hand + m.qty, value_on_hand = value_on_hand + m.value where id = m.item_id;
        update public.inv_movements set status = 'posted', remaining_qty = m.qty, remaining_value = m.value where id = m.id;
      elsif m.qty < 0 then
        update public.inv_items set qty_on_hand = qty_on_hand + m.qty, value_on_hand = value_on_hand + m.value,
               qty_reserved = qty_reserved + m.qty, value_reserved = value_reserved + m.value where id = m.item_id;
        update public.inv_movements set status = 'posted' where id = m.id;
      else
        select * into l from public.stock_doc_lines where id = m.doc_line_id;
        select * into ly from public.inv_movements where doc_line_id = l.receipt_line_id and is_layer and status = 'posted' for update;
        if not found or ly.remaining_qty = 0 then
          raise exception 'NUMERO: the goods of line % have left stock since this entry was proposed. Reject it and propose the landed cost again.', l.line_no using errcode = 'P0001';
        end if;
        update public.inv_movements set remaining_value = remaining_value + m.value where id = ly.id;
        update public.inv_items set value_on_hand = value_on_hand + m.value where id = m.item_id;
        update public.inv_lots set landed_cost = coalesce(landed_cost, 0) + l.value + l.expensed where id = l.lot_id;
        update public.inv_movements set status = 'posted' where id = m.id;
      end if;
    end loop;
    update public.inv_holds h set status = 'written_off', resolved_doc_id = d.id, resolved_at = now()
      from public.stock_doc_lines sl where sl.doc_id = d.id and sl.hold_id = h.id and h.status = 'open';
    if d.kind = 'issue' and d.party_id is not null then
      update public.inv_lots lt set sold_to_party_id = d.party_id, sale_invoice_id = d.invoice_id, sold_on = d.doc_date
        from public.stock_doc_lines sl where sl.doc_id = d.id and sl.lot_id = lt.id and lt.is_serial;
    end if;
    update public.stock_docs set status = 'posted', journal_id = coalesce(p_journal, journal_id) where id = d.id;
    if d.count_id is not null then update public.stock_counts set status = 'posted' where id = d.count_id; end if;

  elsif p_event = 'voided' then
    for m in select * from public.inv_movements where doc_id = d.id and status = 'proposed' for update loop
      if m.qty < 0 then
        perform numero_private.give_back_stock(m.id);
        update public.inv_items set qty_reserved = qty_reserved + m.qty, value_reserved = value_reserved + m.value where id = m.item_id;
      end if;
      update public.inv_movements set status = 'rejected' where id = m.id;
    end loop;
    update public.stock_docs set status = 'rejected' where id = d.id;
    if d.count_id is not null then update public.stock_counts set status = 'reviewed' where id = d.count_id; end if;

  elsif p_event = 'reversed' then
    if d.kind = 'receipt' and exists (select 1 from public.stock_docs x where x.receipt_doc_id = d.id and x.kind = 'landed_cost' and x.status in ('proposed','posted')) then
      raise exception 'NUMERO: landed cost has been added to this receipt. Reverse the landed cost first.' using errcode = 'P0001';
    end if;
    for m in select * from public.inv_movements where doc_id = d.id and status = 'posted' order by created_at desc, id for update loop
      if m.qty > 0 then
        if m.remaining_qty <> m.qty then
          raise exception 'NUMERO: % of the % units received on % have since left stock or are awaiting approval on another document. The receipt cannot be reversed; return or adjust the stock instead.', m.qty - m.remaining_qty, m.qty, d.doc_no using errcode = 'P0001';
        end if;
        update public.inv_items set qty_on_hand = qty_on_hand - m.qty, value_on_hand = value_on_hand - m.value where id = m.item_id;
        update public.inv_movements set status = 'reversed', remaining_qty = 0, remaining_value = 0 where id = m.id;
      elsif m.qty < 0 then
        perform numero_private.give_back_stock(m.id);
        update public.inv_items set qty_on_hand = qty_on_hand - m.qty, value_on_hand = value_on_hand - m.value where id = m.item_id;
        update public.inv_movements set status = 'reversed' where id = m.id;
      else
        select * into l from public.stock_doc_lines where id = m.doc_line_id;
        select * into ly from public.inv_movements where doc_line_id = l.receipt_line_id and is_layer for update;
        if ly.remaining_value < m.value or ly.remaining_qty = 0 then
          raise exception 'NUMERO: goods that carried this landed cost have since left stock. It cannot be reversed; record an adjustment instead.' using errcode = 'P0001';
        end if;
        update public.inv_movements set remaining_value = remaining_value - m.value where id = ly.id;
        update public.inv_items set value_on_hand = value_on_hand - m.value where id = m.item_id;
        update public.inv_lots set landed_cost = nullif(coalesce(landed_cost, 0) - l.value - l.expensed, 0) where id = l.lot_id;
        update public.inv_movements set status = 'reversed' where id = m.id;
      end if;
    end loop;
    update public.inv_holds set status = 'open', resolved_doc_id = null, resolved_at = null where resolved_doc_id = d.id and status = 'written_off';
    update public.stock_docs set status = 'reversed' where id = d.id;
    if d.count_id is not null then update public.stock_counts set status = 'reviewed', doc_id = null where id = d.count_id; end if;
  end if;
end $$;

create or replace function numero_private.wf_stock_doc(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform numero_private.apply_stock_doc(w.source_id, p_event, w.journal_id);
end $$;

create or replace function numero_private.cancel_stock_doc(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.stock_docs;
begin
  select * into d from public.stock_docs where id = p_id for update;
  if not found then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'inventory.manage') then
    raise exception 'NUMERO: you are not authorised to cancel stock documents.' using errcode = '42501';
  end if;
  if d.status not in ('draft','rejected') then
    raise exception 'NUMERO: a document that is % cannot be cancelled. Reject its accounting entry, or reverse it.', d.status using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'NUMERO: a reason is required.' using errcode = 'P0001'; end if;
  perform set_config('numero.reason', p_reason, true);
  update public.stock_docs set status = 'cancelled' where id = p_id;
  if d.count_id is not null then update public.stock_counts set status = 'reviewed', doc_id = null where id = d.count_id; end if;
end $$;

-- Quantity in each place, from the stock ledger. Row Level Security of the stock ledger applies.
create or replace function public.stock_on_hand(p_companies uuid[])
returns table (company_id uuid, item_id uuid, warehouse_id uuid, lot_id uuid, qty numeric, pending_out numeric, pending_in numeric, last_in date, last_out date)
language sql stable set search_path = '' as $$
  select m.company_id, m.item_id, m.warehouse_id, m.lot_id,
         coalesce(sum(m.qty) filter (where m.status = 'posted'), 0),
         coalesce(-sum(m.qty) filter (where m.status = 'proposed' and m.qty < 0), 0),
         coalesce(sum(m.qty) filter (where m.status = 'proposed' and m.qty > 0), 0),
         max(m.move_date) filter (where m.status = 'posted' and m.qty > 0),
         max(m.move_date) filter (where m.status = 'posted' and m.qty < 0 and m.kind <> 'transfer_out')
    from public.inv_movements m
   where m.company_id = any(p_companies) and m.status in ('proposed','posted')
   group by m.company_id, m.item_id, m.warehouse_id, m.lot_id
  having coalesce(sum(m.qty) filter (where m.status = 'posted'), 0) <> 0
      or coalesce(sum(m.qty) filter (where m.status = 'proposed'), 0) <> 0;
$$;

create or replace function public.save_stock_doc(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_stock_doc(p); $$;
create or replace function public.propose_stock_doc(p_id uuid) returns uuid language sql set search_path = '' as $$ select numero_private.propose_stock_doc(p_id); $$;
create or replace function public.cancel_stock_doc(p_id uuid, p_reason text) returns void language sql set search_path = '' as $$ select numero_private.cancel_stock_doc(p_id, p_reason); $$;

insert into numero_private.internal_functions(name) values
  ('assert_not_counting'), ('take_stock'), ('give_back_stock'), ('apply_stock_doc')
on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927125138 · p3_05_stock_counts
-- =====================================================================
-- INVENTORY — PHYSICAL STOCK COUNT (spec 568, 570, 1387)
-- Freeze / snapshot → count → difference → review → approved adjustment.
-- The count never changes the books. The adjustment is a stock document
-- whose accounting entry is proposed and approved like any other.
-- =====================================================================

-- A rejected document may be edited and proposed again: its rejected movements keep their rows and let go of the lines.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'save_stock_doc';
  if position('set doc_line_id = null' in v_def) = 0 then
    v_new := replace(v_def,
      '    delete from public.stock_doc_lines where doc_id = v_id;',
      '    update public.inv_movements set doc_line_id = null where doc_id = v_id and status = ''rejected'';' || chr(10) ||
      '    delete from public.stock_doc_lines where doc_id = v_id;');
    if v_new = v_def then raise exception 'NUMERO: save_stock_doc could not be corrected.'; end if;
    execute v_new;
  end if;
end $$;

create or replace function numero_private.create_stock_count(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; wh public.warehouses; v_id uuid; v_date date := coalesce((p->>'count_date')::date, current_date);
        v_frozen boolean := coalesce((p->>'frozen')::boolean, true); v_n int;
begin
  if not (numero_private.can(v_company, 'inventory.manage') or numero_private.can(v_company, 'inventory.approve')) then
    raise exception 'NUMERO: you are not authorised to open a stock count.' using errcode = '42501';
  end if;
  select * into wh from public.warehouses where id = (p->>'warehouse_id')::uuid;
  if not found or wh.company_id <> v_company or not wh.is_active then
    raise exception 'NUMERO: choose an active location of this company.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.stock_counts c where c.warehouse_id = wh.id and c.status in ('open','counted','reviewed','proposed')) then
    raise exception 'NUMERO: a stock count is already open for this location.' using errcode = 'P0001';
  end if;
  if v_frozen and exists (select 1 from public.inv_movements m where m.warehouse_id = wh.id and m.status = 'proposed') then
    raise exception 'NUMERO: stock documents for this location are awaiting approval. Approve or reject them before the stock is frozen for counting.' using errcode = 'P0001';
  end if;
  if p->>'category_id' is not null and not exists (
       select 1 from public.inv_categories c where c.id = (p->>'category_id')::uuid and c.company_id = v_company) then
    raise exception 'NUMERO: category not found.' using errcode = 'P0001';
  end if;
  insert into public.stock_counts(company_id, warehouse_id, count_no, count_date, frozen, scope, note)
  values (v_company, wh.id, numero_private.next_doc_no(v_company, 'stock_count', 'SC', v_date), v_date, v_frozen,
          jsonb_strip_nulls(jsonb_build_object('category_id', p->>'category_id')), p->>'note')
  returning id into v_id;
  -- the snapshot: what the books say is in this location now
  insert into public.stock_count_lines(count_id, company_id, item_id, lot_id, book_qty, unit_cost)
  select v_id, v_company, m.item_id, m.lot_id, sum(m.qty),
         case when i.qty_on_hand = 0 then 0 else round(i.value_on_hand / i.qty_on_hand, 6) end
    from public.inv_movements m join public.inv_items i on i.id = m.item_id
   where m.warehouse_id = wh.id and m.status = 'posted'
     and (p->>'category_id' is null or i.category_id = (p->>'category_id')::uuid)
   group by m.item_id, m.lot_id, i.qty_on_hand, i.value_on_hand
  having sum(m.qty) <> 0;
  get diagnostics v_n = row_count;
  perform numero_private.log_event(v_company, 'stock_counts', v_id, 'opened', null,
    jsonb_build_object('location', wh.code, 'lines', v_n, 'frozen', v_frozen,
      'rule', 'The count records what is found. It changes nothing in the books.'), null);
  return v_id;
end $$;

-- Records what was counted. A line may be added for stock that is found but is not in the books for this location.
create or replace function numero_private.record_stock_count(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.stock_counts; l jsonb; v_line uuid; it public.inv_items; v_lot uuid; v_qty numeric; v_open int;
begin
  select * into c from public.stock_counts where id = (p->>'count_id')::uuid for update;
  if not found then raise exception 'NUMERO: stock count not found.' using errcode = 'P0001'; end if;
  if not (numero_private.can(c.company_id, 'inventory.count') or numero_private.can(c.company_id, 'inventory.manage')) then
    raise exception 'NUMERO: you are not authorised to record a stock count.' using errcode = '42501';
  end if;
  if c.status not in ('open','counted') then
    raise exception 'NUMERO: this count is %. Quantities can no longer be changed.', c.status using errcode = 'P0001';
  end if;
  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_qty := (l->>'counted_qty')::numeric;
    if v_qty is not null and v_qty < 0 then raise exception 'NUMERO: a counted quantity cannot be negative.' using errcode = 'P0001'; end if;
    if l->>'id' is not null then
      update public.stock_count_lines set counted_qty = v_qty, reason_code = l->>'reason_code', note = l->>'note'
       where id = (l->>'id')::uuid and count_id = c.id returning id into v_line;
      if v_line is null then raise exception 'NUMERO: a line does not belong to this count.' using errcode = 'P0001'; end if;
    else
      select * into it from public.inv_items where id = (l->>'item_id')::uuid;
      if not found or it.company_id <> c.company_id then raise exception 'NUMERO: item not found.' using errcode = 'P0001'; end if;
      v_lot := (l->>'lot_id')::uuid;
      if v_lot is null and coalesce(trim(l->>'lot_no'), '') <> '' then
        select id into v_lot from public.inv_lots where item_id = it.id and lot_no = trim(l->>'lot_no');
        if v_lot is null then
          insert into public.inv_lots(company_id, item_id, lot_no, is_serial, expiry_date)
          values (c.company_id, it.id, trim(l->>'lot_no'), it.tracking = 'serial', (l->>'expiry_date')::date) returning id into v_lot;
        end if;
      end if;
      if it.tracking <> 'none' and v_lot is null then
        raise exception 'NUMERO: item % is tracked by lot or serial number: state which was found.', it.sku using errcode = 'P0001';
      end if;
      if it.tracking = 'none' and v_lot is not null then
        raise exception 'NUMERO: item % is not tracked by lot or serial number.', it.sku using errcode = 'P0001';
      end if;
      insert into public.stock_count_lines(count_id, company_id, item_id, lot_id, book_qty, unit_cost, counted_qty, reason_code, note, added_in_count)
      values (c.id, c.company_id, it.id, v_lot, 0, case when it.qty_on_hand = 0 then coalesce((l->>'unit_cost')::numeric, 0) else round(it.value_on_hand / it.qty_on_hand, 6) end,
              v_qty, coalesce(l->>'reason_code', 'found'), l->>'note', true)
      on conflict (count_id, item_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
      do update set counted_qty = excluded.counted_qty, reason_code = excluded.reason_code, note = excluded.note;
    end if;
  end loop;
  select count(*) into v_open from public.stock_count_lines where count_id = c.id and counted_qty is null;
  if v_open = 0 and coalesce((p->>'complete')::boolean, true) then
    update public.stock_counts set status = 'counted', counted_by = (select auth.uid()), counted_at = now() where id = c.id;
    return 'counted';
  end if;
  update public.stock_counts set status = 'open' where id = c.id and status <> 'open';
  return 'open';
end $$;

-- The review is by a second person. A difference needs its reason before it can pass.
create or replace function numero_private.review_stock_count(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.stock_counts; v_n int;
begin
  select * into c from public.stock_counts where id = p_id for update;
  if not found then raise exception 'NUMERO: stock count not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(c.company_id, 'inventory.approve') then
    raise exception 'NUMERO: you are not authorised to review a stock count.' using errcode = '42501';
  end if;
  if c.status <> 'counted' then raise exception 'NUMERO: only a completed count can be reviewed. This count is %.', c.status using errcode = 'P0001'; end if;
  if p_decision not in ('reviewed','recount') then raise exception 'NUMERO: the decision is reviewed or recount.' using errcode = 'P0001'; end if;
  perform numero_private.check_maker_checker(c.company_id, c.counted_by, 'stock count');
  if p_decision = 'recount' then
    if coalesce(trim(p_note), '') = '' then raise exception 'NUMERO: say why the stock must be counted again.' using errcode = 'P0001'; end if;
    update public.stock_counts set status = 'open', review_note = p_note, reviewed_by = (select auth.uid()), reviewed_at = now() where id = p_id;
    perform numero_private.log_event(c.company_id, 'stock_counts', p_id, 'recount_asked', null, jsonb_build_object('count_no', c.count_no), p_note);
    return;
  end if;
  select count(*) into v_n from public.stock_count_lines where count_id = p_id and counted_qty <> book_qty and reason_code is null;
  if v_n > 0 then
    raise exception 'NUMERO: % line(s) differ from the books and carry no reason. A difference is adjusted only with its reason.', v_n using errcode = 'P0001';
  end if;
  update public.stock_counts set status = 'reviewed', review_note = p_note, reviewed_by = (select auth.uid()), reviewed_at = now() where id = p_id;
  perform numero_private.log_event(c.company_id, 'stock_counts', p_id, 'reviewed', null, jsonb_build_object('count_no', c.count_no), p_note);
end $$;

-- Turns the reviewed differences into one adjustment and proposes its accounting entry.
-- Returns the proposed journal, or null when the count agrees with the books.
create or replace function numero_private.propose_stock_count(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.stock_counts; l public.stock_count_lines; v_doc uuid; v_no int := 0; v_j uuid;
begin
  select * into c from public.stock_counts where id = p_id for update;
  if not found then raise exception 'NUMERO: stock count not found.' using errcode = 'P0001'; end if;
  if not (numero_private.can(c.company_id, 'inventory.manage') or numero_private.can(c.company_id, 'inventory.approve')) then
    raise exception 'NUMERO: you are not authorised to propose the adjustment of a stock count.' using errcode = '42501';
  end if;
  if c.status <> 'reviewed' then raise exception 'NUMERO: the count must be reviewed before its differences are adjusted. It is %.', c.status using errcode = 'P0001'; end if;
  if not exists (select 1 from public.stock_count_lines where count_id = p_id and counted_qty <> book_qty) then
    update public.stock_counts set status = 'closed' where id = p_id;
    perform numero_private.log_event(c.company_id, 'stock_counts', p_id, 'closed_without_difference', null,
      jsonb_build_object('count_no', c.count_no, 'rule', 'What was counted agrees with the books. Nothing is adjusted.'), null);
    return null;
  end if;
  insert into public.stock_docs(company_id, kind, doc_no, doc_date, warehouse_id, count_id, reason)
  values (c.company_id, 'adjustment', numero_private.next_doc_no(c.company_id, 'stock_adjustment', 'SA', c.count_date), c.count_date,
          c.warehouse_id, c.id, 'Differences found by stock count ' || c.count_no)
  returning id into v_doc;
  for l in select * from public.stock_count_lines where count_id = p_id and counted_qty <> book_qty order by id loop
    v_no := v_no + 1;
    insert into public.stock_doc_lines(doc_id, company_id, line_no, item_id, lot_id, qty, unit_cost, reason_code, note)
    values (v_doc, c.company_id, v_no, l.item_id, l.lot_id, l.counted_qty - l.book_qty,
            case when l.counted_qty > l.book_qty then l.unit_cost else 0 end, l.reason_code, l.note);
  end loop;
  update public.stock_counts set doc_id = v_doc where id = p_id;
  v_j := numero_private.propose_stock_doc(v_doc);
  return v_j;
end $$;

create or replace function numero_private.cancel_stock_count(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.stock_counts;
begin
  select * into c from public.stock_counts where id = p_id for update;
  if not found then raise exception 'NUMERO: stock count not found.' using errcode = 'P0001'; end if;
  if not (numero_private.can(c.company_id, 'inventory.manage') or numero_private.can(c.company_id, 'inventory.approve')) then
    raise exception 'NUMERO: you are not authorised to cancel a stock count.' using errcode = '42501';
  end if;
  if c.status not in ('open','counted','reviewed') then
    raise exception 'NUMERO: a count that is % cannot be cancelled.', c.status using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'NUMERO: a reason is required.' using errcode = 'P0001'; end if;
  perform set_config('numero.reason', p_reason, true);
  update public.stock_counts set status = 'cancelled' where id = p_id;
end $$;

create or replace function public.create_stock_count(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.create_stock_count(p); $$;
create or replace function public.record_stock_count(p jsonb) returns text language sql set search_path = '' as $$ select numero_private.record_stock_count(p); $$;
create or replace function public.review_stock_count(p_id uuid, p_decision text, p_note text default null) returns void language sql set search_path = '' as $$ select numero_private.review_stock_count(p_id, p_decision, p_note); $$;
create or replace function public.propose_stock_count(p_id uuid) returns uuid language sql set search_path = '' as $$ select numero_private.propose_stock_count(p_id); $$;
create or replace function public.cancel_stock_count(p_id uuid, p_reason text) returns void language sql set search_path = '' as $$ select numero_private.cancel_stock_count(p_id, p_reason); $$;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();
