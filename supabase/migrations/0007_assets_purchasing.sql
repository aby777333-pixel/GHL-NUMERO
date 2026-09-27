-- >>> applied as migration 20260927072803 · p2_07_fixed_assets_depreciation
-- =====================================================================
-- GHL NUMERO · 0007 · FIXED ASSETS & DEPRECIATION, PURCHASE-TO-PAY,
--                     COMMITMENTS, CREDIT CONTROL
-- Spec: 23, 447-448, 521-529, 531, 574-575, 672, 1386
-- Additive only.
-- =====================================================================

create or replace function numero_private.next_doc_no(p_company uuid, p_type text, p_prefix text, p_date date) returns text
language plpgsql security definer set search_path = '' as $$
declare v_fy int; v_no bigint;
begin
  v_fy := numero_private.fiscal_year(p_company, coalesce(p_date, current_date));
  insert into public.doc_sequences(company_id, doc_type, fy, last_no) values (p_company, p_type, v_fy, 1)
  on conflict (company_id, doc_type, fy) do update set last_no = public.doc_sequences.last_no + 1
  returning last_no into v_no;
  return p_prefix || '-' || v_fy::text || '-' || lpad(v_no::text, 6, '0');
end $$;

-- =====================================================================
-- 1. FIXED ASSETS
-- =====================================================================
create table public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  asset_account_id uuid not null references public.accounts(id),
  accum_account_id uuid not null references public.accounts(id),
  expense_account_id uuid not null references public.accounts(id),
  method text not null default 'slm' check (method in ('slm','wdv','none')),
  life_months int check (life_months is null or life_months > 0),
  wdv_rate numeric(9,4) check (wdv_rate is null or (wdv_rate > 0 and wdv_rate <= 100)),
  salvage_pct numeric(9,4) not null default 0 check (salvage_pct >= 0 and salvage_pct < 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (company_id, name)
);

create table public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  asset_no text not null,
  name text not null,
  category_id uuid not null references public.asset_categories(id),
  description text,
  acquisition_date date not null,
  in_service_date date,
  cost numeric(20,4) not null check (cost > 0),
  salvage_value numeric(20,4) not null default 0 check (salvage_value >= 0),
  method text not null check (method in ('slm','wdv','none')),
  life_months int,
  wdv_rate numeric(9,4),
  opening_accumulated numeric(20,4) not null default 0 check (opening_accumulated >= 0),
  accumulated_depreciation numeric(20,4) not null default 0 check (accumulated_depreciation >= 0),
  impairment numeric(20,4) not null default 0,
  org_unit_id uuid references public.org_units(id),
  custodian_party_id uuid references public.parties(id),
  location text,
  serial_no text,
  tag_code text,
  vendor_party_id uuid references public.parties(id),
  source_invoice_id uuid references public.invoices(id),
  warranty_until date,
  status text not null default 'active' check (status in ('active','disposed','written_off')),
  disposed_on date,
  disposal_proceeds numeric(20,4),
  disposal_journal_id uuid references public.journals(id),
  confidentiality text not null default 'internal',
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, asset_no),
  check (salvage_value < cost)
);
create index fixed_assets_company_idx on public.fixed_assets(company_id, status);

create table public.depreciation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  period_month date not null,
  status text not null default 'draft' check (status in ('draft','proposed','posted','reversed','cancelled')),
  total numeric(20,4) not null default 0,
  asset_count int not null default 0,
  journal_id uuid references public.journals(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index depreciation_runs_live on public.depreciation_runs(company_id, period_month)
  where status in ('draft','proposed','posted');

create table public.depreciation_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.depreciation_runs(id),
  company_id uuid not null references public.companies(id),
  asset_id uuid not null references public.fixed_assets(id),
  amount numeric(20,4) not null check (amount > 0),
  opening_book_value numeric(20,4) not null,
  method text not null,
  basis text not null,
  unique (run_id, asset_id)
);
create index depreciation_lines_asset_idx on public.depreciation_lines(asset_id);

