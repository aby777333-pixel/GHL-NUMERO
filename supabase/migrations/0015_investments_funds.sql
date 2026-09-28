-- >>> applied as migration 20260927125734 · p3_06_investment_tables
-- =====================================================================
-- GHL NUMERO · 0015 · INVESTMENTS, FUNDS, CORPORATE STRUCTURE — TABLES
-- Spec: 30, 456, 561, 1350
--
-- Investment accounting is its own module. It is not interchangeable
-- with ordinary commercial accounting, and nothing here claims to meet
-- SEBI / AIF reporting rules: those are configured separately and must be
-- validated by qualified professionals.
-- Every accounting effect is PROPOSED and approved like any other entry.
-- =====================================================================
create table public.corporate_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  parent_company_id uuid references public.companies(id),
  parent_party_id uuid references public.parties(id),
  child_company_id uuid references public.companies(id),
  child_party_id uuid references public.parties(id),
  relation text not null check (relation in ('subsidiary','associate','joint_venture','spv','investment_entity','operating_company','holding_company','branch')),
  ownership_pct numeric(7,4) check (ownership_pct is null or (ownership_pct >= 0 and ownership_pct <= 100)),
  voting_pct numeric(7,4) check (voting_pct is null or (voting_pct >= 0 and voting_pct <= 100)),
  effective_from date,
  effective_to date,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check ((parent_company_id is not null) <> (parent_party_id is not null)),
  check ((child_company_id is not null) <> (child_party_id is not null)),
  check (parent_company_id is null or child_company_id is null or parent_company_id <> child_company_id),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index corporate_links_group_idx on public.corporate_links(group_id);

create table public.equity_holders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  holder_party_id uuid not null references public.parties(id),
  share_class text not null default 'Equity',
  quantity numeric(20,4) not null check (quantity >= 0),
  paid_up numeric(20,4) not null default 0 check (paid_up >= 0),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, holder_party_id, share_class)
);

create table public.funds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  scheme text,
  structure text not null default 'other' check (structure in ('aif_cat1','aif_cat2','aif_cat3','trust','llp','company','other')),
  manager_party_id uuid references public.parties(id),
  currency text not null references public.currencies(code),
  unit_face_value numeric(20,4) not null default 100 check (unit_face_value > 0),
  fee_pct numeric(9,4) check (fee_pct is null or (fee_pct >= 0 and fee_pct <= 100)),
  fee_basis text not null default 'committed' check (fee_basis in ('committed','contributed','nav')),
  capital_account_id uuid not null references public.accounts(id),
  commitment_period_end date,
  term_end date,
  status text not null default 'open' check (status in ('forming','open','closed','winding_up','wound_up')),
  units_outstanding numeric(20,4) not null default 0 check (units_outstanding >= 0),
  confidentiality text not null default 'confidential'
    check (confidentiality in ('internal','confidential','highly_confidential','restricted','super_admin_only')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.fund_commitments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id),
  company_id uuid not null references public.companies(id),
  investor_party_id uuid not null references public.parties(id),
  unit_class text not null default 'A',
  committed_amount numeric(20,4) not null check (committed_amount > 0),
  commitment_date date not null,
  status text not null default 'active' check (status in ('active','transferred','withdrawn')),
  called_amount numeric(20,4) not null default 0 check (called_amount >= 0),
  contributed_amount numeric(20,4) not null default 0 check (contributed_amount >= 0),
  units numeric(20,4) not null default 0 check (units >= 0),
  distributed_amount numeric(20,4) not null default 0 check (distributed_amount >= 0),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (fund_id, investor_party_id, unit_class),
  check (called_amount <= committed_amount)
);

create table public.capital_calls (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id),
  company_id uuid not null references public.companies(id),
  call_no text not null,
  call_date date not null,
  due_date date not null,
  pct numeric(9,4) check (pct is null or (pct > 0 and pct <= 100)),
  total_amount numeric(20,4) not null default 0,
  unit_price numeric(20,6) not null check (unit_price > 0),
  purpose text not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','closed','cancelled')),
  decision_note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  unique (company_id, call_no),
  check (due_date >= call_date)
);

create table public.capital_call_lines (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.capital_calls(id),
  company_id uuid not null references public.companies(id),
  commitment_id uuid not null references public.fund_commitments(id),
  investor_party_id uuid not null references public.parties(id),
  amount numeric(20,4) not null check (amount > 0),
  received_amount numeric(20,4) not null default 0 check (received_amount >= 0),
  units_allotted numeric(20,4) not null default 0,
  status text not null default 'due' check (status in ('due','part_received','received')),
  unique (call_id, commitment_id),
  check (received_amount <= amount)
);

-- Units issued to an investor, each against money received.
create table public.unit_allotments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id),
  company_id uuid not null references public.companies(id),
  commitment_id uuid not null references public.fund_commitments(id),
  call_line_id uuid references public.capital_call_lines(id),
  allot_date date not null,
  amount numeric(20,4) not null,
  unit_price numeric(20,6) not null,
  units numeric(20,4) not null,
  journal_id uuid references public.journals(id),
  status text not null default 'proposed' check (status in ('proposed','posted','rejected','reversed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index unit_allotments_fund_idx on public.unit_allotments(fund_id, status, allot_date);

create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  holding_no text not null,
  name text not null,
  investee_party_id uuid references public.parties(id),
  investee_company_id uuid references public.companies(id),
  instrument text not null default 'equity' check (instrument in ('equity','preference','debt','units','convertible','partnership','property','other')),
  measurement text not null default 'cost' check (measurement in ('cost','fair_value')),
  investment_account_id uuid not null references public.accounts(id),
  income_account_id uuid references public.accounts(id),
  gain_account_id uuid references public.accounts(id),
  fv_account_id uuid references public.accounts(id),
  org_unit_id uuid references public.org_units(id),
  fund_id uuid references public.funds(id),
  currency text not null references public.currencies(code),
  quantity numeric(20,4) not null default 0 check (quantity >= 0),
  cost numeric(20,4) not null default 0 check (cost >= 0),
  fv_adjustment numeric(20,4) not null default 0,
  fair_value numeric(20,4),
  fair_value_date date,
  realised_gain numeric(20,4) not null default 0,
  income_received numeric(20,4) not null default 0,
  acquired_on date,
  exited_on date,
  status text not null default 'active' check (status in ('active','exited','written_off')),
  confidentiality text not null default 'internal'
    check (confidentiality in ('internal','confidential','highly_confidential','restricted','super_admin_only')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, holding_no)
);
create index holdings_company_idx on public.holdings(company_id, status);

create table public.holding_txns (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references public.holdings(id),
  company_id uuid not null references public.companies(id),
  kind text not null check (kind in ('purchase','sale','income','valuation','write_down')),
  txn_date date not null,
  quantity numeric(20,4),
  amount numeric(20,4) not null default 0,
  cost_released numeric(20,4),
  gain numeric(20,4),
  fair_value numeric(20,4),
  status text not null default 'proposed' check (status in ('recorded','approved','proposed','posted','rejected','reversed')),
  journal_id uuid references public.journals(id),
  detail jsonb not null default '{}'::jsonb,
  decided_by uuid, decided_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index holding_txns_holding_idx on public.holding_txns(holding_id, txn_date desc);

create table public.fund_distributions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  fund_id uuid references public.funds(id),
  kind text not null check (kind in ('dividend','distribution','return_of_capital')),
  dist_no text not null,
  declaration_date date not null,
  record_date date not null,
  payment_date date,
  total_amount numeric(20,4) not null check (total_amount > 0),
  tax_pct numeric(9,4) not null default 0 check (tax_pct >= 0 and tax_pct < 100),
  source_account_id uuid not null references public.accounts(id),
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','rejected','declared','part_paid','paid','cancelled')),
  journal_id uuid references public.journals(id),
  decision_note text,
  notes text,
  confidentiality text not null default 'confidential',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  unique (company_id, dist_no)
);

create table public.distribution_lines (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.fund_distributions(id),
  company_id uuid not null references public.companies(id),
  holder_party_id uuid not null references public.parties(id),
  commitment_id uuid references public.fund_commitments(id),
  units numeric(20,4) not null,
  gross_amount numeric(20,4) not null,
  tax_deducted numeric(20,4) not null default 0,
  net_amount numeric(20,4) not null,
  status text not null default 'entitled' check (status in ('entitled','payment_proposed','paid')),
  paid_on date,
  payment_journal_id uuid references public.journals(id),
  unique (distribution_id, holder_party_id, commitment_id)
);

create table public.nav_runs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id),
  company_id uuid not null references public.companies(id),
  nav_date date not null,
  total_assets numeric(20,4) not null,
  total_liabilities numeric(20,4) not null,
  net_assets numeric(20,4) not null,
  units numeric(20,4) not null,
  nav_per_unit numeric(20,6),
  basis jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved','superseded','rejected')),
  note text,
  prepared_by uuid default auth.uid(),
  prepared_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz
);
create index nav_runs_fund_idx on public.nav_runs(fund_id, nav_date desc);

create table public.fund_fees (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id),
  company_id uuid not null references public.companies(id),
  period_from date not null,
  period_to date not null,
  basis text not null,
  basis_amount numeric(20,4) not null,
  rate numeric(9,4) not null,
  amount numeric(20,4) not null check (amount > 0),
  status text not null default 'proposed' check (status in ('proposed','posted','rejected','reversed')),
  journal_id uuid references public.journals(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (period_to >= period_from)
);