create table public.asset_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.fixed_assets(id),
  company_id uuid not null references public.companies(id),
  event_type text not null check (event_type in ('assignment','transfer','maintenance','verification','impairment','disposal','note')),
  event_date date not null,
  amount numeric(20,4),
  status text not null default 'recorded' check (status in ('recorded','proposed','posted','rejected','reversed')),
  detail jsonb not null default '{}'::jsonb,
  journal_id uuid references public.journals(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index asset_events_asset_idx on public.asset_events(asset_id, event_date desc);

create or replace function numero_private.save_asset_category(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; k text; a public.accounts; v_method text := coalesce(p->>'method', 'slm');
begin
  if not numero_private.can(v_company, 'asset.manage') then
    raise exception 'NUMERO: you are not authorised to configure asset categories.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: the category needs a name.' using errcode = 'P0001'; end if;
  foreach k in array array['asset_account_id','accum_account_id','expense_account_id'] loop
    select * into a from public.accounts where id = (p->>k)::uuid;
    if not found or a.company_id <> v_company or a.is_group or not a.is_active then
      raise exception 'NUMERO: choose active posting accounts of this company for the asset, accumulated depreciation and depreciation expense.' using errcode = 'P0001';
    end if;
  end loop;
  if v_method = 'slm' and coalesce((p->>'life_months')::int, 0) <= 0 then
    raise exception 'NUMERO: straight-line depreciation needs a useful life in months.' using errcode = 'P0001';
  end if;
  if v_method = 'wdv' and coalesce((p->>'wdv_rate')::numeric, 0) <= 0 then
    raise exception 'NUMERO: written-down-value depreciation needs an annual rate.' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.asset_categories(company_id, name, asset_account_id, accum_account_id, expense_account_id, method, life_months, wdv_rate, salvage_pct)
    values (v_company, trim(p->>'name'), (p->>'asset_account_id')::uuid, (p->>'accum_account_id')::uuid, (p->>'expense_account_id')::uuid,
            v_method, (p->>'life_months')::int, (p->>'wdv_rate')::numeric, coalesce((p->>'salvage_pct')::numeric, 0))
    returning id into v_id;
  else
    update public.asset_categories set name = trim(p->>'name'), asset_account_id = (p->>'asset_account_id')::uuid,
      accum_account_id = (p->>'accum_account_id')::uuid, expense_account_id = (p->>'expense_account_id')::uuid,
      method = v_method, life_months = (p->>'life_months')::int, wdv_rate = (p->>'wdv_rate')::numeric,
      salvage_pct = coalesce((p->>'salvage_pct')::numeric, 0), is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id and company_id = v_company;
    if not found then raise exception 'NUMERO: category not found.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function numero_private.save_asset(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_gid uuid;
  c public.asset_categories; fa public.fixed_assets; v_cost numeric; v_salvage numeric; v_method text; v_life int; v_rate numeric;
  v_open numeric; v_depreciated boolean;
begin
  if not numero_private.can(v_company, 'asset.manage') then
    raise exception 'NUMERO: you are not authorised to maintain the asset register.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: the asset needs a name.' using errcode = 'P0001'; end if;
  select * into c from public.asset_categories where id = (p->>'category_id')::uuid and company_id = v_company;
  if not found then raise exception 'NUMERO: choose an asset category of this company.' using errcode = 'P0001'; end if;
  if (p->>'acquisition_date') is null then raise exception 'NUMERO: the acquisition date is required.' using errcode = 'P0001'; end if;
  if p->>'org_unit_id' is not null and not exists (
       select 1 from public.org_units u where u.id = (p->>'org_unit_id')::uuid and u.company_id = v_company) then
    raise exception 'NUMERO: the selected dimension belongs to another company.' using errcode = 'P0001';
  end if;
  if (p->>'custodian_party_id' is not null and not exists (select 1 from public.parties x where x.id = (p->>'custodian_party_id')::uuid and x.group_id = v_gid))
     or (p->>'vendor_party_id' is not null and not exists (select 1 from public.parties x where x.id = (p->>'vendor_party_id')::uuid and x.group_id = v_gid)) then
    raise exception 'NUMERO: unknown party.' using errcode = 'P0001';
  end if;

  v_cost := round((p->>'cost')::numeric, 2);
  if v_cost is null or v_cost <= 0 then raise exception 'NUMERO: the cost must be greater than zero.' using errcode = 'P0001'; end if;
  v_salvage := round(coalesce((p->>'salvage_value')::numeric, v_cost * c.salvage_pct / 100), 2);
  v_method := coalesce(p->>'method', c.method);
  v_life := coalesce((p->>'life_months')::int, c.life_months);
  v_rate := coalesce((p->>'wdv_rate')::numeric, c.wdv_rate);
  v_open := round(coalesce((p->>'opening_accumulated')::numeric, 0), 2);
  if v_salvage >= v_cost then raise exception 'NUMERO: the residual value must be lower than the cost.' using errcode = 'P0001'; end if;
  if v_open > v_cost - v_salvage then raise exception 'NUMERO: opening accumulated depreciation exceeds the depreciable amount.' using errcode = 'P0001'; end if;
  if v_method = 'slm' and coalesce(v_life, 0) <= 0 then raise exception 'NUMERO: straight-line depreciation needs a useful life in months.' using errcode = 'P0001'; end if;
  if v_method = 'wdv' and coalesce(v_rate, 0) <= 0 then raise exception 'NUMERO: written-down-value depreciation needs an annual rate.' using errcode = 'P0001'; end if;

  if v_id is null then
    insert into public.fixed_assets(company_id, asset_no, name, category_id, description, acquisition_date, in_service_date, cost,
      salvage_value, method, life_months, wdv_rate, opening_accumulated, accumulated_depreciation, org_unit_id, custodian_party_id,
      location, serial_no, tag_code, vendor_party_id, source_invoice_id, warranty_until, confidentiality, notes, created_by)
    values (v_company, numero_private.next_doc_no(v_company, 'fixed_asset', 'FA', (p->>'acquisition_date')::date), trim(p->>'name'), c.id,
      p->>'description', (p->>'acquisition_date')::date, coalesce((p->>'in_service_date')::date, (p->>'acquisition_date')::date), v_cost,
      v_salvage, v_method, v_life, v_rate, v_open, v_open, (p->>'org_unit_id')::uuid, (p->>'custodian_party_id')::uuid,
      p->>'location', p->>'serial_no', p->>'tag_code', (p->>'vendor_party_id')::uuid, (p->>'source_invoice_id')::uuid,
      (p->>'warranty_until')::date, coalesce(p->>'confidentiality', 'internal'), p->>'notes', (select auth.uid()))
    returning id into v_id;
    update public.fixed_assets set tag_code = coalesce(nullif(tag_code, ''), 'NUMERO-ASSET:' || asset_no) where id = v_id;
    return v_id;
  end if;

  select * into fa from public.fixed_assets where id = v_id and company_id = v_company for update;
  if not found then raise exception 'NUMERO: asset not found.' using errcode = 'P0001'; end if;
  if fa.status <> 'active' then raise exception 'NUMERO: this asset is % and can no longer be edited.', fa.status using errcode = 'P0001'; end if;
  v_depreciated := exists (select 1 from public.depreciation_lines l join public.depreciation_runs r on r.id = l.run_id
                            where l.asset_id = v_id and r.status in ('proposed','posted'));
  if v_depreciated and (v_cost <> fa.cost or v_salvage <> fa.salvage_value or v_method <> fa.method
       or coalesce(v_life, 0) <> coalesce(fa.life_months, 0) or coalesce(v_rate, 0) <> coalesce(fa.wdv_rate, 0)
       or v_open <> fa.opening_accumulated or c.id <> fa.category_id
       or (p->>'acquisition_date')::date <> fa.acquisition_date
       or coalesce((p->>'in_service_date')::date, fa.in_service_date) <> fa.in_service_date) then
    raise exception 'NUMERO: depreciation has already been recorded for this asset. Its cost, dates, category and method can no longer be changed.' using errcode = 'P0001';
  end if;
  update public.fixed_assets set name = trim(p->>'name'), category_id = c.id, description = p->>'description',
    acquisition_date = (p->>'acquisition_date')::date,
    in_service_date = coalesce((p->>'in_service_date')::date, in_service_date),
    cost = v_cost, salvage_value = v_salvage, method = v_method, life_months = v_life, wdv_rate = v_rate,
    opening_accumulated = v_open,
    accumulated_depreciation = accumulated_depreciation - fa.opening_accumulated + v_open,
    org_unit_id = (p->>'org_unit_id')::uuid, custodian_party_id = (p->>'custodian_party_id')::uuid,
    location = p->>'location', serial_no = p->>'serial_no', tag_code = coalesce(nullif(p->>'tag_code', ''), tag_code),
    vendor_party_id = (p->>'vendor_party_id')::uuid, source_invoice_id = (p->>'source_invoice_id')::uuid,
    warranty_until = (p->>'warranty_until')::date, confidentiality = coalesce(p->>'confidentiality', confidentiality),
    notes = p->>'notes'
  where id = v_id;
  return v_id;
end $$;

-- Calculates one month of depreciation for every asset in service. Nothing is posted here.
create or replace function numero_private.create_depreciation_run(p_company uuid, p_month date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_days int; v_run uuid; a public.fixed_assets; v_left numeric; v_amt numeric; v_factor numeric; v_total numeric := 0; n int := 0;
  v_basis text; v_pending date;
begin
  if not numero_private.can(p_company, 'asset.manage') then
    raise exception 'NUMERO: you are not authorised to run depreciation.' using errcode = '42501';
  end if;
  if p_month is null then raise exception 'NUMERO: choose the month to depreciate.' using errcode = 'P0001'; end if;
  perform numero_private.assert_period_open(p_company, v_end);
  if exists (select 1 from public.depreciation_runs r where r.company_id = p_company and r.period_month = v_start
                and r.status in ('draft','proposed','posted')) then
    raise exception 'NUMERO: a depreciation run for % already exists.', to_char(v_start, 'Mon YYYY') using errcode = 'P0001';
  end if;
  select min(r.period_month) into v_pending from public.depreciation_runs r
   where r.company_id = p_company and r.status in ('draft','proposed') and r.period_month < v_start;
  if v_pending is not null then
    raise exception 'NUMERO: the depreciation run for % is not posted yet. Finish or cancel it first so that book values are correct.', to_char(v_pending, 'Mon YYYY') using errcode = 'P0001';
  end if;
  if exists (select 1 from public.depreciation_runs r where r.company_id = p_company and r.status in ('proposed','posted') and r.period_month > v_start) then
    raise exception 'NUMERO: a later month has already been depreciated. Months must be run in order.' using errcode = 'P0001';
  end if;

  v_days := v_end - v_start + 1;
  insert into public.depreciation_runs(company_id, period_month, created_by) values (p_company, v_start, (select auth.uid()))
  returning id into v_run;

  for a in select * from public.fixed_assets f
            where f.company_id = p_company and f.status = 'active' and f.method <> 'none'
              and coalesce(f.in_service_date, f.acquisition_date) <= v_end
            order by f.asset_no loop
    v_left := a.cost - a.salvage_value - a.accumulated_depreciation;
    if v_left <= 0 then continue; end if;
    v_factor := 1;
    if coalesce(a.in_service_date, a.acquisition_date) > v_start then
      v_factor := (v_end - coalesce(a.in_service_date, a.acquisition_date) + 1)::numeric / v_days;
    end if;
    if a.method = 'slm' then
      v_amt := (a.cost - a.salvage_value) / a.life_months * v_factor;
      v_basis := 'Straight line: (' || a.cost || ' − ' || a.salvage_value || ') ÷ ' || a.life_months || ' months'
                 || case when v_factor < 1 then ' × ' || round(v_factor, 4) || ' (part month)' else '' end;
    else
      v_amt := (a.cost - a.accumulated_depreciation) * a.wdv_rate / 100 / 12 * v_factor;
      v_basis := 'Written down value: ' || (a.cost - a.accumulated_depreciation) || ' × ' || a.wdv_rate || '% ÷ 12'
                 || case when v_factor < 1 then ' × ' || round(v_factor, 4) || ' (part month)' else '' end;
    end if;
    v_amt := round(least(v_amt, v_left), 2);
    if v_amt <= 0 then continue; end if;
    insert into public.depreciation_lines(run_id, company_id, asset_id, amount, opening_book_value, method, basis)
    values (v_run, p_company, a.id, v_amt, a.cost - a.accumulated_depreciation, a.method, v_basis);
    v_total := v_total + v_amt; n := n + 1;
  end loop;

  update public.depreciation_runs set total = v_total, asset_count = n where id = v_run;
  perform numero_private.log_event(p_company, 'depreciation_runs', v_run, 'calculated', null,
    jsonb_build_object('month', v_start, 'assets', n, 'total', v_total), null);
  return v_run;
end $$;

create or replace function numero_private.propose_depreciation_run(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.depreciation_runs; v_lines jsonb := '[]'::jsonb; g record; v_j uuid; v_end date;
begin
  select * into r from public.depreciation_runs where id = p_id for update;
  if not found then raise exception 'NUMERO: depreciation run not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(r.company_id, 'asset.manage') then
    raise exception 'NUMERO: you are not authorised to run depreciation.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then raise exception 'NUMERO: this run is %.', r.status using errcode = 'P0001'; end if;
  if r.total <= 0 then raise exception 'NUMERO: there is nothing to depreciate in this month.' using errcode = 'P0001'; end if;
  v_end := (r.period_month + interval '1 month - 1 day')::date;

  for g in
    select c.expense_account_id, c.accum_account_id, f.org_unit_id, u.type_key, sum(l.amount) as amount, count(*) as n
      from public.depreciation_lines l
      join public.fixed_assets f on f.id = l.asset_id
      join public.asset_categories c on c.id = f.category_id
      left join public.org_units u on u.id = f.org_unit_id
     where l.run_id = p_id
     group by 1, 2, 3, 4 order by 1, 2
  loop
    v_lines := v_lines || jsonb_build_object('account_id', g.expense_account_id, 'debit', g.amount,
      'description', 'Depreciation ' || to_char(r.period_month, 'Mon YYYY') || ' · ' || g.n || ' asset(s)',
      'dims', case when g.org_unit_id is null then '{}'::jsonb else jsonb_build_object(g.type_key, g.org_unit_id) end);
  end loop;
  for g in
    select c.accum_account_id, sum(l.amount) as amount
      from public.depreciation_lines l
      join public.fixed_assets f on f.id = l.asset_id
      join public.asset_categories c on c.id = f.category_id
     where l.run_id = p_id group by 1 order by 1
  loop
    v_lines := v_lines || jsonb_build_object('account_id', g.accum_account_id, 'credit', g.amount,
      'description', 'Accumulated depreciation ' || to_char(r.period_month, 'Mon YYYY'));
  end loop;

  v_j := numero_private.propose_posting(r.company_id, 'depreciation', v_end,
    'Depreciation for ' || to_char(r.period_month, 'Mon YYYY'), 'depreciation', r.id, v_lines,
    jsonb_build_object('month', r.period_month, 'total', r.total));
  update public.depreciation_runs set status = 'proposed', journal_id = v_j where id = p_id;
  return v_j;
end $$;

create or replace function numero_private.cancel_depreciation_run(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.depreciation_runs;
begin
  select * into r from public.depreciation_runs where id = p_id for update;
  if not found then raise exception 'NUMERO: depreciation run not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(r.company_id, 'asset.manage') then
    raise exception 'NUMERO: you are not authorised to run depreciation.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'NUMERO: only a draft run can be cancelled. Reject or reverse its journal instead.' using errcode = 'P0001';
  end if;
  update public.depreciation_runs set status = 'cancelled' where id = p_id;
end $$;

create or replace function numero_private.wf_depreciation(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.depreciation_runs;
begin
  select * into r from public.depreciation_runs where id = w.source_id for update;
  if p_event = 'posted' then
    update public.fixed_assets f set accumulated_depreciation = f.accumulated_depreciation + l.amount
      from public.depreciation_lines l where l.run_id = r.id and l.asset_id = f.id;
    update public.depreciation_runs set status = 'posted' where id = r.id;
  elsif p_event = 'voided' then
    update public.depreciation_runs set status = 'draft', journal_id = null where id = r.id;
  elsif p_event = 'reversed' then
    if exists (select 1 from public.depreciation_runs x where x.company_id = r.company_id
                  and x.status in ('proposed','posted') and x.period_month > r.period_month) then
      raise exception 'NUMERO: later months have been depreciated. Reverse the most recent month first.' using errcode = 'P0001';
    end if;
    update public.fixed_assets f set accumulated_depreciation = greatest(f.accumulated_depreciation - l.amount, 0)
      from public.depreciation_lines l where l.run_id = r.id and l.asset_id = f.id;
    update public.depreciation_runs set status = 'reversed' where id = r.id;
  end if;
end $$;

-- >>> applied as migration 20260927072905 · p2_08_asset_disposal_events
-- Disposal, scrapping or write-off of an asset.
create or replace function numero_private.propose_asset_disposal(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.fixed_assets; c public.asset_categories; v_date date := (p->>'date')::date;
  v_proceeds numeric := round(coalesce((p->>'proceeds')::numeric, 0), 2); v_kind text := coalesce(p->>'kind', 'sale');
  v_bank public.accounts; v_lines jsonb := '[]'::jsonb; v_diff numeric; v_gl uuid; v_event uuid; v_j uuid;
begin
  select * into a from public.fixed_assets where id = (p->>'asset_id')::uuid for update;
  if not found then raise exception 'NUMERO: asset not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(a.company_id, 'asset.manage') then
    raise exception 'NUMERO: you are not authorised to dispose of assets.' using errcode = '42501';
  end if;
  if a.status <> 'active' then raise exception 'NUMERO: this asset is already %.', a.status using errcode = 'P0001'; end if;
  if v_kind not in ('sale','scrap','write_off') then raise exception 'NUMERO: unknown disposal type.' using errcode = 'P0001'; end if;
  if v_date is null or v_date < a.acquisition_date then raise exception 'NUMERO: the disposal date is missing or before acquisition.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'reason'), '') = '' then raise exception 'NUMERO: a reason is required.' using errcode = 'P0001'; end if;
  if v_proceeds < 0 then raise exception 'NUMERO: proceeds cannot be negative.' using errcode = 'P0001'; end if;
  if v_kind <> 'sale' and v_proceeds > 0 then raise exception 'NUMERO: proceeds are recorded only for a sale.' using errcode = 'P0001'; end if;
  select * into c from public.asset_categories where id = a.category_id;

  if v_proceeds > 0 then
    select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
    if not found or v_bank.company_id <> a.company_id or v_bank.control_type not in ('bank','cash') then
      raise exception 'NUMERO: choose the bank or cash ledger that received the proceeds.' using errcode = 'P0001';
    end if;
    v_lines := v_lines || jsonb_build_object('account_id', v_bank.id, 'debit', v_proceeds,
       'party_id', p->>'party_id', 'description', 'Proceeds — ' || a.asset_no || ' ' || a.name);
  end if;
  if a.accumulated_depreciation > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', c.accum_account_id, 'debit', a.accumulated_depreciation,
       'description', 'Accumulated depreciation released — ' || a.asset_no);
  end if;
  v_diff := a.cost - a.accumulated_depreciation - v_proceeds;   -- positive = loss
  if v_diff <> 0 then
    v_gl := numero_private.map_account(a.company_id, 'asset_disposal');
    v_lines := v_lines || jsonb_build_object('account_id', v_gl,
       case when v_diff > 0 then 'debit' else 'credit' end, abs(v_diff),
       'description', case when v_diff > 0 then 'Loss on ' else 'Gain on ' end || v_kind || ' — ' || a.asset_no);
  end if;
  v_lines := v_lines || jsonb_build_object('account_id', c.asset_account_id, 'credit', a.cost,
       'description', 'Asset removed from books — ' || a.asset_no || ' ' || a.name);

  insert into public.asset_events(asset_id, company_id, event_type, event_date, amount, status, detail, created_by)
  values (a.id, a.company_id, 'disposal', v_date, v_proceeds, 'proposed',
          jsonb_build_object('kind', v_kind, 'reason', p->>'reason', 'book_value', a.cost - a.accumulated_depreciation,
                             'gain_or_loss', -v_diff, 'buyer_party_id', p->>'party_id'), (select auth.uid()))
  returning id into v_event;
  v_j := numero_private.propose_posting(a.company_id, 'journal', v_date,
    initcap(replace(v_kind, '_', ' ')) || ' of asset ' || a.asset_no || ' · ' || a.name || ' — ' || (p->>'reason'),
    'asset_disposal', a.id, v_lines,
    jsonb_build_object('event_id', v_event, 'kind', v_kind, 'proceeds', v_proceeds, 'date', v_date),
    a.confidentiality);
  update public.asset_events set journal_id = v_j where id = v_event;
  return v_j;
end $$;

create or replace function numero_private.wf_asset_disposal(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event = 'posted' then
    update public.fixed_assets set
      status = case when w.payload->>'kind' = 'write_off' then 'written_off' else 'disposed' end,
      disposed_on = (w.payload->>'date')::date, disposal_proceeds = (w.payload->>'proceeds')::numeric,
      disposal_journal_id = w.journal_id
    where id = w.source_id;
    update public.asset_events set status = 'posted' where id = (w.payload->>'event_id')::uuid;
  elsif p_event = 'voided' then
    update public.asset_events set status = 'rejected' where id = (w.payload->>'event_id')::uuid;
  elsif p_event = 'reversed' then
    update public.fixed_assets set status = 'active', disposed_on = null, disposal_proceeds = null, disposal_journal_id = null
     where id = w.source_id;
    update public.asset_events set status = 'reversed' where id = (w.payload->>'event_id')::uuid;
  end if;
end $$;

create or replace function numero_private.propose_asset_impairment(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.fixed_assets; c public.asset_categories; v_amt numeric := round((p->>'amount')::numeric, 2);
        v_date date := (p->>'date')::date; v_event uuid; v_j uuid; v_loss uuid;
begin
  select * into a from public.fixed_assets where id = (p->>'asset_id')::uuid for update;
  if not found then raise exception 'NUMERO: asset not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(a.company_id, 'asset.manage') then
    raise exception 'NUMERO: you are not authorised to record impairment.' using errcode = '42501';
  end if;
  if a.status <> 'active' then raise exception 'NUMERO: this asset is %.', a.status using errcode = 'P0001'; end if;
  if v_date is null then raise exception 'NUMERO: a date is required.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'reason'), '') = '' then raise exception 'NUMERO: the basis of the impairment must be recorded.' using errcode = 'P0001'; end if;
  if v_amt is null or v_amt <= 0 or v_amt > a.cost - a.salvage_value - a.accumulated_depreciation then
    raise exception 'NUMERO: the impairment must be greater than zero and cannot exceed the remaining depreciable value of %.', a.cost - a.salvage_value - a.accumulated_depreciation using errcode = 'P0001';
  end if;
  select * into c from public.asset_categories where id = a.category_id;
  v_loss := numero_private.map_account(a.company_id, 'asset_impairment');
  insert into public.asset_events(asset_id, company_id, event_type, event_date, amount, status, detail, created_by)
  values (a.id, a.company_id, 'impairment', v_date, v_amt, 'proposed',
          jsonb_build_object('reason', p->>'reason', 'assessed_by', p->>'assessed_by'), (select auth.uid()))
  returning id into v_event;
  v_j := numero_private.propose_posting(a.company_id, 'adjustment', v_date,
    'Impairment of asset ' || a.asset_no || ' · ' || a.name || ' — ' || (p->>'reason'), 'asset_impairment', a.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_loss, 'debit', v_amt, 'description', 'Impairment loss — ' || a.asset_no),
      jsonb_build_object('account_id', c.accum_account_id, 'credit', v_amt, 'description', 'Accumulated impairment — ' || a.asset_no)),
    jsonb_build_object('event_id', v_event, 'amount', v_amt), a.confidentiality);
  update public.asset_events set journal_id = v_j where id = v_event;
  return v_j;
end $$;

create or replace function numero_private.wf_asset_impairment(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_amt numeric := (w.payload->>'amount')::numeric;
begin
  if p_event = 'posted' then
    update public.fixed_assets set accumulated_depreciation = accumulated_depreciation + v_amt, impairment = impairment + v_amt
     where id = w.source_id;
    update public.asset_events set status = 'posted' where id = (w.payload->>'event_id')::uuid;
  elsif p_event = 'voided' then
    update public.asset_events set status = 'rejected' where id = (w.payload->>'event_id')::uuid;
  elsif p_event = 'reversed' then
    update public.fixed_assets set accumulated_depreciation = greatest(accumulated_depreciation - v_amt, 0),
           impairment = greatest(impairment - v_amt, 0) where id = w.source_id;
    update public.asset_events set status = 'reversed' where id = (w.payload->>'event_id')::uuid;
  end if;
end $$;

-- Non-accounting lifecycle events: assignment, transfer, maintenance, physical verification, notes.
create or replace function numero_private.record_asset_event(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.fixed_assets; v_type text := p->>'event_type'; v_id uuid; d jsonb := coalesce(p->'detail', '{}'::jsonb); v_gid uuid; v_result text;
begin
  select * into a from public.fixed_assets where id = (p->>'asset_id')::uuid for update;
  if not found then raise exception 'NUMERO: asset not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(a.company_id, 'asset.manage') then
    raise exception 'NUMERO: you are not authorised to update the asset register.' using errcode = '42501';
  end if;
  if v_type not in ('assignment','transfer','maintenance','verification','note') then
    raise exception 'NUMERO: unknown asset event.' using errcode = 'P0001';
  end if;
  if (p->>'event_date') is null then raise exception 'NUMERO: the event date is required.' using errcode = 'P0001'; end if;
  select group_id into v_gid from public.companies where id = a.company_id;

  if v_type in ('assignment','transfer') then
    if d->>'custodian_party_id' is not null and not exists (
         select 1 from public.parties x where x.id = (d->>'custodian_party_id')::uuid and x.group_id = v_gid) then
      raise exception 'NUMERO: unknown party.' using errcode = 'P0001';
    end if;
    if d->>'org_unit_id' is not null and not exists (
         select 1 from public.org_units u where u.id = (d->>'org_unit_id')::uuid and u.company_id = a.company_id) then
      raise exception 'NUMERO: the selected dimension belongs to another company.' using errcode = 'P0001';
    end if;
    d := d || jsonb_build_object('from', jsonb_build_object('custodian_party_id', a.custodian_party_id, 'org_unit_id', a.org_unit_id, 'location', a.location));
    update public.fixed_assets set
      custodian_party_id = case when d ? 'custodian_party_id' then (d->>'custodian_party_id')::uuid else custodian_party_id end,
      org_unit_id = case when d ? 'org_unit_id' then (d->>'org_unit_id')::uuid else org_unit_id end,
      location = case when d ? 'location' then d->>'location' else location end
    where id = a.id;
  elsif v_type = 'verification' then
    v_result := d->>'result';
    if v_result is null or v_result not in ('located','transferred','damaged','missing','disposed') then
      raise exception 'NUMERO: the verification result must be located, transferred, damaged, missing or disposed.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.asset_events(asset_id, company_id, event_type, event_date, amount, detail, created_by)
  values (a.id, a.company_id, v_type, (p->>'event_date')::date, (p->>'amount')::numeric, d, (select auth.uid()))
  returning id into v_id;

  if v_type = 'verification' and v_result in ('missing','damaged','disposed') and a.status = 'active' then
    insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
    values (a.company_id, 'asset_verification', case when v_result = 'missing' then 'priority' else 'review' end,
      'ASSET VERIFICATION — ' || a.asset_no || ' reported ' || v_result,
      'Physical verification on ' || (p->>'event_date') || ' reported asset ' || a.asset_no || ' (' || a.name || ') as ' || v_result
        || ', while the register shows it as active with a book value of ' || (a.cost - a.accumulated_depreciation) || '. The books have not been changed.',
      jsonb_build_object('asset_id', a.id, 'event_id', v_id, 'result', v_result, 'rule', 'verification result differs from register status'),
      'fixed_assets', a.id, 'assetverify:' || v_id::text)
    on conflict (company_id, dedupe_key) do nothing;
  end if;
  return v_id;
end $$;

create or replace function public.save_asset_category(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_asset_category(p); $$;
create or replace function public.save_asset(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_asset(p); $$;
create or replace function public.create_depreciation_run(p_company uuid, p_month date) returns uuid language sql set search_path = '' as $$ select numero_private.create_depreciation_run(p_company, p_month); $$;
create or replace function public.propose_depreciation_run(p_id uuid) returns uuid language sql set search_path = '' as $$ select numero_private.propose_depreciation_run(p_id); $$;
create or replace function public.cancel_depreciation_run(p_id uuid) returns void language sql set search_path = '' as $$ select numero_private.cancel_depreciation_run(p_id); $$;
create or replace function public.propose_asset_disposal(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.propose_asset_disposal(p); $$;
create or replace function public.propose_asset_impairment(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.propose_asset_impairment(p); $$;
create or replace function public.record_asset_event(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.record_asset_event(p); $$;

-- >>> applied as migration 20260927073017 · p2_09_purchase_to_pay_documents
-- =====================================================================
-- 2. PURCHASE-TO-PAY
-- Requisition → RFQ → vendor quotations → human selection → purchase order
-- → goods / service receipt → bill → three-way comparison → payment.
-- None of these documents touches the ledger: the bill does, through the
-- existing invoice engine. A purchase order creates a COMMITMENT, not a cost.
-- =====================================================================
create table public.purchase_docs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null check (kind in ('requisition','rfq','quotation','purchase_order','goods_receipt','service_receipt')),
  doc_no text not null,
  doc_date date not null,
  party_id uuid references public.parties(id),
  parent_id uuid references public.purchase_docs(id),
  title text,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','rejected','sent','received','selected','not_selected','expired',
                      'ordered','partially_received','fully_received','billed','confirmed','closed','cancelled')),
  currency text not null references public.currencies(code),
  fx_rate numeric(20,8) not null default 1 check (fx_rate > 0),
  subtotal numeric(20,4) not null default 0,
  tax_total numeric(20,4) not null default 0,
  total numeric(20,4) not null default 0,
  required_date date,
  valid_until date,
  delivery_terms text,
  payment_terms text,
  warranty text,
  reason text,
  decision_note text,
  dims jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  confidentiality text not null default 'internal',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  unique (company_id, kind, doc_no)
);
create index purchase_docs_company_idx on public.purchase_docs(company_id, kind, status);
create index purchase_docs_parent_idx on public.purchase_docs(parent_id);
create index purchase_docs_party_idx on public.purchase_docs(party_id);

create table public.purchase_doc_lines (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.purchase_docs(id),
  company_id uuid not null references public.companies(id),
  line_no int not null,
  description text not null,
  account_id uuid references public.accounts(id),
  quantity numeric(20,4) not null default 1 check (quantity > 0),
  unit text,
  rate numeric(20,4) not null default 0 check (rate >= 0),
  amount numeric(20,4) not null default 0,
  tax_code_id uuid references public.tax_codes(id),
  tax_amount numeric(20,4) not null default 0,
  source_line_id uuid references public.purchase_doc_lines(id),
  condition text,
  dims jsonb not null default '{}'::jsonb,
  unique (doc_id, line_no)
);
create index purchase_doc_lines_source_idx on public.purchase_doc_lines(source_line_id);

alter table public.invoices add column if not exists po_id uuid references public.purchase_docs(id);
alter table public.invoice_lines add column if not exists po_line_id uuid references public.purchase_doc_lines(id);
create index if not exists invoices_po_idx on public.invoices(po_id) where po_id is not null;

create or replace function numero_private.save_purchase_doc(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_kind text := p->>'kind'; v_gid uuid;
  d public.purchase_docs; par public.purchase_docs; l jsonb; v_no int := 0; v_acc public.accounts; v_qty numeric; v_rate numeric;
  v_amount numeric; v_tax numeric; v_sub numeric := 0; v_taxtotal numeric := 0; v_date date := (p->>'doc_date')::date;
  src public.purchase_doc_lines; v_done numeric; v_prefix text;
begin
  if not numero_private.can(v_company, 'purchase.create') then
    raise exception 'NUMERO: you are not authorised to prepare purchasing documents.' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('requisition','rfq','quotation','purchase_order','goods_receipt','service_receipt') then
    raise exception 'NUMERO: unknown purchasing document.' using errcode = 'P0001';
  end if;
  if v_date is null then raise exception 'NUMERO: the document date is required.' using errcode = 'P0001'; end if;
  select group_id into v_gid from public.companies where id = v_company;

  if v_kind in ('quotation','purchase_order') and p->>'party_id' is null then
    raise exception 'NUMERO: a vendor is required.' using errcode = 'P0001';
  end if;
  if p->>'party_id' is not null then
    if not exists (select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.group_id = v_gid) then
      raise exception 'NUMERO: unknown vendor.' using errcode = 'P0001';
    end if;
    if v_kind = 'purchase_order' and exists (select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.status in ('blocked','suspended','terminated')) then
      raise exception 'NUMERO: this vendor is blocked, suspended or terminated. New orders are not permitted.' using errcode = 'P0001';
    end if;
  end if;
  if v_kind = 'requisition' and coalesce(trim(p->>'reason'), '') = '' then
    raise exception 'NUMERO: a requisition needs the reason for the purchase.' using errcode = 'P0001';
  end if;

  if p->>'parent_id' is not null then
    select * into par from public.purchase_docs where id = (p->>'parent_id')::uuid;
    if not found or par.company_id <> v_company then raise exception 'NUMERO: the linked document was not found.' using errcode = 'P0001'; end if;
    if v_kind in ('goods_receipt','service_receipt') then
      if par.kind <> 'purchase_order' or par.status not in ('approved','partially_received') then
        raise exception 'NUMERO: a receipt can be recorded only against an approved purchase order that is still open.' using errcode = 'P0001';
      end if;
    elsif v_kind = 'quotation' and par.kind <> 'rfq' then
      raise exception 'NUMERO: a vendor quotation links to a request for quotation.' using errcode = 'P0001';
    elsif v_kind = 'rfq' and par.kind <> 'requisition' then
      raise exception 'NUMERO: a request for quotation links to a requisition.' using errcode = 'P0001';
    elsif v_kind = 'purchase_order' and par.kind not in ('requisition','quotation') then
      raise exception 'NUMERO: a purchase order links to a requisition or to the selected quotation.' using errcode = 'P0001';
    end if;
    if v_kind = 'purchase_order' and par.kind = 'requisition' and par.status not in ('approved','ordered') then
      raise exception 'NUMERO: the requisition has not been approved.' using errcode = 'P0001';
    end if;
    if v_kind = 'purchase_order' and par.kind = 'quotation' and par.status <> 'selected' then
      raise exception 'NUMERO: only the quotation selected by an authorised person can become a purchase order.' using errcode = 'P0001';
    end if;
  elsif v_kind in ('goods_receipt','service_receipt') then
    raise exception 'NUMERO: a receipt must reference its purchase order.' using errcode = 'P0001';
  end if;

  if v_id is not null then
    select * into d from public.purchase_docs where id = v_id for update;
    if not found or d.company_id <> v_company or d.kind <> v_kind then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
    if d.status not in ('draft','rejected') then raise exception 'NUMERO: only drafts can be edited. This document is %.', d.status using errcode = 'P0001'; end if;
    if d.created_by <> (select auth.uid()) and not numero_private.can(v_company, 'purchase.approve') then
      raise exception 'NUMERO: you are not authorised to edit this draft.' using errcode = '42501';
    end if;
    update public.purchase_docs set status = 'draft', doc_date = v_date, party_id = (p->>'party_id')::uuid,
      parent_id = (p->>'parent_id')::uuid, title = p->>'title',
      currency = coalesce(p->>'currency', currency), fx_rate = coalesce((p->>'fx_rate')::numeric, 1),
      required_date = (p->>'required_date')::date, valid_until = (p->>'valid_until')::date,
      delivery_terms = p->>'delivery_terms', payment_terms = p->>'payment_terms', warranty = p->>'warranty',
      reason = p->>'reason', dims = coalesce(p->'dims', '{}'::jsonb), meta = coalesce(p->'meta', '{}'::jsonb),
      confidentiality = coalesce(p->>'confidentiality', confidentiality)
    where id = v_id;
    delete from public.purchase_doc_lines where doc_id = v_id;
  else
    v_prefix := case v_kind when 'requisition' then 'PR' when 'rfq' then 'RFQ' when 'quotation' then 'VQ'
                            when 'purchase_order' then 'PO' when 'goods_receipt' then 'GRN' else 'SRN' end;
    insert into public.purchase_docs(company_id, kind, doc_no, doc_date, party_id, parent_id, title, currency, fx_rate,
      required_date, valid_until, delivery_terms, payment_terms, warranty, reason, dims, meta, confidentiality, created_by)
    values (v_company, v_kind, numero_private.next_doc_no(v_company, v_kind, v_prefix, v_date), v_date,
      coalesce((p->>'party_id')::uuid, case when v_kind in ('goods_receipt','service_receipt') then par.party_id end),
      (p->>'parent_id')::uuid, p->>'title',
      coalesce(p->>'currency', par.currency, (select base_currency from public.companies where id = v_company)),
      coalesce((p->>'fx_rate')::numeric, par.fx_rate, 1),
      (p->>'required_date')::date, (p->>'valid_until')::date, p->>'delivery_terms', p->>'payment_terms', p->>'warranty',
      p->>'reason', coalesce(p->'dims', '{}'::jsonb), coalesce(p->'meta', '{}'::jsonb),
      coalesce(p->>'confidentiality', 'internal'), (select auth.uid()))
    returning id into v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_no := v_no + 1;
    if coalesce(trim(l->>'description'), '') = '' then
      raise exception 'NUMERO: line % needs a description.', v_no using errcode = 'P0001';
    end if;
    v_qty := coalesce((l->>'quantity')::numeric, 1);
    if v_qty <= 0 then raise exception 'NUMERO: line % quantity must be greater than zero.', v_no using errcode = 'P0001'; end if;
    v_rate := coalesce((l->>'rate')::numeric, 0);
    src := null;
    if v_kind in ('goods_receipt','service_receipt') then
      select * into src from public.purchase_doc_lines where id = (l->>'source_line_id')::uuid and doc_id = par.id;
      if not found then raise exception 'NUMERO: line % does not reference a line of the purchase order.', v_no using errcode = 'P0001'; end if;
      select coalesce(sum(rl.quantity), 0) into v_done
        from public.purchase_doc_lines rl join public.purchase_docs rd on rd.id = rl.doc_id
       where rl.source_line_id = src.id and rd.status = 'confirmed' and rd.id <> v_id;
      if v_done + v_qty > src.quantity then
        raise exception 'NUMERO: line % — receiving % would exceed the ordered quantity of % (already received %). Amend the purchase order instead.', v_no, v_qty, src.quantity, v_done using errcode = 'P0001';
      end if;
      v_rate := src.rate;
    end if;
    v_acc := null;
    if coalesce(l->>'account_id', src.account_id::text) is not null then
      select * into v_acc from public.accounts where id = coalesce((l->>'account_id')::uuid, src.account_id);
      if not found or v_acc.company_id <> v_company or v_acc.is_group then
        raise exception 'NUMERO: line % needs a valid posting account of this company.', v_no using errcode = 'P0001';
      end if;
    elsif v_kind = 'purchase_order' then
      raise exception 'NUMERO: line % of a purchase order needs the ledger the cost will be charged to.', v_no using errcode = 'P0001';
    end if;
    v_amount := round(v_qty * v_rate, 2);
    v_tax := 0;
    if coalesce(l->>'tax_code_id', src.tax_code_id::text) is not null then
      select coalesce(sum(round(v_amount * k.rate / 100, 2)), 0) into v_tax
        from public.tax_code_components k join public.tax_codes t on t.id = k.tax_code_id
       where t.id = coalesce((l->>'tax_code_id')::uuid, src.tax_code_id) and t.company_id = v_company
         and k.effective_from <= v_date and (k.effective_to is null or k.effective_to >= v_date);
    end if;
    insert into public.purchase_doc_lines(doc_id, company_id, line_no, description, account_id, quantity, unit, rate, amount,
                                          tax_code_id, tax_amount, source_line_id, condition, dims)
    values (v_id, v_company, v_no, trim(l->>'description'), v_acc.id, v_qty, coalesce(l->>'unit', src.unit), v_rate, v_amount,
            coalesce((l->>'tax_code_id')::uuid, src.tax_code_id), v_tax, (l->>'source_line_id')::uuid, l->>'condition',
            coalesce(l->'dims', src.dims, '{}'::jsonb));
    v_sub := v_sub + v_amount; v_taxtotal := v_taxtotal + v_tax;
  end loop;
  if v_no = 0 then raise exception 'NUMERO: the document needs at least one line.' using errcode = 'P0001'; end if;
  update public.purchase_docs set subtotal = v_sub, tax_total = v_taxtotal, total = v_sub + v_taxtotal where id = v_id;
  perform numero_private.log_event(v_company, 'purchase_docs', v_id, 'draft_saved', null,
    jsonb_build_object('kind', v_kind, 'lines', v_no, 'total', v_sub + v_taxtotal), null);
  return v_id;
end $$;

create or replace function numero_private.refresh_po_receipt_status(p_po uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_open int; v_any int;
begin
  select count(*) filter (where coalesce(r.qty, 0) < l.quantity), count(*) filter (where coalesce(r.qty, 0) > 0)
    into v_open, v_any
    from public.purchase_doc_lines l
    left join lateral (
      select sum(rl.quantity) as qty from public.purchase_doc_lines rl join public.purchase_docs rd on rd.id = rl.doc_id
       where rl.source_line_id = l.id and rd.status = 'confirmed') r on true
   where l.doc_id = p_po;
  update public.purchase_docs set status = case when v_open = 0 then 'fully_received' when v_any > 0 then 'partially_received' else 'approved' end
   where id = p_po and status in ('approved','partially_received','fully_received');
end $$;

create or replace function numero_private.submit_purchase_doc(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare d public.purchase_docs; v_new text;
begin
  select * into d from public.purchase_docs where id = p_id for update;
  if not found then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'purchase.create') then
    raise exception 'NUMERO: you are not authorised to submit purchasing documents.' using errcode = '42501';
  end if;
  if d.status <> 'draft' then raise exception 'NUMERO: only a draft can be submitted. This document is %.', d.status using errcode = 'P0001'; end if;
  if d.kind in ('requisition','purchase_order') then
    perform numero_private.open_request(d.company_id, d.kind, d.id, round(d.total * d.fx_rate, 2),
      d.doc_no || coalesce(' · ' || d.title, ''));
    v_new := 'submitted';
  elsif d.kind = 'rfq' then v_new := 'sent';
  elsif d.kind = 'quotation' then v_new := 'received';
  else
    v_new := 'confirmed';
  end if;
  update public.purchase_docs set status = v_new where id = p_id;
  if d.kind in ('goods_receipt','service_receipt') then
    perform numero_private.refresh_po_receipt_status(d.parent_id);
  end if;
  perform numero_private.log_event(d.company_id, 'purchase_docs', p_id, v_new, jsonb_build_object('status', d.status),
    jsonb_build_object('status', v_new, 'doc_no', d.doc_no), null);
  return v_new;
end $$;

create or replace function numero_private.approve_purchase_doc(p_id uuid, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare d public.purchase_docs; v_res text;
begin
  select * into d from public.purchase_docs where id = p_id for update;
  if not found then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
  if d.kind not in ('requisition','purchase_order') or d.status <> 'submitted' then
    raise exception 'NUMERO: this document is not awaiting approval.' using errcode = 'P0001';
  end if;
  v_res := numero_private.decide_request(d.company_id, d.kind, d.id, d.created_by, 'purchase.approve',
             replace(d.kind, '_', ' '), p_comment);
  if v_res = 'approved' then
    update public.purchase_docs set status = 'approved', approved_by = (select auth.uid()), approved_at = now() where id = p_id;
    if d.kind = 'purchase_order' and d.parent_id is not null then
      update public.purchase_docs set status = 'ordered' where id = d.parent_id and kind = 'requisition' and status = 'approved';
      update public.purchase_docs set status = 'ordered'
       where kind = 'requisition' and status = 'approved'
         and id = (select r.parent_id from public.purchase_docs q join public.purchase_docs r on r.id = q.parent_id
                    where q.id = d.parent_id and q.kind = 'quotation' and r.kind = 'rfq');
    end if;
    perform numero_private.log_event(d.company_id, 'purchase_docs', p_id, 'approved', null,
      jsonb_build_object('doc_no', d.doc_no, 'total', d.total,
        'note', case when d.kind = 'purchase_order' then 'Purchase order approved — the amount is now a COMMITMENT, not a cost.' end), p_comment);
  else
    perform numero_private.log_event(d.company_id, 'purchase_docs', p_id, 'approval_step', null, null, p_comment);
  end if;
  return v_res;
end $$;

create or replace function numero_private.reject_purchase_doc(p_id uuid, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.purchase_docs;
begin
  select * into d from public.purchase_docs where id = p_id for update;
  if not found then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
  if d.kind not in ('requisition','purchase_order') or d.status <> 'submitted' then
    raise exception 'NUMERO: this document is not awaiting approval.' using errcode = 'P0001';
  end if;
  perform numero_private.refuse_request(d.company_id, d.kind, d.id, 'purchase.approve', replace(d.kind, '_', ' '), p_comment);
  update public.purchase_docs set status = 'rejected', decision_note = p_comment where id = p_id;
  perform numero_private.log_event(d.company_id, 'purchase_docs', p_id, 'rejected', null, null, p_comment);
end $$;

-- >>> applied as migration 20260927073121 · p2_10_purchase_controls_privileges
-- A person chooses the vendor. NUMERO shows the comparison; it never chooses.
create or replace function numero_private.select_quotation(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.purchase_docs; v_lowest numeric;
begin
  select * into d from public.purchase_docs where id = p_id for update;
  if not found or d.kind <> 'quotation' then raise exception 'NUMERO: quotation not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'purchase.approve') then
    raise exception 'NUMERO: you are not authorised to select a vendor.' using errcode = '42501';
  end if;
  if d.status <> 'received' then raise exception 'NUMERO: this quotation is % and cannot be selected.', d.status using errcode = 'P0001'; end if;
  if d.valid_until is not null and d.valid_until < current_date then
    raise exception 'NUMERO: this quotation expired on %.', d.valid_until using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'NUMERO: record why this vendor was selected.' using errcode = 'P0001';
  end if;
  perform numero_private.check_maker_checker(d.company_id, d.created_by, 'quotation');
  select min(q.total * q.fx_rate) into v_lowest from public.purchase_docs q
   where q.kind = 'quotation' and q.parent_id is not distinct from d.parent_id and q.company_id = d.company_id
     and q.status in ('received','selected') and d.parent_id is not null;
  update public.purchase_docs set status = 'selected', decision_note = p_reason,
         approved_by = (select auth.uid()), approved_at = now() where id = p_id;
  if d.parent_id is not null then
    update public.purchase_docs set status = 'not_selected'
     where kind = 'quotation' and parent_id = d.parent_id and id <> p_id and status = 'received';
    update public.purchase_docs set status = 'closed' where id = d.parent_id and kind = 'rfq';
  end if;
  perform numero_private.log_event(d.company_id, 'purchase_docs', p_id, 'vendor_selected', null,
    jsonb_build_object('doc_no', d.doc_no, 'total', d.total, 'lowest_quote', v_lowest,
                       'was_lowest', v_lowest is null or d.total * d.fx_rate <= v_lowest), p_reason);
end $$;

create or replace function numero_private.cancel_purchase_doc(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.purchase_docs; v_new text;
begin
  select * into d from public.purchase_docs where id = p_id for update;
  if not found then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
  if d.created_by <> (select auth.uid()) and not numero_private.can(d.company_id, 'purchase.approve') then
    raise exception 'NUMERO: you are not authorised to cancel this document.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'NUMERO: a reason is required.' using errcode = 'P0001'; end if;
  if d.status in ('cancelled','closed') then raise exception 'NUMERO: this document is already %.', d.status using errcode = 'P0001'; end if;
  if d.kind in ('goods_receipt','service_receipt') and d.status = 'confirmed'
     and exists (select 1 from public.invoices i where i.po_id = d.parent_id and i.status not in ('draft','cancelled')) then
    raise exception 'NUMERO: a bill has been recorded against this order. The receipt can no longer be cancelled.' using errcode = 'P0001';
  end if;
  if d.kind = 'purchase_order' then
    if exists (select 1 from public.invoices i where i.po_id = d.id and i.status not in ('draft','cancelled')) then
      v_new := 'closed';     -- short-closed: what was billed stays, the rest of the commitment is released
    elsif exists (select 1 from public.purchase_docs r where r.parent_id = d.id and r.status = 'confirmed') then
      raise exception 'NUMERO: goods or services have been received against this order. Cancel the receipts first, or record the bill and close the order.' using errcode = 'P0001';
    end if;
  end if;
  v_new := coalesce(v_new, 'cancelled');
  update public.approval_requests set status = 'cancelled', completed_at = now()
   where entity = d.kind and entity_id = d.id and status = 'pending';
  update public.purchase_docs set status = v_new, decision_note = p_reason where id = p_id;
  if d.kind in ('goods_receipt','service_receipt') then
    perform numero_private.refresh_po_receipt_status(d.parent_id);
  end if;
  perform numero_private.log_event(d.company_id, 'purchase_docs', p_id, v_new, jsonb_build_object('status', d.status),
    jsonb_build_object('status', v_new), p_reason);
end $$;

-- Factual comparison raised for human review. It never blocks and never concludes.
create or replace function numero_private.check_bill_against_po(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; po public.purchase_docs; v_billed numeric; v_received numeric; v_tol numeric := 1;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.po_id is null or inv.status in ('draft','cancelled') then return; end if;
  select * into po from public.purchase_docs where id = inv.po_id;
  select coalesce(sum(i.subtotal), 0) into v_billed from public.invoices i
   where i.po_id = po.id and i.doc_type = 'purchase_bill' and i.status not in ('draft','cancelled');
  select coalesce(sum(rl.quantity * pl.rate), 0) into v_received
    from public.purchase_doc_lines rl
    join public.purchase_docs rd on rd.id = rl.doc_id and rd.status = 'confirmed'
    join public.purchase_doc_lines pl on pl.id = rl.source_line_id
   where rd.parent_id = po.id;

  if v_billed > po.subtotal + v_tol then
    insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
    values (inv.company_id, 'bill_exceeds_po', 'priority', 'THREE-WAY MATCH — billed more than ordered',
      'Bills recorded against purchase order ' || po.doc_no || ' total ' || v_billed || ' before tax, while the order is for ' || po.subtotal
        || '. Difference ' || (v_billed - po.subtotal) || '. This is a factual comparison for human review.',
      jsonb_build_object('invoice_id', inv.id, 'po_id', po.id, 'ordered', po.subtotal, 'billed', v_billed, 'rule', 'sum of bills > order value (tolerance 1.00)'),
      'invoices', inv.id, 'billpo:' || inv.id::text)
    on conflict (company_id, dedupe_key) do nothing;
  end if;
  if v_billed > v_received + v_tol then
    insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
    values (inv.company_id, 'billed_before_receipt', 'review', 'THREE-WAY MATCH — billed more than received',
      'Bills against purchase order ' || po.doc_no || ' total ' || v_billed || ' before tax, while confirmed receipts are worth ' || v_received
        || ' at the ordered rates. Either the goods or services have not all been received, or a receipt has not been recorded.',
      jsonb_build_object('invoice_id', inv.id, 'po_id', po.id, 'received', v_received, 'billed', v_billed, 'rule', 'sum of bills > value of confirmed receipts (tolerance 1.00)'),
      'invoices', inv.id, 'billgrn:' || inv.id::text)
    on conflict (company_id, dedupe_key) do nothing;
  end if;
  if v_billed >= po.subtotal - v_tol and po.status in ('fully_received') then
    update public.purchase_docs set status = 'billed' where id = po.id;
  end if;
end $$;

create or replace function numero_private.link_bill_to_po(p_invoice uuid, p_po uuid, p_map jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; po public.purchase_docs; m record;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found or inv.doc_type <> 'purchase_bill' then raise exception 'NUMERO: purchase bill not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(inv.company_id, 'bill.create') then
    raise exception 'NUMERO: you are not authorised to link bills.' using errcode = '42501';
  end if;
  if inv.status = 'cancelled' then raise exception 'NUMERO: this bill is cancelled.' using errcode = 'P0001'; end if;
  if p_po is null then
    update public.invoice_lines set po_line_id = null where invoice_id = p_invoice;
    update public.invoices set po_id = null where id = p_invoice;
    perform numero_private.log_event(inv.company_id, 'invoices', p_invoice, 'po_unlinked', jsonb_build_object('po_id', inv.po_id), null, null);
    return;
  end if;
  select * into po from public.purchase_docs where id = p_po;
  if not found or po.kind <> 'purchase_order' or po.company_id <> inv.company_id then
    raise exception 'NUMERO: purchase order not found in this company.' using errcode = 'P0001';
  end if;
  if po.party_id <> inv.party_id then
    raise exception 'NUMERO: the bill and the purchase order belong to different vendors.' using errcode = 'P0001';
  end if;
  if po.status not in ('approved','partially_received','fully_received','billed') then
    raise exception 'NUMERO: the purchase order is % and cannot take a bill.', po.status using errcode = 'P0001';
  end if;
  update public.invoices set po_id = p_po where id = p_invoice;
  update public.invoice_lines set po_line_id = null where invoice_id = p_invoice;
  if p_map is not null and p_map <> '{}'::jsonb then
    for m in select key, value from jsonb_each_text(p_map) loop
      if m.value is null or m.value = '' then continue; end if;
      if not exists (select 1 from public.purchase_doc_lines pl where pl.id = m.value::uuid and pl.doc_id = p_po) then
        raise exception 'NUMERO: a bill line is mapped to a line that is not on this purchase order.' using errcode = 'P0001';
      end if;
      update public.invoice_lines set po_line_id = m.value::uuid where id = m.key::uuid and invoice_id = p_invoice;
    end loop;
  else
    update public.invoice_lines il set po_line_id = pl.id
      from public.purchase_doc_lines pl
     where il.invoice_id = p_invoice and pl.doc_id = p_po and pl.line_no = il.line_no;
  end if;
  perform numero_private.log_event(inv.company_id, 'invoices', p_invoice, 'po_linked', null,
    jsonb_build_object('po_id', p_po, 'po_no', po.doc_no), null);
  if inv.status <> 'draft' then perform numero_private.check_bill_against_po(p_invoice); end if;
end $$;

-- Controls that run when a document becomes an accounting fact.
create or replace function numero_private.invoice_controls() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_limit numeric; v_out numeric; v_name text;
begin
  if new.status = 'open' and old.status = 'draft' then
    if new.po_id is not null then perform numero_private.check_bill_against_po(new.id); end if;
    if new.doc_type = 'sales_invoice' then
      select max(pr.credit_limit) into v_limit from public.party_roles pr
       where pr.party_id = new.party_id and pr.company_id = new.company_id and pr.credit_limit is not null;
      if v_limit is not null and v_limit > 0 then
        select coalesce(sum((i.total - i.amount_settled) * i.fx_rate), 0) into v_out from public.invoices i
         where i.company_id = new.company_id and i.party_id = new.party_id
           and i.doc_type in ('sales_invoice','debit_note') and i.status in ('open','partially_paid');
        if v_out > v_limit then
          select display_name into v_name from public.parties where id = new.party_id;
          insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
          values (new.company_id, 'credit_limit_exceeded', 'review', 'CREDIT CONTROL — outstanding exceeds the configured limit',
            v_name || ' now has ' || round(v_out, 2) || ' outstanding against a configured credit limit of ' || v_limit
              || '. The invoice was recorded; extending further credit is a human decision.',
            jsonb_build_object('invoice_id', new.id, 'party_id', new.party_id, 'outstanding', round(v_out, 2), 'credit_limit', v_limit,
                               'rule', 'open receivables > credit limit on the party relationship'),
            'invoices', new.id, 'credit:' || new.id::text)
          on conflict (company_id, dedupe_key) do nothing;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger invoices_controls after update of status on public.invoices
  for each row execute function numero_private.invoice_controls();

create or replace function public.save_purchase_doc(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_purchase_doc(p); $$;
create or replace function public.submit_purchase_doc(p_id uuid) returns text language sql set search_path = '' as $$ select numero_private.submit_purchase_doc(p_id); $$;
create or replace function public.approve_purchase_doc(p_id uuid, p_comment text default null) returns text language sql set search_path = '' as $$ select numero_private.approve_purchase_doc(p_id, p_comment); $$;
create or replace function public.reject_purchase_doc(p_id uuid, p_comment text) returns void language sql set search_path = '' as $$ select numero_private.reject_purchase_doc(p_id, p_comment); $$;
create or replace function public.select_quotation(p_id uuid, p_reason text) returns void language sql set search_path = '' as $$ select numero_private.select_quotation(p_id, p_reason); $$;
create or replace function public.cancel_purchase_doc(p_id uuid, p_reason text) returns void language sql set search_path = '' as $$ select numero_private.cancel_purchase_doc(p_id, p_reason); $$;
create or replace function public.link_bill_to_po(p_invoice uuid, p_po uuid, p_map jsonb default null) returns void language sql set search_path = '' as $$ select numero_private.link_bill_to_po(p_invoice, p_po, p_map); $$;

-- ---------- audit ----------
create trigger audit_asset_categories after insert or update or delete on public.asset_categories for each row execute function numero_private.audit_row();
create trigger audit_fixed_assets after insert or update or delete on public.fixed_assets for each row execute function numero_private.audit_row();
create trigger audit_depreciation_runs after insert or update or delete on public.depreciation_runs for each row execute function numero_private.audit_row();
create trigger audit_asset_events after insert or update or delete on public.asset_events for each row execute function numero_private.audit_row();
create trigger audit_purchase_docs after insert or update or delete on public.purchase_docs for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.asset_categories enable row level security;
alter table public.fixed_assets enable row level security;
alter table public.depreciation_runs enable row level security;
alter table public.depreciation_lines enable row level security;
alter table public.asset_events enable row level security;
alter table public.purchase_docs enable row level security;
alter table public.purchase_doc_lines enable row level security;

create policy asset_categories_select on public.asset_categories for select to authenticated
  using ((select numero_private.can(company_id, 'asset.view')));
create policy fixed_assets_select on public.fixed_assets for select to authenticated
  using ((select numero_private.can(company_id, 'asset.view'))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy depreciation_runs_select on public.depreciation_runs for select to authenticated
  using ((select numero_private.can(company_id, 'asset.view')));
create policy depreciation_lines_select on public.depreciation_lines for select to authenticated
  using (exists (select 1 from public.fixed_assets f where f.id = asset_id));
create policy asset_events_select on public.asset_events for select to authenticated
  using (exists (select 1 from public.fixed_assets f where f.id = asset_id));

create policy purchase_docs_select on public.purchase_docs for select to authenticated
  using (((select numero_private.can(company_id, 'purchase.view')) or created_by = (select auth.uid()))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy purchase_doc_lines_select on public.purchase_doc_lines for select to authenticated
  using (exists (select 1 from public.purchase_docs d where d.id = doc_id));

insert into numero_private.internal_functions(name) values
  ('next_doc_no'), ('refresh_po_receipt_status'), ('check_bill_against_po'), ('invoice_controls')
on conflict do nothing;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();