-- ---------- audit ----------
create trigger audit_corporate_links after insert or update or delete on public.corporate_links for each row execute function numero_private.audit_row();
create trigger audit_equity_holders after insert or update or delete on public.equity_holders for each row execute function numero_private.audit_row();
create trigger audit_funds after insert or update or delete on public.funds for each row execute function numero_private.audit_row();
create trigger audit_fund_commitments after insert or update or delete on public.fund_commitments for each row execute function numero_private.audit_row();
create trigger audit_capital_calls after insert or update or delete on public.capital_calls for each row execute function numero_private.audit_row();
create trigger audit_holdings after insert or update or delete on public.holdings for each row execute function numero_private.audit_row();
create trigger audit_holding_txns after insert or update or delete on public.holding_txns for each row execute function numero_private.audit_row();
create trigger audit_fund_distributions after insert or update or delete on public.fund_distributions for each row execute function numero_private.audit_row();
create trigger audit_nav_runs after insert or update or delete on public.nav_runs for each row execute function numero_private.audit_row();
create trigger audit_fund_fees after insert or update or delete on public.fund_fees for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.corporate_links enable row level security;
alter table public.equity_holders enable row level security;
alter table public.funds enable row level security;
alter table public.fund_commitments enable row level security;
alter table public.capital_calls enable row level security;
alter table public.capital_call_lines enable row level security;
alter table public.unit_allotments enable row level security;
alter table public.holdings enable row level security;
alter table public.holding_txns enable row level security;
alter table public.fund_distributions enable row level security;
alter table public.distribution_lines enable row level security;
alter table public.nav_runs enable row level security;
alter table public.fund_fees enable row level security;

create policy corporate_links_select on public.corporate_links for select to authenticated
  using (group_id = (select numero_private.my_group())
         and ((select numero_private.is_group_admin(group_id))
              or (parent_company_id is not null and (select numero_private.can(parent_company_id, 'investment.view')))
              or (child_company_id is not null and (select numero_private.can(child_company_id, 'investment.view')))));
create policy equity_holders_select on public.equity_holders for select to authenticated
  using ((select numero_private.can(company_id, 'investment.view')));
create policy funds_select on public.funds for select to authenticated
  using ((select numero_private.can(company_id, 'investment.view')) and (select numero_private.can_view_level(company_id, confidentiality)));
create policy fund_commitments_select on public.fund_commitments for select to authenticated
  using (exists (select 1 from public.funds f where f.id = fund_id));
create policy capital_calls_select on public.capital_calls for select to authenticated
  using (exists (select 1 from public.funds f where f.id = fund_id));
create policy capital_call_lines_select on public.capital_call_lines for select to authenticated
  using (exists (select 1 from public.capital_calls c where c.id = call_id));
create policy unit_allotments_select on public.unit_allotments for select to authenticated
  using (exists (select 1 from public.funds f where f.id = fund_id));
create policy holdings_select on public.holdings for select to authenticated
  using ((select numero_private.can(company_id, 'investment.view')) and (select numero_private.can_view_level(company_id, confidentiality)));
create policy holding_txns_select on public.holding_txns for select to authenticated
  using (exists (select 1 from public.holdings h where h.id = holding_id));
create policy fund_distributions_select on public.fund_distributions for select to authenticated
  using ((select numero_private.can(company_id, 'investment.view')) and (select numero_private.can_view_level(company_id, confidentiality)));
create policy distribution_lines_select on public.distribution_lines for select to authenticated
  using (exists (select 1 from public.fund_distributions x where x.id = distribution_id));
create policy nav_runs_select on public.nav_runs for select to authenticated
  using (exists (select 1 from public.funds f where f.id = fund_id));
create policy fund_fees_select on public.fund_fees for select to authenticated
  using (exists (select 1 from public.funds f where f.id = fund_id));

-- >>> applied as migration 20260927125929 · p3_07_holdings_structure
-- =====================================================================
-- INVESTMENTS — corporate structure, shareholders, holdings
-- =====================================================================
create or replace function numero_private.inv_party(p_company uuid, p_party uuid, p_what text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_party is not null and not exists (
       select 1 from public.parties x join public.companies c on c.group_id = x.group_id where x.id = p_party and c.id = p_company) then
    raise exception 'NUMERO: unknown % .', p_what using errcode = 'P0001';
  end if;
end $$;

create or replace function numero_private.save_corporate_link(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_gid uuid := numero_private.my_group(); v_id uuid := (p->>'id')::uuid;
  v_pc uuid := (p->>'parent_company_id')::uuid; v_pp uuid := (p->>'parent_party_id')::uuid;
  v_cc uuid := (p->>'child_company_id')::uuid; v_cp uuid := (p->>'child_party_id')::uuid;
  v_pct numeric := (p->>'ownership_pct')::numeric; v_other numeric; v_loop boolean;
begin
  if v_gid is null then raise exception 'NUMERO: authentication required.' using errcode = '42501'; end if;
  if not (numero_private.is_group_admin(v_gid)
          or (v_pc is not null and numero_private.can(v_pc, 'investment.manage'))
          or (v_cc is not null and numero_private.can(v_cc, 'investment.manage'))) then
    raise exception 'NUMERO: you are not authorised to maintain the corporate structure.' using errcode = '42501';
  end if;
  if (v_pc is null) = (v_pp is null) then raise exception 'NUMERO: name the owner: a company of the group, or an outside party.' using errcode = 'P0001'; end if;
  if (v_cc is null) = (v_cp is null) then raise exception 'NUMERO: name what is owned: a company of the group, or an outside party.' using errcode = 'P0001'; end if;
  if v_pc is not null and v_pc = v_cc then raise exception 'NUMERO: a company cannot own itself.' using errcode = 'P0001'; end if;
  if (v_pc is not null and not exists (select 1 from public.companies c where c.id = v_pc and c.group_id = v_gid))
     or (v_cc is not null and not exists (select 1 from public.companies c where c.id = v_cc and c.group_id = v_gid))
     or (v_pp is not null and not exists (select 1 from public.parties x where x.id = v_pp and x.group_id = v_gid))
     or (v_cp is not null and not exists (select 1 from public.parties x where x.id = v_cp and x.group_id = v_gid)) then
    raise exception 'NUMERO: both sides must belong to this group.' using errcode = 'P0001';
  end if;
  if p->>'relation' is null or p->>'relation' not in ('subsidiary','associate','joint_venture','spv','investment_entity','operating_company','holding_company','branch') then
    raise exception 'NUMERO: state the relation.' using errcode = 'P0001';
  end if;
  if v_pct is not null and (v_pct < 0 or v_pct > 100) then raise exception 'NUMERO: ownership is a percentage between 0 and 100.' using errcode = 'P0001'; end if;
  -- what is owned cannot, through its own holdings, own its owner
  if v_pc is not null and v_cc is not null then
    with recursive down(id) as (
      select l.child_company_id from public.corporate_links l
       where l.parent_company_id = v_cc and l.child_company_id is not null and l.effective_to is null and l.id is distinct from v_id
      union
      select l.child_company_id from public.corporate_links l join down d on l.parent_company_id = d.id
       where l.child_company_id is not null and l.effective_to is null and l.id is distinct from v_id)
    select exists (select 1 from down where id = v_pc) into v_loop;
    if v_loop then raise exception 'NUMERO: this would make a company, through the companies it owns, the owner of its own owner.' using errcode = 'P0001'; end if;
  end if;
  -- the owners of one entity cannot hold more than the whole of it
  if v_pct is not null and (p->>'effective_to') is null then
    select coalesce(sum(l.ownership_pct), 0) into v_other from public.corporate_links l
     where l.group_id = v_gid and l.effective_to is null and l.id is distinct from v_id
       and l.child_company_id is not distinct from v_cc and l.child_party_id is not distinct from v_cp;
    if v_other + v_pct > 100 then
      raise exception 'NUMERO: other owners already hold %. With this % the total would exceed the whole.', v_other || '%', v_pct || '%' using errcode = 'P0001';
    end if;
  end if;
  if v_id is null then
    insert into public.corporate_links(group_id, parent_company_id, parent_party_id, child_company_id, child_party_id, relation, ownership_pct, voting_pct, effective_from, effective_to, note)
    values (v_gid, v_pc, v_pp, v_cc, v_cp, p->>'relation', v_pct, (p->>'voting_pct')::numeric, (p->>'effective_from')::date, (p->>'effective_to')::date, p->>'note')
    returning id into v_id;
  else
    perform set_config('numero.reason', coalesce(p->>'reason', ''), true);
    update public.corporate_links set parent_company_id = v_pc, parent_party_id = v_pp, child_company_id = v_cc, child_party_id = v_cp,
      relation = p->>'relation', ownership_pct = v_pct, voting_pct = (p->>'voting_pct')::numeric,
      effective_from = (p->>'effective_from')::date, effective_to = (p->>'effective_to')::date, note = p->>'note'
    where id = v_id and group_id = v_gid;
    if not found then raise exception 'NUMERO: record not found.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function numero_private.save_equity_holder(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid;
begin
  if not numero_private.can(v_company, 'investment.manage') then
    raise exception 'NUMERO: you are not authorised to maintain the register of shareholders.' using errcode = '42501';
  end if;
  perform numero_private.inv_party(v_company, (p->>'holder_party_id')::uuid, 'holder');
  if (p->>'holder_party_id') is null then raise exception 'NUMERO: name the holder.' using errcode = 'P0001'; end if;
  if coalesce((p->>'quantity')::numeric, -1) < 0 then raise exception 'NUMERO: the number of shares cannot be negative.' using errcode = 'P0001'; end if;
  perform set_config('numero.reason', coalesce(p->>'reason', ''), true);
  insert into public.equity_holders(company_id, holder_party_id, share_class, quantity, paid_up, note)
  values (v_company, (p->>'holder_party_id')::uuid, coalesce(nullif(trim(p->>'share_class'), ''), 'Equity'), (p->>'quantity')::numeric,
          coalesce((p->>'paid_up')::numeric, 0), p->>'note')
  on conflict (company_id, holder_party_id, share_class)
  do update set quantity = excluded.quantity, paid_up = excluded.paid_up, note = excluded.note, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.save_holding(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; h public.holdings; a public.accounts; v_gid uuid;
begin
  if not numero_private.can(v_company, 'investment.manage') then
    raise exception 'NUMERO: you are not authorised to maintain investments for this company.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: a name is required.' using errcode = 'P0001'; end if;
  if coalesce(p->>'confidentiality', 'internal') <> 'internal' and not numero_private.can_view_level(v_company, p->>'confidentiality') then
    raise exception 'NUMERO: you cannot create records at a confidentiality level you are not cleared for.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  perform numero_private.inv_party(v_company, (p->>'investee_party_id')::uuid, 'investee');
  if p->>'investee_company_id' is not null and not exists (
       select 1 from public.companies c where c.id = (p->>'investee_company_id')::uuid and c.group_id = v_gid and c.id <> v_company) then
    raise exception 'NUMERO: the company invested in must be another company of this group.' using errcode = 'P0001';
  end if;
  select * into a from public.accounts where id = (p->>'investment_account_id')::uuid;
  if not found or a.company_id <> v_company or a.is_group or not a.is_active or a.type <> 'asset' then
    raise exception 'NUMERO: choose the asset ledger that carries this investment.' using errcode = 'P0001';
  end if;
  if p->>'income_account_id' is not null then perform numero_private.inv_posting_account(v_company, (p->>'income_account_id')::uuid, 'income from the investment'); end if;
  if p->>'gain_account_id' is not null then perform numero_private.inv_posting_account(v_company, (p->>'gain_account_id')::uuid, 'gain or loss on sale'); end if;
  if p->>'fv_account_id' is not null then perform numero_private.inv_posting_account(v_company, (p->>'fv_account_id')::uuid, 'changes in fair value'); end if;
  if p->>'org_unit_id' is not null and not exists (select 1 from public.org_units u where u.id = (p->>'org_unit_id')::uuid and u.company_id = v_company) then
    raise exception 'NUMERO: the selected dimension belongs to another company.' using errcode = 'P0001';
  end if;
  if p->>'fund_id' is not null and not exists (select 1 from public.funds f where f.id = (p->>'fund_id')::uuid and f.company_id = v_company) then
    raise exception 'NUMERO: the fund belongs to another company.' using errcode = 'P0001';
  end if;
  if coalesce(p->>'measurement', 'cost') not in ('cost','fair_value') then raise exception 'NUMERO: an investment is carried at cost or at fair value.' using errcode = 'P0001'; end if;

  if v_id is null then
    insert into public.holdings(company_id, holding_no, name, investee_party_id, investee_company_id, instrument, measurement, investment_account_id,
      income_account_id, gain_account_id, fv_account_id, org_unit_id, fund_id, currency, confidentiality, notes)
    values (v_company, numero_private.next_doc_no(v_company, 'holding', 'INV', current_date), trim(p->>'name'), (p->>'investee_party_id')::uuid,
      (p->>'investee_company_id')::uuid, coalesce(p->>'instrument', 'equity'), coalesce(p->>'measurement', 'cost'), a.id,
      (p->>'income_account_id')::uuid, (p->>'gain_account_id')::uuid, (p->>'fv_account_id')::uuid, (p->>'org_unit_id')::uuid, (p->>'fund_id')::uuid,
      coalesce(p->>'currency', (select base_currency from public.companies where id = v_company)), coalesce(p->>'confidentiality', 'internal'), p->>'notes')
    returning id into v_id;
  else
    select * into h from public.holdings where id = v_id and company_id = v_company for update;
    if not found then raise exception 'NUMERO: investment not found.' using errcode = 'P0001'; end if;
    if not numero_private.can_view_level(v_company, h.confidentiality) then
      raise exception 'NUMERO: you are not cleared to change this record.' using errcode = '42501';
    end if;
    if (h.investment_account_id <> a.id or h.measurement <> coalesce(p->>'measurement', h.measurement)) and (h.cost <> 0 or h.fv_adjustment <> 0
         or exists (select 1 from public.holding_txns t where t.holding_id = h.id and t.status = 'proposed')) then
      raise exception 'NUMERO: the ledger and the measurement of an investment cannot change while it carries a balance.' using errcode = 'P0001';
    end if;
    perform set_config('numero.reason', coalesce(p->>'reason', ''), true);
    update public.holdings set name = trim(p->>'name'), investee_party_id = (p->>'investee_party_id')::uuid, investee_company_id = (p->>'investee_company_id')::uuid,
      instrument = coalesce(p->>'instrument', instrument), measurement = coalesce(p->>'measurement', measurement), investment_account_id = a.id,
      income_account_id = (p->>'income_account_id')::uuid, gain_account_id = (p->>'gain_account_id')::uuid, fv_account_id = (p->>'fv_account_id')::uuid,
      org_unit_id = (p->>'org_unit_id')::uuid, fund_id = (p->>'fund_id')::uuid, confidentiality = coalesce(p->>'confidentiality', confidentiality), notes = p->>'notes'
    where id = v_id;
  end if;
  return v_id;
end $$;

-- One function for the four events that change a holding in the books.
--   purchase   Dr investment · Cr bank
--   sale       Dr bank · Cr investment at carrying amount · Dr/Cr gain or loss
--   income     Dr bank · Dr tax deducted · Cr income
--   write_down Dr loss · Cr investment (a holding carried at cost that has lost value)
create or replace function numero_private.propose_holding_txn(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  h public.holdings; v_kind text := p->>'kind'; v_date date := (p->>'date')::date; v_amt numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  v_qty numeric := (p->>'quantity')::numeric; v_bank public.accounts; v_tax numeric := round(coalesce((p->>'tax_deducted')::numeric, 0), 2);
  v_cost numeric; v_fv numeric; v_gain numeric; v_lines jsonb; v_txn uuid; v_j uuid; v_pend numeric; v_dims jsonb; v_party uuid; v_what text;
begin
  select * into h from public.holdings where id = (p->>'holding_id')::uuid for update;
  if not found then raise exception 'NUMERO: investment not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(h.company_id, 'investment.manage') then
    raise exception 'NUMERO: you are not authorised to record investment transactions.' using errcode = '42501';
  end if;
  if not numero_private.can_view_level(h.company_id, h.confidentiality) then
    raise exception 'NUMERO: you are not cleared for this investment.' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('purchase','sale','income','write_down') then raise exception 'NUMERO: unknown transaction.' using errcode = 'P0001'; end if;
  if v_date is null then raise exception 'NUMERO: the date is required.' using errcode = 'P0001'; end if;
  if v_amt <= 0 then raise exception 'NUMERO: the amount must be greater than zero.' using errcode = 'P0001'; end if;
  if h.status <> 'active' and v_kind <> 'income' then raise exception 'NUMERO: this investment is %.', replace(h.status, '_', ' ') using errcode = 'P0001'; end if;
  if exists (select 1 from public.holding_txns t where t.holding_id = h.id and t.status = 'proposed') then
    raise exception 'NUMERO: an entry for this investment is already awaiting approval. Approve or reject it first.' using errcode = 'P0001';
  end if;
  v_party := coalesce(h.investee_party_id, null);
  v_dims := case when h.org_unit_id is not null then jsonb_build_object((select type_key from public.org_units where id = h.org_unit_id), h.org_unit_id) else '{}'::jsonb end;

  if v_kind <> 'write_down' then
    select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
    if not found or v_bank.company_id <> h.company_id or coalesce(v_bank.control_type, '') not in ('bank','cash') then
      raise exception 'NUMERO: choose the bank or cash ledger the money went through.' using errcode = 'P0001';
    end if;
  end if;

  if v_kind = 'purchase' then
    if v_qty is null or v_qty <= 0 then raise exception 'NUMERO: state the quantity bought.' using errcode = 'P0001'; end if;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', h.investment_account_id, 'debit', v_amt, 'party_id', v_party, 'dims', v_dims, 'description', 'Investment acquired — ' || h.holding_no || ' ' || h.name),
      jsonb_build_object('account_id', v_bank.id, 'credit', v_amt, 'description', coalesce(p->>'reference', h.holding_no)));
    v_what := 'Investment acquired: ' || v_qty || ' of ' || h.name;
  elsif v_kind = 'sale' then
    if v_qty is null or v_qty <= 0 or v_qty > h.quantity then
      raise exception 'NUMERO: the quantity sold must be greater than zero and cannot exceed the % held.', h.quantity using errcode = 'P0001';
    end if;
    v_cost := case when v_qty = h.quantity then h.cost else round(h.cost * v_qty / h.quantity, 2) end;
    v_fv := case when v_qty = h.quantity then h.fv_adjustment else round(h.fv_adjustment * v_qty / h.quantity, 2) end;
    v_gain := v_amt - v_cost - v_fv;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_bank.id, 'debit', v_amt, 'description', coalesce(p->>'reference', 'Proceeds — ' || h.holding_no)));
    if v_cost + v_fv > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', h.investment_account_id, 'credit', v_cost + v_fv, 'party_id', v_party, 'dims', v_dims,
        'description', 'Carrying amount of ' || v_qty || ' sold — ' || h.holding_no);
    elsif v_cost + v_fv < 0 then
      v_lines := v_lines || jsonb_build_object('account_id', h.investment_account_id, 'debit', -(v_cost + v_fv), 'party_id', v_party, 'dims', v_dims,
        'description', 'Carrying amount of ' || v_qty || ' sold — ' || h.holding_no);
    end if;
    if v_gain <> 0 then
      v_lines := v_lines || jsonb_build_object('account_id', coalesce(h.gain_account_id, numero_private.map_account(h.company_id, 'investment_gain_loss')),
        case when v_gain > 0 then 'credit' else 'debit' end, abs(v_gain), 'dims', v_dims,
        'description', case when v_gain > 0 then 'Gain' else 'Loss' end || ' on sale — ' || h.holding_no);
    end if;
    v_what := 'Investment sold: ' || v_qty || ' of ' || h.name;
  elsif v_kind = 'income' then
    if v_tax < 0 or v_tax >= v_amt then raise exception 'NUMERO: tax deducted must be less than the income.' using errcode = 'P0001'; end if;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_bank.id, 'debit', v_amt - v_tax, 'description', coalesce(p->>'reference', 'Income — ' || h.holding_no)),
      jsonb_build_object('account_id', coalesce(h.income_account_id, numero_private.map_account(h.company_id, 'investment_income')), 'credit', v_amt,
        'party_id', v_party, 'dims', v_dims, 'description', initcap(coalesce(p->>'income_kind', 'income')) || ' from ' || h.name));
    if v_tax > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', numero_private.map_account(h.company_id, 'tds_receivable'), 'debit', v_tax,
        'party_id', v_party, 'description', 'Tax deducted at source — ' || h.holding_no);
    end if;
    v_what := initcap(coalesce(p->>'income_kind', 'income')) || ' received from ' || h.name;
  else
    if coalesce(trim(p->>'reason'), '') = '' then raise exception 'NUMERO: the basis of the write-down must be recorded.' using errcode = 'P0001'; end if;
    if v_amt > h.cost + h.fv_adjustment then
      raise exception 'NUMERO: the write-down cannot exceed the carrying amount of %.', h.cost + h.fv_adjustment using errcode = 'P0001';
    end if;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', coalesce(h.gain_account_id, numero_private.map_account(h.company_id, 'investment_gain_loss')), 'debit', v_amt,
        'dims', v_dims, 'description', 'Write-down — ' || h.holding_no || ' — ' || (p->>'reason')),
      jsonb_build_object('account_id', h.investment_account_id, 'credit', v_amt, 'party_id', v_party, 'dims', v_dims, 'description', 'Write-down — ' || h.holding_no));
    v_what := 'Investment written down: ' || h.name || ' — ' || (p->>'reason');
  end if;

  insert into public.holding_txns(holding_id, company_id, kind, txn_date, quantity, amount, cost_released, gain, status, detail)
  values (h.id, h.company_id, v_kind, v_date, v_qty, v_amt, v_cost, v_gain, 'proposed',
          jsonb_strip_nulls(jsonb_build_object('reference', p->>'reference', 'reason', p->>'reason', 'tax_deducted', nullif(v_tax, 0),
            'income_kind', p->>'income_kind', 'fv_released', v_fv, 'bank_ledger_id', p->>'bank_ledger_id', 'counterparty', p->>'counterparty')))
  returning id into v_txn;
  v_j := numero_private.propose_posting(h.company_id, 'journal', v_date, v_what, 'holding_txn', v_txn, v_lines,
           jsonb_build_object('holding_id', h.id, 'kind', v_kind, 'amount', v_amt, 'quantity', v_qty, 'cost_released', v_cost, 'fv_released', v_fv, 'gain', v_gain),
           h.confidentiality);
  update public.holding_txns set journal_id = v_j where id = v_txn;
  return v_j;
end $$;

create or replace function numero_private.wf_holding_txn(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.holding_txns; h public.holdings; s int;
        v_qty numeric := coalesce((w.payload->>'quantity')::numeric, 0); v_amt numeric := (w.payload->>'amount')::numeric;
        v_cost numeric := coalesce((w.payload->>'cost_released')::numeric, 0); v_fv numeric := coalesce((w.payload->>'fv_released')::numeric, 0);
        v_gain numeric := coalesce((w.payload->>'gain')::numeric, 0);
begin
  select * into t from public.holding_txns where id = w.source_id for update;
  select * into h from public.holdings where id = t.holding_id for update;
  if p_event = 'voided' then
    update public.holding_txns set status = 'rejected' where id = t.id;
    return;
  end if;
  s := case when p_event = 'posted' then 1 else -1 end;
  if t.kind = 'purchase' then
    if s = -1 and h.quantity - v_qty < 0 then
      raise exception 'NUMERO: units of this purchase have since been sold. The purchase cannot be reversed.' using errcode = 'P0001';
    end if;
    update public.holdings set quantity = quantity + s * v_qty, cost = cost + s * v_amt,
           acquired_on = coalesce(acquired_on, t.txn_date) where id = h.id;
  elsif t.kind = 'sale' then
    update public.holdings set quantity = quantity - s * v_qty, cost = cost - s * v_cost, fv_adjustment = fv_adjustment - s * v_fv,
           realised_gain = realised_gain + s * v_gain,
           status = case when quantity - s * v_qty = 0 then 'exited' else 'active' end,
           exited_on = case when quantity - s * v_qty = 0 then t.txn_date end
     where id = h.id;
  elsif t.kind = 'income' then
    update public.holdings set income_received = income_received + s * v_amt where id = h.id;
  elsif t.kind = 'write_down' then
    update public.holdings set cost = cost - s * least(v_amt, cost + case when s = 1 then 0 else v_amt end) where id = h.id and measurement = 'cost';
    update public.holdings set fv_adjustment = fv_adjustment - s * v_amt where id = h.id and measurement = 'fair_value';
  elsif t.kind = 'valuation' then
    update public.holdings set fv_adjustment = fv_adjustment + s * v_amt,
           fair_value = case when s = 1 then t.fair_value else fair_value end,
           fair_value_date = case when s = 1 then t.txn_date else fair_value_date end
     where id = h.id;
  end if;
  update public.holding_txns set status = case when p_event = 'posted' then 'posted' else 'reversed' end where id = t.id;
end $$;

-- A valuation states what an investment is worth, who says so and on what basis.
-- Carried at cost: the valuation is recorded beside the books and approved by a second person; the books do not change.
-- Carried at fair value: the change in value is proposed as an accounting entry.
create or replace function numero_private.record_holding_valuation(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare h public.holdings; v_date date := (p->>'date')::date; v_fv numeric := round((p->>'fair_value')::numeric, 2); v_txn uuid; v_diff numeric; v_j uuid; v_dims jsonb;
begin
  select * into h from public.holdings where id = (p->>'holding_id')::uuid for update;
  if not found then raise exception 'NUMERO: investment not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(h.company_id, 'investment.manage') then
    raise exception 'NUMERO: you are not authorised to record valuations.' using errcode = '42501';
  end if;
  if not numero_private.can_view_level(h.company_id, h.confidentiality) then
    raise exception 'NUMERO: you are not cleared for this investment.' using errcode = '42501';
  end if;
  if h.status <> 'active' then raise exception 'NUMERO: this investment is %.', replace(h.status, '_', ' ') using errcode = 'P0001'; end if;
  if v_date is null or v_fv is null or v_fv < 0 then raise exception 'NUMERO: a valuation needs its date and its value.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'method'), '') = '' or coalesce(trim(p->>'valuer'), '') = '' or coalesce(trim(p->>'basis'), '') = '' then
    raise exception 'NUMERO: a valuation states its method, who made it and the assumptions it rests on.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.holding_txns t where t.holding_id = h.id and t.status = 'proposed') then
    raise exception 'NUMERO: an entry for this investment is already awaiting approval. Approve or reject it first.' using errcode = 'P0001';
  end if;
  v_diff := v_fv - (h.cost + h.fv_adjustment);
  insert into public.holding_txns(holding_id, company_id, kind, txn_date, quantity, amount, fair_value, status, detail)
  values (h.id, h.company_id, 'valuation', v_date, h.quantity, v_diff, v_fv, 'recorded',
          jsonb_strip_nulls(jsonb_build_object('method', p->>'method', 'valuer', p->>'valuer', 'basis', p->>'basis', 'document_id', p->>'document_id',
            'carrying_amount', h.cost + h.fv_adjustment, 'measurement', h.measurement)))
  returning id into v_txn;
  if h.measurement = 'fair_value' and v_diff <> 0 then
    v_dims := case when h.org_unit_id is not null then jsonb_build_object((select type_key from public.org_units where id = h.org_unit_id), h.org_unit_id) else '{}'::jsonb end;
    v_j := numero_private.propose_posting(h.company_id, 'adjustment', v_date,
      'Fair value of ' || h.name || ' ' || case when v_diff > 0 then 'rose' else 'fell' end || ' to ' || v_fv || ' — ' || (p->>'method') || ', ' || (p->>'valuer'),
      'holding_txn', v_txn,
      jsonb_build_array(
        jsonb_build_object('account_id', h.investment_account_id, case when v_diff > 0 then 'debit' else 'credit' end, abs(v_diff),
          'party_id', h.investee_party_id, 'dims', v_dims, 'description', 'Change in fair value — ' || h.holding_no),
        jsonb_build_object('account_id', coalesce(h.fv_account_id, numero_private.map_account(h.company_id, 'unrealised_gain_loss')),
          case when v_diff > 0 then 'credit' else 'debit' end, abs(v_diff), 'dims', v_dims, 'description', 'Unrealised ' || case when v_diff > 0 then 'gain' else 'loss' end || ' — ' || h.holding_no)),
      jsonb_build_object('holding_id', h.id, 'kind', 'valuation', 'amount', v_diff), h.confidentiality);
    update public.holding_txns set status = 'proposed', journal_id = v_j where id = v_txn;
  end if;
  return v_txn;
end $$;

-- Approval of a valuation that stands beside the books (holding carried at cost, or no change in value).
create or replace function numero_private.decide_holding_valuation(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.holding_txns; h public.holdings;
begin
  select * into t from public.holding_txns where id = p_id for update;
  if not found or t.kind <> 'valuation' then raise exception 'NUMERO: valuation not found.' using errcode = 'P0001'; end if;
  select * into h from public.holdings where id = t.holding_id for update;
  if not numero_private.can(h.company_id, 'investment.approve') then
    raise exception 'NUMERO: you are not authorised to approve valuations.' using errcode = '42501';
  end if;
  if t.status <> 'recorded' then raise exception 'NUMERO: this valuation is %.', t.status using errcode = 'P0001'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'NUMERO: the decision is approved or rejected.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'NUMERO: a reason is required to reject.' using errcode = 'P0001'; end if;
  perform numero_private.check_maker_checker(h.company_id, t.created_by, 'valuation');
  update public.holding_txns set status = p_decision, decided_by = (select auth.uid()), decided_at = now(),
         detail = detail || jsonb_strip_nulls(jsonb_build_object('decision_note', p_note)) where id = p_id;
  if p_decision = 'approved' then
    update public.holdings set fair_value = t.fair_value, fair_value_date = t.txn_date where id = h.id;
  end if;
  perform numero_private.log_event(h.company_id, 'holding_txns', p_id, 'valuation_' || p_decision, null,
    jsonb_build_object('holding', h.holding_no, 'fair_value', t.fair_value, 'carrying_amount', h.cost + h.fv_adjustment,
      'rule', 'This investment is carried at cost. The valuation is recorded beside the books; the books are unchanged.'), p_note);
end $$;

create or replace function public.save_corporate_link(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_corporate_link(p); $$;
create or replace function public.save_equity_holder(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_equity_holder(p); $$;
create or replace function public.save_holding(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_holding(p); $$;
create or replace function public.propose_holding_txn(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.propose_holding_txn(p); $$;
create or replace function public.record_holding_valuation(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.record_holding_valuation(p); $$;
create or replace function public.decide_holding_valuation(p_id uuid, p_decision text, p_note text default null) returns void language sql set search_path = '' as $$ select numero_private.decide_holding_valuation(p_id, p_decision, p_note); $$;

insert into numero_private.internal_functions(name) values ('inv_party') on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927130204 · p3_08_funds_distributions_nav
-- =====================================================================
-- INVESTMENTS — funds, commitments, capital calls, units, distributions
-- and dividends, net asset value, management fees.
-- =====================================================================

-- a write-down lowers the carrying amount by its amount, and a reversal gives it back
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'wf_holding_txn';
  v_new := replace(v_def,
    'update public.holdings set cost = cost - s * least(v_amt, cost + case when s = 1 then 0 else v_amt end) where id = h.id and measurement = ''cost'';',
    'update public.holdings set cost = cost - s * v_amt where id = h.id and measurement = ''cost'';');
  if v_new = v_def then raise exception 'NUMERO: wf_holding_txn could not be corrected.'; end if;
  execute v_new;
end $$;

create or replace function numero_private.fund_for(p_id uuid, p_perm text, p_what text) returns public.funds
language plpgsql security definer set search_path = '' as $$
declare f public.funds;
begin
  select * into f from public.funds where id = p_id for update;
  if not found then raise exception 'NUMERO: fund not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(f.company_id, p_perm) then
    raise exception 'NUMERO: you are not authorised to %.', p_what using errcode = '42501';
  end if;
  if not numero_private.can_view_level(f.company_id, f.confidentiality) then
    raise exception 'NUMERO: you are not cleared for this fund.' using errcode = '42501';
  end if;
  return f;
end $$;

create or replace function numero_private.save_fund(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; a public.accounts; f public.funds;
begin
  if not numero_private.can(v_company, 'investment.manage') then
    raise exception 'NUMERO: you are not authorised to maintain funds for this company.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: a name is required.' using errcode = 'P0001'; end if;
  if coalesce(p->>'confidentiality', 'confidential') <> 'internal' and not numero_private.can_view_level(v_company, coalesce(p->>'confidentiality', 'confidential')) then
    raise exception 'NUMERO: you cannot create records at a confidentiality level you are not cleared for.' using errcode = '42501';
  end if;
  perform numero_private.inv_party(v_company, (p->>'manager_party_id')::uuid, 'manager');
  select * into a from public.accounts where id = (p->>'capital_account_id')::uuid;
  if not found or a.company_id <> v_company or a.is_group or not a.is_active or a.type <> 'equity' then
    raise exception 'NUMERO: choose the equity ledger that carries the capital of the investors.' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.funds(company_id, name, scheme, structure, manager_party_id, currency, unit_face_value, fee_pct, fee_basis, capital_account_id,
      commitment_period_end, term_end, status, confidentiality, notes)
    values (v_company, trim(p->>'name'), p->>'scheme', coalesce(p->>'structure', 'other'), (p->>'manager_party_id')::uuid,
      coalesce(p->>'currency', (select base_currency from public.companies where id = v_company)), coalesce((p->>'unit_face_value')::numeric, 100),
      (p->>'fee_pct')::numeric, coalesce(p->>'fee_basis', 'committed'), a.id, (p->>'commitment_period_end')::date, (p->>'term_end')::date,
      coalesce(p->>'status', 'open'), coalesce(p->>'confidentiality', 'confidential'), p->>'notes')
    returning id into v_id;
  else
    f := numero_private.fund_for(v_id, 'investment.manage', 'maintain this fund');
    if f.capital_account_id <> a.id and f.units_outstanding <> 0 then
      raise exception 'NUMERO: the capital ledger of a fund cannot change once units have been issued.' using errcode = 'P0001';
    end if;
    perform set_config('numero.reason', coalesce(p->>'reason', ''), true);
    update public.funds set name = trim(p->>'name'), scheme = p->>'scheme', structure = coalesce(p->>'structure', structure),
      manager_party_id = (p->>'manager_party_id')::uuid, fee_pct = (p->>'fee_pct')::numeric, fee_basis = coalesce(p->>'fee_basis', fee_basis),
      capital_account_id = a.id, commitment_period_end = (p->>'commitment_period_end')::date, term_end = (p->>'term_end')::date,
      status = coalesce(p->>'status', status), confidentiality = coalesce(p->>'confidentiality', confidentiality), notes = p->>'notes'
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function numero_private.save_commitment(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.funds; v_id uuid := (p->>'id')::uuid; c public.fund_commitments; v_amt numeric := round((p->>'committed_amount')::numeric, 2);
begin
  f := numero_private.fund_for((p->>'fund_id')::uuid, 'investment.manage', 'record commitments');
  perform numero_private.inv_party(f.company_id, (p->>'investor_party_id')::uuid, 'investor');
  if (p->>'investor_party_id') is null then raise exception 'NUMERO: name the investor.' using errcode = 'P0001'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'NUMERO: the commitment must be greater than zero.' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.fund_commitments(fund_id, company_id, investor_party_id, unit_class, committed_amount, commitment_date, note)
    values (f.id, f.company_id, (p->>'investor_party_id')::uuid, coalesce(nullif(trim(p->>'unit_class'), ''), 'A'), v_amt,
            coalesce((p->>'commitment_date')::date, current_date), p->>'note')
    returning id into v_id;
  else
    select * into c from public.fund_commitments where id = v_id and fund_id = f.id for update;
    if not found then raise exception 'NUMERO: commitment not found.' using errcode = 'P0001'; end if;
    if v_amt < c.called_amount then
      raise exception 'NUMERO: % has already been called on this commitment. It cannot be lowered below that.', c.called_amount using errcode = 'P0001';
    end if;
    perform set_config('numero.reason', coalesce(p->>'reason', ''), true);
    update public.fund_commitments set committed_amount = v_amt, status = coalesce(p->>'status', status), note = p->>'note' where id = v_id;
  end if;
  return v_id;
end $$;

-- A capital call asks each investor for a share of what they committed. It is a request, not money received.
create or replace function numero_private.save_capital_call(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.funds; v_id uuid := (p->>'id')::uuid; cc public.capital_calls; v_pct numeric := (p->>'pct')::numeric; c record;
        v_date date := (p->>'call_date')::date; v_total numeric := 0; v_amt numeric; v_n int := 0;
begin
  f := numero_private.fund_for((p->>'fund_id')::uuid, 'investment.manage', 'prepare capital calls');
  if f.status not in ('forming','open') then raise exception 'NUMERO: this fund is %. Capital can no longer be called.', replace(f.status, '_', ' ') using errcode = 'P0001'; end if;
  if v_date is null or (p->>'due_date') is null then raise exception 'NUMERO: the date of the call and the date by which it is due are required.' using errcode = 'P0001'; end if;
  if v_pct is null or v_pct <= 0 or v_pct > 100 then raise exception 'NUMERO: state the share of the commitment that is called, as a percentage.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'purpose'), '') = '' then raise exception 'NUMERO: a capital call states its purpose.' using errcode = 'P0001'; end if;
  if v_id is not null then
    select * into cc from public.capital_calls where id = v_id and fund_id = f.id for update;
    if not found then raise exception 'NUMERO: capital call not found.' using errcode = 'P0001'; end if;
    if cc.status not in ('draft','rejected') then raise exception 'NUMERO: only a draft can be edited. This call is %.', cc.status using errcode = 'P0001'; end if;
    update public.capital_calls set status = 'draft', call_date = v_date, due_date = (p->>'due_date')::date, pct = v_pct,
      unit_price = coalesce((p->>'unit_price')::numeric, f.unit_face_value), purpose = trim(p->>'purpose') where id = v_id;
    delete from public.capital_call_lines where call_id = v_id;
  else
    insert into public.capital_calls(fund_id, company_id, call_no, call_date, due_date, pct, unit_price, purpose)
    values (f.id, f.company_id, numero_private.next_doc_no(f.company_id, 'capital_call', 'CALL', v_date), v_date, (p->>'due_date')::date, v_pct,
            coalesce((p->>'unit_price')::numeric, f.unit_face_value), trim(p->>'purpose'))
    returning id into v_id;
  end if;
  for c in select * from public.fund_commitments where fund_id = f.id and status = 'active' order by commitment_date, id loop
    v_amt := least(round(c.committed_amount * v_pct / 100, 2), c.committed_amount - c.called_amount
               - coalesce((select sum(l.amount) from public.capital_call_lines l join public.capital_calls x on x.id = l.call_id
                            where l.commitment_id = c.id and x.status in ('draft','submitted') and x.id <> v_id), 0));
    if v_amt > 0 then
      insert into public.capital_call_lines(call_id, company_id, commitment_id, investor_party_id, amount)
      values (v_id, f.company_id, c.id, c.investor_party_id, v_amt);
      v_total := v_total + v_amt; v_n := v_n + 1;
    end if;
  end loop;
  if v_n = 0 then raise exception 'NUMERO: nothing is left to call: every commitment has been called in full.' using errcode = 'P0001'; end if;
  update public.capital_calls set total_amount = v_total where id = v_id;
  return v_id;
end $$;

create or replace function numero_private.submit_capital_call(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cc public.capital_calls; f public.funds;
begin
  select * into cc from public.capital_calls where id = p_id for update;
  if not found then raise exception 'NUMERO: capital call not found.' using errcode = 'P0001'; end if;
  f := numero_private.fund_for(cc.fund_id, 'investment.manage', 'submit capital calls');
  if cc.status <> 'draft' then raise exception 'NUMERO: only a draft can be submitted. This call is %.', cc.status using errcode = 'P0001'; end if;
  perform numero_private.open_request(cc.company_id, 'capital_call', cc.id, cc.total_amount, 'Capital call ' || cc.call_no || ' — ' || f.name || ' — ' || cc.purpose);
  update public.capital_calls set status = 'submitted' where id = p_id;
end $$;

create or replace function numero_private.decide_capital_call(p_id uuid, p_decision text, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare cc public.capital_calls; v text;
begin
  select * into cc from public.capital_calls where id = p_id for update;
  if not found then raise exception 'NUMERO: capital call not found.' using errcode = 'P0001'; end if;
  perform numero_private.fund_for(cc.fund_id, 'investment.view', 'see this fund');
  if cc.status <> 'submitted' then raise exception 'NUMERO: this call is not awaiting approval. It is %.', cc.status using errcode = 'P0001'; end if;
  if p_decision = 'rejected' then
    perform numero_private.refuse_request(cc.company_id, 'capital_call', cc.id, 'investment.approve', 'capital call', p_comment);
    update public.capital_calls set status = 'rejected', decision_note = p_comment where id = p_id;
    return 'rejected';
  end if;
  v := numero_private.decide_request(cc.company_id, 'capital_call', cc.id, cc.created_by, 'investment.approve', 'capital call', p_comment);
  if v = 'approved' then
    -- the call is now owed by the investors: what has been called rises. No money has moved and nothing is posted.
    update public.fund_commitments c set called_amount = c.called_amount + l.amount
      from public.capital_call_lines l where l.call_id = p_id and l.commitment_id = c.id;
    update public.capital_calls set status = 'approved', approved_by = (select auth.uid()), approved_at = now(), decision_note = p_comment where id = p_id;
  end if;
  return v;
end $$;

-- Money received from an investor against a call: Dr bank · Cr capital of the investors. Units are issued when it is posted.
create or replace function numero_private.propose_capital_receipt(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.capital_call_lines; cc public.capital_calls; f public.funds; v_amt numeric := round((p->>'amount')::numeric, 2);
        v_date date := (p->>'date')::date; v_bank public.accounts; v_pend numeric; v_units numeric; v_al uuid; v_j uuid;
begin
  select * into l from public.capital_call_lines where id = (p->>'line_id')::uuid for update;
  if not found then raise exception 'NUMERO: that line of the capital call was not found.' using errcode = 'P0001'; end if;
  select * into cc from public.capital_calls where id = l.call_id;
  f := numero_private.fund_for(cc.fund_id, 'investment.manage', 'record money received from investors');
  if cc.status <> 'approved' then raise exception 'NUMERO: money is received against a capital call that has been approved. This call is %.', cc.status using errcode = 'P0001'; end if;
  if v_date is null then raise exception 'NUMERO: the date is required.' using errcode = 'P0001'; end if;
  select coalesce(sum(a.amount), 0) into v_pend from public.unit_allotments a where a.call_line_id = l.id and a.status = 'proposed';
  if v_amt is null or v_amt <= 0 or v_amt > l.amount - l.received_amount - v_pend then
    raise exception 'NUMERO: % was called, % has been received and % awaits approval. The receipt cannot exceed %.', l.amount, l.received_amount, v_pend, l.amount - l.received_amount - v_pend using errcode = 'P0001';
  end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> f.company_id or coalesce(v_bank.control_type, '') <> 'bank' then
    raise exception 'NUMERO: choose the bank ledger that received the money.' using errcode = 'P0001';
  end if;
  v_units := round(v_amt / cc.unit_price, 4);
  insert into public.unit_allotments(fund_id, company_id, commitment_id, call_line_id, allot_date, amount, unit_price, units)
  values (f.id, f.company_id, l.commitment_id, l.id, v_date, v_amt, cc.unit_price, v_units)
  returning id into v_al;
  v_j := numero_private.propose_posting(f.company_id, 'receipt', v_date,
    'Capital received on call ' || cc.call_no || ' — ' || f.name || ' — ' || v_units || ' units at ' || cc.unit_price,
    'capital_receipt', v_al,
    jsonb_build_array(
      jsonb_build_object('account_id', v_bank.id, 'debit', v_amt, 'description', coalesce(p->>'reference', cc.call_no)),
      jsonb_build_object('account_id', f.capital_account_id, 'credit', v_amt, 'party_id', l.investor_party_id,
        'description', 'Capital contributed — ' || cc.call_no)),
    jsonb_build_object('line_id', l.id, 'amount', v_amt, 'units', v_units, 'reference', p->>'reference'), f.confidentiality);
  update public.unit_allotments set journal_id = v_j where id = v_al;
  return v_j;
end $$;

create or replace function numero_private.wf_capital_receipt(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.unit_allotments; s int; l public.capital_call_lines;
begin
  select * into a from public.unit_allotments where id = w.source_id for update;
  if p_event = 'voided' then
    update public.unit_allotments set status = 'rejected' where id = a.id;
    return;
  end if;
  s := case when p_event = 'posted' then 1 else -1 end;
  update public.capital_call_lines set received_amount = received_amount + s * a.amount, units_allotted = units_allotted + s * a.units
   where id = a.call_line_id returning * into l;
  update public.capital_call_lines set status = case when received_amount >= amount then 'received' when received_amount > 0 then 'part_received' else 'due' end
   where id = l.id;
  update public.fund_commitments set contributed_amount = contributed_amount + s * a.amount, units = units + s * a.units where id = a.commitment_id;
  update public.funds set units_outstanding = units_outstanding + s * a.units where id = a.fund_id;
  update public.unit_allotments set status = case when p_event = 'posted' then 'posted' else 'reversed' end where id = a.id;
  update public.capital_calls c set status = case when not exists (
           select 1 from public.capital_call_lines x where x.call_id = c.id and x.received_amount < x.amount) then 'closed' else 'approved' end
   where c.id = l.call_id and c.status in ('approved','closed');
end $$;

-- ---------------------------------------------------------------------
-- DIVIDENDS AND DISTRIBUTIONS: declaration → approval → entitlement → payment
-- ---------------------------------------------------------------------
create or replace function numero_private.save_distribution(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; d public.fund_distributions; f public.funds; a public.accounts;
        v_total numeric := round((p->>'total_amount')::numeric, 2); v_tax numeric := coalesce((p->>'tax_pct')::numeric, 0); v_kind text := p->>'kind';
        v_units numeric; v_left numeric; v_n int; v_i int := 0; h record; v_gross numeric; v_t numeric; v_rec date := (p->>'record_date')::date;
begin
  if not numero_private.can(v_company, 'investment.manage') then
    raise exception 'NUMERO: you are not authorised to prepare dividends or distributions.' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('dividend','distribution','return_of_capital') then raise exception 'NUMERO: state whether this is a dividend, a distribution or a return of capital.' using errcode = 'P0001'; end if;
  if (p->>'declaration_date') is null or v_rec is null then raise exception 'NUMERO: the date of declaration and the record date are required.' using errcode = 'P0001'; end if;
  if v_total is null or v_total <= 0 then raise exception 'NUMERO: the amount must be greater than zero.' using errcode = 'P0001'; end if;
  if v_tax < 0 or v_tax >= 100 then raise exception 'NUMERO: the rate of tax deducted is a percentage below 100.' using errcode = 'P0001'; end if;
  if p->>'fund_id' is not null then
    f := numero_private.fund_for((p->>'fund_id')::uuid, 'investment.manage', 'prepare distributions of this fund');
    if f.company_id <> v_company then raise exception 'NUMERO: the fund belongs to another company.' using errcode = 'P0001'; end if;
  elsif v_kind <> 'dividend' then
    raise exception 'NUMERO: a distribution or a return of capital belongs to a fund. A company declares a dividend.' using errcode = 'P0001';
  end if;
  select * into a from public.accounts where id = (p->>'source_account_id')::uuid;
  if not found or a.company_id <> v_company or a.is_group or not a.is_active or a.type <> 'equity' then
    raise exception 'NUMERO: choose the equity ledger the amount is paid out of.' using errcode = 'P0001';
  end if;
  if v_id is not null then
    select * into d from public.fund_distributions where id = v_id and company_id = v_company for update;
    if not found then raise exception 'NUMERO: record not found.' using errcode = 'P0001'; end if;
    if d.status not in ('draft','rejected') then raise exception 'NUMERO: only a draft can be edited. This one is %.', d.status using errcode = 'P0001'; end if;
    update public.fund_distributions set status = 'draft', fund_id = f.id, kind = v_kind, declaration_date = (p->>'declaration_date')::date, record_date = v_rec,
      payment_date = (p->>'payment_date')::date, total_amount = v_total, tax_pct = v_tax, source_account_id = a.id, notes = p->>'notes' where id = v_id;
    delete from public.distribution_lines where distribution_id = v_id;
  else
    insert into public.fund_distributions(company_id, fund_id, kind, dist_no, declaration_date, record_date, payment_date, total_amount, tax_pct, source_account_id, notes, confidentiality)
    values (v_company, f.id, v_kind, numero_private.next_doc_no(v_company, 'distribution', case when v_kind = 'dividend' then 'DIV' else 'DIST' end, (p->>'declaration_date')::date),
      (p->>'declaration_date')::date, v_rec, (p->>'payment_date')::date, v_total, v_tax, a.id, p->>'notes', coalesce(f.confidentiality, 'confidential'))
    returning id into v_id;
  end if;
  -- entitlement: in proportion to the units or shares held on the record date
  create temporary table if not exists _numero_holders (party uuid, commitment uuid, units numeric) on commit drop;
  truncate _numero_holders;
  if f.id is not null then
    insert into _numero_holders
    select c.investor_party_id, c.id, coalesce(sum(u.units), 0)
      from public.fund_commitments c join public.unit_allotments u on u.commitment_id = c.id and u.status = 'posted' and u.allot_date <= v_rec
     where c.fund_id = f.id group by c.investor_party_id, c.id having coalesce(sum(u.units), 0) > 0;
  else
    insert into _numero_holders
    select e.holder_party_id, null, sum(e.quantity) from public.equity_holders e where e.company_id = v_company group by e.holder_party_id having sum(e.quantity) > 0;
  end if;
  select coalesce(sum(units), 0), count(*) into v_units, v_n from _numero_holders;
  if v_n = 0 then
    raise exception 'NUMERO: nobody holds % on the record date, so nobody is entitled. Record the holders first.', case when f.id is not null then 'units of this fund' else 'shares of this company' end using errcode = 'P0001';
  end if;
  v_left := v_total;
  for h in select * from _numero_holders order by units desc, party loop
    v_i := v_i + 1;
    v_gross := case when v_i = v_n then v_left else round(v_total * h.units / v_units, 2) end;
    v_left := v_left - v_gross;
    v_t := round(v_gross * v_tax / 100, 2);
    insert into public.distribution_lines(distribution_id, company_id, holder_party_id, commitment_id, units, gross_amount, tax_deducted, net_amount)
    values (v_id, v_company, h.party, h.commitment, h.units, v_gross, v_t, v_gross - v_t);
  end loop;
  return v_id;
end $$;

create or replace function numero_private.submit_distribution(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.fund_distributions;
begin
  select * into d from public.fund_distributions where id = p_id for update;
  if not found then raise exception 'NUMERO: record not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'investment.manage') then
    raise exception 'NUMERO: you are not authorised to submit dividends or distributions.' using errcode = '42501';
  end if;
  if d.status <> 'draft' then raise exception 'NUMERO: only a draft can be submitted. This one is %.', d.status using errcode = 'P0001'; end if;
  perform numero_private.open_request(d.company_id, 'distribution', d.id, d.total_amount, initcap(replace(d.kind, '_', ' ')) || ' ' || d.dist_no);
  update public.fund_distributions set status = 'submitted' where id = p_id;
end $$;

-- Approval makes the amount owed to the holders: Dr equity · Cr payable to each holder. That entry is proposed here.
create or replace function numero_private.decide_distribution(p_id uuid, p_decision text, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare d public.fund_distributions; v text; v_lines jsonb; v_j uuid; v_pay uuid;
begin
  select * into d from public.fund_distributions where id = p_id for update;
  if not found then raise exception 'NUMERO: record not found.' using errcode = 'P0001'; end if;
  if not numero_private.can_view_level(d.company_id, d.confidentiality) then
    raise exception 'NUMERO: you are not cleared for this record.' using errcode = '42501';
  end if;
  if d.status <> 'submitted' then raise exception 'NUMERO: this is not awaiting approval. It is %.', d.status using errcode = 'P0001'; end if;
  if p_decision = 'rejected' then
    perform numero_private.refuse_request(d.company_id, 'distribution', d.id, 'investment.approve', replace(d.kind, '_', ' '), p_comment);
    update public.fund_distributions set status = 'rejected', decision_note = p_comment where id = p_id;
    return 'rejected';
  end if;
  v := numero_private.decide_request(d.company_id, 'distribution', d.id, d.created_by, 'investment.approve', replace(d.kind, '_', ' '), p_comment);
  if v = 'approved' then
    v_pay := numero_private.map_account(d.company_id, 'distribution_payable');
    select jsonb_build_array(jsonb_build_object('account_id', d.source_account_id, 'debit', d.total_amount,
             'description', initcap(replace(d.kind, '_', ' ')) || ' declared — ' || d.dist_no))
           || coalesce(jsonb_agg(jsonb_build_object('account_id', v_pay, 'credit', l.gross_amount, 'party_id', l.holder_party_id,
                'description', 'Entitlement — ' || d.dist_no) order by l.id), '[]'::jsonb)
      into v_lines from public.distribution_lines l where l.distribution_id = d.id;
    update public.fund_distributions set status = 'approved', approved_by = (select auth.uid()), approved_at = now(), decision_note = p_comment where id = p_id;
    v_j := numero_private.propose_posting(d.company_id, 'journal', d.declaration_date,
      initcap(replace(d.kind, '_', ' ')) || ' ' || d.dist_no || ' declared: ' || d.total_amount || ' to the holders on record on ' || d.record_date,
      'distribution', d.id, v_lines, jsonb_build_object('amount', d.total_amount), d.confidentiality);
    update public.fund_distributions set journal_id = v_j where id = p_id;
  end if;
  return v;
end $$;

create or replace function numero_private.wf_distribution(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event = 'posted' then
    update public.fund_distributions set status = 'declared' where id = w.source_id;
  elsif p_event = 'voided' then
    update public.fund_distributions set status = 'rejected', journal_id = null,
           decision_note = 'The accounting entry of the declaration was rejected.' where id = w.source_id;
  elsif p_event = 'reversed' then
    if exists (select 1 from public.distribution_lines l where l.distribution_id = w.source_id and l.status <> 'entitled') then
      raise exception 'NUMERO: payments have been made or proposed on this declaration. Reverse them first.' using errcode = 'P0001';
    end if;
    update public.fund_distributions set status = 'cancelled' where id = w.source_id;
  end if;
end $$;

-- Payment to the holders: Dr payable (gross) · Cr bank (net) · Cr tax deducted. NUMERO records that the money was paid; it pays nothing.
create or replace function numero_private.propose_distribution_payment(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.fund_distributions; v_bank public.accounts; v_date date := (p->>'date')::date; v_ids uuid[]; v_lines jsonb := '[]'::jsonb;
        v_pay uuid; l record; v_gross numeric := 0; v_tax numeric := 0; v_j uuid;
begin
  select * into d from public.fund_distributions where id = (p->>'distribution_id')::uuid for update;
  if not found then raise exception 'NUMERO: record not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'investment.manage') then
    raise exception 'NUMERO: you are not authorised to record these payments.' using errcode = '42501';
  end if;
  if not numero_private.can_view_level(d.company_id, d.confidentiality) then
    raise exception 'NUMERO: you are not cleared for this record.' using errcode = '42501';
  end if;
  if d.status not in ('declared','part_paid') then
    raise exception 'NUMERO: payment follows the declaration. This % is %.', replace(d.kind, '_', ' '), d.status using errcode = 'P0001';
  end if;
  if v_date is null then raise exception 'NUMERO: the date of payment is required.' using errcode = 'P0001'; end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> d.company_id or coalesce(v_bank.control_type, '') <> 'bank' then
    raise exception 'NUMERO: choose the bank ledger the payment was made from.' using errcode = 'P0001';
  end if;
  select array_agg(x.id) into v_ids from public.distribution_lines x
   where x.distribution_id = d.id and x.status = 'entitled'
     and (p->'line_ids' is null or jsonb_typeof(p->'line_ids') <> 'array' or x.id in (select (e.value)::uuid from jsonb_array_elements_text(p->'line_ids') e));
  if v_ids is null then raise exception 'NUMERO: nothing is left to pay on this declaration.' using errcode = 'P0001'; end if;
  v_pay := numero_private.map_account(d.company_id, 'distribution_payable');
  for l in select * from public.distribution_lines where id = any(v_ids) order by id loop
    v_lines := v_lines || jsonb_build_object('account_id', v_pay, 'debit', l.gross_amount, 'party_id', l.holder_party_id, 'description', 'Paid — ' || d.dist_no);
    v_gross := v_gross + l.gross_amount; v_tax := v_tax + l.tax_deducted;
  end loop;
  v_lines := v_lines || jsonb_build_object('account_id', v_bank.id, 'credit', v_gross - v_tax, 'description', coalesce(p->>'reference', d.dist_no));
  if v_tax > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', numero_private.map_account(d.company_id, 'tds_payable'), 'credit', v_tax, 'description', 'Tax deducted at source — ' || d.dist_no);
  end if;
  v_j := numero_private.propose_posting(d.company_id, 'payment', v_date,
    initcap(replace(d.kind, '_', ' ')) || ' ' || d.dist_no || ' paid to ' || array_length(v_ids, 1) || ' holder(s)', 'distribution_payment', d.id, v_lines,
    jsonb_build_object('line_ids', to_jsonb(v_ids), 'amount', v_gross, 'date', v_date), d.confidentiality);
  update public.distribution_lines set status = 'payment_proposed', payment_journal_id = v_j where id = any(v_ids);
  return v_j;
end $$;

create or replace function numero_private.wf_distribution_payment(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; s int;
begin
  select array_agg((e.value)::uuid) into v_ids from jsonb_array_elements_text(w.payload->'line_ids') e;
  if p_event = 'voided' then
    update public.distribution_lines set status = 'entitled', payment_journal_id = null where id = any(v_ids);
    return;
  end if;
  s := case when p_event = 'posted' then 1 else -1 end;
  update public.distribution_lines set status = case when s = 1 then 'paid' else 'entitled' end,
         paid_on = case when s = 1 then (w.payload->>'date')::date end,
         payment_journal_id = case when s = 1 then w.journal_id end
   where id = any(v_ids);
  update public.fund_commitments c set distributed_amount = c.distributed_amount + s * l.gross_amount
    from public.distribution_lines l where l.id = any(v_ids) and l.commitment_id = c.id;
  update public.fund_distributions d set status = case
           when not exists (select 1 from public.distribution_lines x where x.distribution_id = d.id and x.status <> 'paid') then 'paid'
           when exists (select 1 from public.distribution_lines x where x.distribution_id = d.id and x.status = 'paid') then 'part_paid'
           else 'declared' end
   where d.id = w.source_id;
end $$;

-- ---------------------------------------------------------------------
-- NET ASSET VALUE — worked out from the books of the fund's company, and approved by a second person
-- ---------------------------------------------------------------------
create or replace function numero_private.prepare_nav(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.funds; v_date date := (p->>'nav_date')::date; v_assets numeric; v_liab numeric; v_units numeric; v_id uuid; v_stale int; v_cost numeric; v_pending int;
begin
  f := numero_private.fund_for((p->>'fund_id')::uuid, 'investment.manage', 'prepare the net asset value');
  if v_date is null then raise exception 'NUMERO: the date is required.' using errcode = 'P0001'; end if;
  if (select count(*) from public.funds x where x.company_id = f.company_id and x.status <> 'wound_up') > 1 then
    raise exception 'NUMERO: the net asset value is worked out from the books of the fund''s company. Several funds share this company, so their net assets cannot be told apart. Give each fund a company of its own.' using errcode = 'P0001';
  end if;
  select coalesce(sum(l.debit - l.credit) filter (where a.type = 'asset'), 0), coalesce(sum(l.credit - l.debit) filter (where a.type = 'liability'), 0)
    into v_assets, v_liab
    from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
   where j.company_id = f.company_id and j.status in ('posted','reversed') and j.journal_date <= v_date;
  select coalesce(sum(u.units), 0) into v_units from public.unit_allotments u where u.fund_id = f.id and u.status = 'posted' and u.allot_date <= v_date;
  select count(*) filter (where h.measurement = 'cost' or h.fair_value_date is null or h.fair_value_date < v_date - 92), coalesce(sum(h.cost) filter (where h.measurement = 'cost'), 0)
    into v_stale, v_cost from public.holdings h where h.company_id = f.company_id and h.status = 'active';
  select count(*) into v_pending from public.journals j where j.company_id = f.company_id and j.status = 'submitted' and j.journal_date <= v_date;
  update public.nav_runs set status = 'superseded' where fund_id = f.id and nav_date = v_date and status = 'draft';
  insert into public.nav_runs(fund_id, company_id, nav_date, total_assets, total_liabilities, net_assets, units, nav_per_unit, basis, note)
  values (f.id, f.company_id, v_date, v_assets, v_liab, v_assets - v_liab, v_units,
          case when v_units > 0 then round((v_assets - v_liab) / v_units, 6) end,
          jsonb_build_object(
            'formula', 'Net asset value per unit = (assets − liabilities, from posted entries up to the date) ÷ units issued up to the date',
            'holdings_not_at_recent_fair_value', v_stale, 'holdings_carried_at_cost', v_cost, 'entries_awaiting_approval', v_pending,
            'caution', 'This is an accounting figure from the books as they stand. It is not a regulatory valuation. Holdings carried at cost, or valued more than three months before the date, are included at their book amount.'),
          p->>'note')
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.decide_nav(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.nav_runs; f public.funds;
begin
  select * into n from public.nav_runs where id = p_id for update;
  if not found then raise exception 'NUMERO: record not found.' using errcode = 'P0001'; end if;
  f := numero_private.fund_for(n.fund_id, 'investment.approve', 'approve the net asset value');
  if n.status <> 'draft' then raise exception 'NUMERO: this net asset value is %.', n.status using errcode = 'P0001'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'NUMERO: the decision is approved or rejected.' using errcode = 'P0001'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'NUMERO: a reason is required to reject.' using errcode = 'P0001'; end if;
  perform numero_private.check_maker_checker(n.company_id, n.prepared_by, 'net asset value');
  if p_decision = 'approved' then
    update public.nav_runs set status = 'superseded' where fund_id = n.fund_id and nav_date = n.nav_date and status = 'approved';
  end if;
  update public.nav_runs set status = p_decision, approved_by = (select auth.uid()), approved_at = now(), note = coalesce(p_note, note) where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- MANAGEMENT FEE — Dr fee expense · Cr payable to the manager
-- ---------------------------------------------------------------------
create or replace function numero_private.propose_fund_fee(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.funds; v_from date := (p->>'period_from')::date; v_to date := (p->>'period_to')::date; v_basis numeric; v_amt numeric; v_id uuid; v_j uuid;
begin
  f := numero_private.fund_for((p->>'fund_id')::uuid, 'investment.manage', 'propose the management fee');
  if v_from is null or v_to is null or v_to < v_from then raise exception 'NUMERO: state the period the fee covers.' using errcode = 'P0001'; end if;
  if f.fee_pct is null or f.fee_pct = 0 then raise exception 'NUMERO: this fund records no rate of management fee.' using errcode = 'P0001'; end if;
  if f.manager_party_id is null then raise exception 'NUMERO: this fund names no manager to whom the fee is owed.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.fund_fees x where x.fund_id = f.id and x.status in ('proposed','posted') and x.period_from <= v_to and x.period_to >= v_from) then
    raise exception 'NUMERO: a fee has already been proposed or posted for part of this period.' using errcode = 'P0001';
  end if;
  v_basis := case f.fee_basis
    when 'committed' then (select coalesce(sum(committed_amount), 0) from public.fund_commitments where fund_id = f.id and status = 'active')
    when 'contributed' then (select coalesce(sum(contributed_amount), 0) from public.fund_commitments where fund_id = f.id)
    else (select n.net_assets from public.nav_runs n where n.fund_id = f.id and n.status = 'approved' and n.nav_date <= v_to order by n.nav_date desc limit 1) end;
  if v_basis is null then raise exception 'NUMERO: the fee of this fund rests on its net asset value, and no approved net asset value exists up to %.', v_to using errcode = 'P0001'; end if;
  v_amt := round(v_basis * f.fee_pct / 100 * (v_to - v_from + 1) / 365.0, 2);
  if v_amt <= 0 then raise exception 'NUMERO: the fee works out to nothing: the basis is %.', v_basis using errcode = 'P0001'; end if;
  insert into public.fund_fees(fund_id, company_id, period_from, period_to, basis, basis_amount, rate, amount)
  values (f.id, f.company_id, v_from, v_to, f.fee_basis, v_basis, f.fee_pct, v_amt) returning id into v_id;
  v_j := numero_private.propose_posting(f.company_id, 'journal', v_to,
    'Management fee of ' || f.name || ', ' || v_from || ' to ' || v_to || ': ' || f.fee_pct || '% a year on ' || f.fee_basis || ' capital of ' || v_basis,
    'fund_fee', v_id,
    jsonb_build_array(
      jsonb_build_object('account_id', numero_private.map_account(f.company_id, 'management_fee_expense'), 'debit', v_amt, 'description', 'Management fee — ' || f.name),
      jsonb_build_object('account_id', numero_private.map_account(f.company_id, 'ap_control'), 'credit', v_amt, 'party_id', f.manager_party_id, 'description', 'Management fee payable — ' || f.name)),
    jsonb_build_object('amount', v_amt, 'formula', 'basis × rate × days ÷ 365', 'basis', v_basis, 'rate', f.fee_pct, 'days', v_to - v_from + 1), f.confidentiality);
  update public.fund_fees set journal_id = v_j where id = v_id;
  return v_j;
end $$;

create or replace function numero_private.wf_fund_fee(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.fund_fees set status = case p_event when 'posted' then 'posted' when 'voided' then 'rejected' else 'reversed' end where id = w.source_id;
end $$;

create or replace function public.save_fund(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_fund(p); $$;
create or replace function public.save_commitment(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_commitment(p); $$;
create or replace function public.save_capital_call(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_capital_call(p); $$;
create or replace function public.submit_capital_call(p_id uuid) returns void language sql set search_path = '' as $$ select numero_private.submit_capital_call(p_id); $$;
create or replace function public.decide_capital_call(p_id uuid, p_decision text, p_comment text default null) returns text language sql set search_path = '' as $$ select numero_private.decide_capital_call(p_id, p_decision, p_comment); $$;
create or replace function public.propose_capital_receipt(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.propose_capital_receipt(p); $$;
create or replace function public.save_distribution(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_distribution(p); $$;
create or replace function public.submit_distribution(p_id uuid) returns void language sql set search_path = '' as $$ select numero_private.submit_distribution(p_id); $$;
create or replace function public.decide_distribution(p_id uuid, p_decision text, p_comment text default null) returns text language sql set search_path = '' as $$ select numero_private.decide_distribution(p_id, p_decision, p_comment); $$;
create or replace function public.propose_distribution_payment(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.propose_distribution_payment(p); $$;
create or replace function public.prepare_nav(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.prepare_nav(p); $$;
create or replace function public.decide_nav(p_id uuid, p_decision text, p_note text default null) returns void language sql set search_path = '' as $$ select numero_private.decide_nav(p_id, p_decision, p_note); $$;
create or replace function public.propose_fund_fee(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.propose_fund_fee(p); $$;

insert into numero_private.internal_functions(name) values ('fund_for') on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927142532 · p3_18_fund_fee_payable
-- The management fee of a fund is owed to its manager before any bill exists.
-- It was credited to the vendor control ledger, which is kept equal to the open bills.
-- It is now credited to a ledger of its own (account map key: management_fee_payable);
-- the bill of the manager, when it arrives, is coded to that ledger and paid like any other bill.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('numero_private.propose_fund_fee(jsonb)'::regprocedure);
  v_new := replace(v_def, 'numero_private.map_account(f.company_id, ''ap_control'')', 'numero_private.map_account(f.company_id, ''management_fee_payable'')');
  if v_new = v_def then raise exception 'p3_18: propose_fund_fee was not changed'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema numero_private from public, anon, authenticated;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927151621 · p3_21_fund_fee_days_passed
-- A management fee is charged for days that have passed. A period that ends after today was accepted before.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('numero_private.propose_fund_fee(jsonb)'::regprocedure);
  v_new := replace(v_def,
    'if f.fee_pct is null or f.fee_pct = 0 then',
    'if v_to > current_date then raise exception ''NUMERO: a fee is charged for days that have passed. The period ends after today.'' using errcode = ''P0001''; end if;' || E'\n  ' || 'if f.fee_pct is null or f.fee_pct = 0 then');
  if v_new = v_def then raise exception 'p3_21: propose_fund_fee was not changed'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema numero_private from public, anon, authenticated;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();
