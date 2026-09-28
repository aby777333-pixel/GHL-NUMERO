-- >>> applied as migration 20260927130625 · p3_09_reality_control_tables
-- =====================================================================
-- GHL NUMERO · 0016 · REALITY AND CONTROL — TABLES
-- Spec: 482, 575, 780, 1245, 1385, 1389, 1454-1468, 1489, 1557, 1581, 1729
--
-- The books saying something happened is not enough. These records hold
-- what a person found when the books were set against the document, the
-- operation, the cash and the physical world — and what was done about it.
-- A case is opened, followed and closed by people. Nothing here alters a
-- posted entry, and nothing here calls a difference a fraud.
-- =====================================================================
create table public.materiality (
  company_id uuid primary key references public.companies(id),
  amount numeric(20,4) not null check (amount >= 0),
  pct numeric(9,4) check (pct is null or (pct >= 0 and pct <= 100)),
  note text,
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now()
);

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  case_no text not null,
  kind text not null default 'reality' check (kind in ('reality','sentinel','incident','verification','confirmation','other')),
  title text not null,
  summary text,
  status text not null default 'open'
    check (status in ('open','triage','under_review','investigating','substantiated','unsubstantiated','remediated','closed')),
  attention text not null default 'finance_action'
    check (attention in ('information','finance_action','management_action','owner_action','critical')),
  amount numeric(20,4),
  owner_user uuid references public.profiles(id),
  owner_name text,
  links jsonb not null default '[]'::jsonb,
  finding jsonb not null default '{}'::jsonb,
  dedupe_key text,
  alert_id uuid references public.alerts(id),
  confidentiality text not null default 'internal'
    check (confidentiality in ('internal','confidential','highly_confidential','restricted','super_admin_only')),
  resolution text,
  opened_by uuid default auth.uid(),
  opened_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  unique (company_id, case_no),
  unique (company_id, dedupe_key)
);
create index cases_company_idx on public.cases(company_id, status, opened_at desc);

create table public.case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.cases(id),
  company_id uuid not null references public.companies(id),
  event text not null check (event in ('opened','status','note','link','owner','attention','reopened')),
  from_status text,
  to_status text,
  note text,
  detail jsonb not null default '{}'::jsonb,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);
create index case_events_case_idx on public.case_events(case_id, at);

create table public.verification_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  verify_no text not null,
  subject text not null check (subject in ('assets','inventory','cash','documents')),
  run_date date not null,
  scope jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  performed_by_name text,
  witness_name text,
  note text,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  completed_by uuid,
  completed_at timestamptz,
  unique (company_id, verify_no)
);

create table public.verification_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.verification_runs(id),
  company_id uuid not null references public.companies(id),
  entity text not null,
  entity_id uuid not null,
  sub_id uuid,
  label text not null,
  place text,
  book_qty numeric(20,4),
  book_value numeric(20,4),
  found_qty numeric(20,4),
  found_value numeric(20,4),
  result text not null default 'not_checked'
    check (result in ('not_checked','located','matched','difference','transferred','damaged','missing','disposed')),
  note text
);
create index verification_lines_run_idx on public.verification_lines(run_id);

create table public.confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  confirm_no text not null,
  subject text not null check (subject in ('bank','customer','vendor','loan','deposit','investment','intercompany')),
  party_id uuid references public.parties(id),
  counter_company_id uuid references public.companies(id),
  entity text,
  entity_id uuid,
  label text not null,
  as_of date not null,
  currency text not null references public.currencies(code),
  book_balance numeric(20,4) not null,
  book_basis text not null,
  confirmed_balance numeric(20,4),
  difference numeric(20,4) generated always as (confirmed_balance - book_balance) stored,
  status text not null default 'drafted'
    check (status in ('drafted','sent','agreed','difference','explained','disputed','no_reply','cancelled')),
  contact text,
  sent_on date,
  sent_how text,
  received_on date,
  document_id uuid references public.documents(id),
  explanation text,
  confidentiality text not null default 'internal',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, confirm_no)
);
create index confirmations_company_idx on public.confirmations(company_id, status, as_of desc);

-- A reclassification never touches the original entry. It moves the amount by a new entry and keeps both.
create table public.reclassifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  journal_id uuid not null references public.journals(id),
  line_id uuid not null references public.journal_lines(id),
  from_account_id uuid not null references public.accounts(id),
  to_account_id uuid not null references public.accounts(id),
  amount numeric(20,4) not null check (amount > 0),
  side text not null check (side in ('debit','credit')),
  reclass_date date not null,
  reason text not null,
  status text not null default 'proposed' check (status in ('proposed','posted','rejected','reversed')),
  new_journal_id uuid references public.journals(id),
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index reclassifications_line_idx on public.reclassifications(line_id);

-- Every allocated cost explains itself: source, amount, driver, formula, recipients, period.
create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  alloc_no text not null,
  name text not null,
  period_from date not null,
  period_to date not null,
  source_account_id uuid not null references public.accounts(id),
  source_org_unit_id uuid references public.org_units(id),
  dimension_type text not null,
  pool_balance numeric(20,4) not null,
  amount numeric(20,4) not null check (amount > 0),
  driver text not null check (driver in ('headcount','revenue','area','usage','equal','manual')),
  driver_note text,
  formula text not null,
  recipients jsonb not null,
  status text not null default 'draft' check (status in ('draft','proposed','posted','rejected','reversed','cancelled')),
  journal_id uuid references public.journals(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, alloc_no),
  check (period_to >= period_from)
);

-- ---------- audit ----------
create trigger audit_materiality after insert or update or delete on public.materiality for each row execute function numero_private.audit_row();
create trigger audit_cases after insert or update or delete on public.cases for each row execute function numero_private.audit_row();
create trigger audit_verification_runs after insert or update or delete on public.verification_runs for each row execute function numero_private.audit_row();
create trigger audit_confirmations after insert or update or delete on public.confirmations for each row execute function numero_private.audit_row();
create trigger audit_reclassifications after insert or update or delete on public.reclassifications for each row execute function numero_private.audit_row();
create trigger audit_allocations after insert or update or delete on public.allocations for each row execute function numero_private.audit_row();

-- the history of a case is never rewritten
create or replace function numero_private.guard_case_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'NUMERO: the history of a case cannot be changed or removed.' using errcode = 'P0001';
end $$;
create trigger guard_case_event before update or delete on public.case_events for each row execute function numero_private.guard_case_event();

-- a case is never deleted
create or replace function numero_private.guard_case() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'NUMERO: a case is never deleted. Close it with its resolution.' using errcode = 'P0001';
end $$;
create trigger guard_case before delete on public.cases for each row execute function numero_private.guard_case();

-- ---------- row level security ----------
alter table public.materiality enable row level security;
alter table public.cases enable row level security;
alter table public.case_events enable row level security;
alter table public.verification_runs enable row level security;
alter table public.verification_lines enable row level security;
alter table public.confirmations enable row level security;
alter table public.reclassifications enable row level security;
alter table public.allocations enable row level security;

create policy materiality_select on public.materiality for select to authenticated
  using ((select numero_private.has_company_access(company_id)));
create policy cases_select on public.cases for select to authenticated
  using (((kind in ('sentinel','incident') and (select numero_private.can(company_id, 'sentinel.view')))
          or (select numero_private.can(company_id, 'reality.view')))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy case_events_select on public.case_events for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id));
create policy verification_runs_select on public.verification_runs for select to authenticated
  using ((select numero_private.can(company_id, 'reality.view')));
create policy verification_lines_select on public.verification_lines for select to authenticated
  using ((select numero_private.can(company_id, 'reality.view')));
create policy confirmations_select on public.confirmations for select to authenticated
  using ((select numero_private.can(company_id, 'reality.view')) and (select numero_private.can_view_level(company_id, confidentiality)));
create policy reclassifications_select on public.reclassifications for select to authenticated
  using (exists (select 1 from public.journals j where j.id = journal_id));
create policy allocations_select on public.allocations for select to authenticated
  using ((select numero_private.can(company_id, 'journal.view')));

insert into numero_private.internal_functions(name) values ('guard_case_event'), ('guard_case') on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927130936 · p3_10_reality_control_functions
-- =====================================================================
-- REALITY AND CONTROL — functions
-- =====================================================================

-- ---------- materiality (spec 482): a threshold for attention, never a reason to erase ----------
create or replace function numero_private.set_materiality(p_company uuid, p_amount numeric, p_pct numeric, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (numero_private.can(p_company, 'company.configure') or numero_private.can(p_company, 'reality.manage')) then
    raise exception 'NUMERO: you are not authorised to set the materiality threshold.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'NUMERO: the threshold is an amount of zero or more.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'NUMERO: record the basis of the threshold.' using errcode = 'P0001'; end if;
  perform set_config('numero.reason', p_note, true);
  insert into public.materiality(company_id, amount, pct, note) values (p_company, round(p_amount, 2), p_pct, p_note)
  on conflict (company_id) do update set amount = excluded.amount, pct = excluded.pct, note = excluded.note, set_by = (select auth.uid()), set_at = now();
end $$;

create or replace function numero_private.is_material(p_company uuid, p_difference numeric) returns boolean
language sql stable security definer set search_path = '' as $$
  select abs(coalesce(p_difference, 0)) > coalesce((select m.amount from public.materiality m where m.company_id = p_company), 0);
$$;

-- ---------- cases (spec 780, 1462) ----------
create or replace function numero_private.case_perm(p_company uuid, p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_kind in ('sentinel','incident') then numero_private.can(p_company, 'sentinel.review')
              else numero_private.can(p_company, 'reality.manage') end;
$$;

create or replace function numero_private.open_case(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_kind text := coalesce(p->>'kind', 'reality'); v_id uuid; v_level text := coalesce(p->>'confidentiality', 'internal');
        al public.alerts; k jsonb;
begin
  if v_kind not in ('reality','sentinel','incident','verification','confirmation','other') then raise exception 'NUMERO: unknown kind of case.' using errcode = 'P0001'; end if;
  if not numero_private.case_perm(v_company, v_kind) then
    raise exception 'NUMERO: you are not authorised to open a case.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'NUMERO: a case needs a title.' using errcode = 'P0001'; end if;
  if v_level <> 'internal' and not numero_private.can_view_level(v_company, v_level) then
    raise exception 'NUMERO: you cannot create records at a confidentiality level you are not cleared for.' using errcode = '42501';
  end if;
  if coalesce(p->>'attention', 'finance_action') not in ('information','finance_action','management_action','owner_action','critical') then
    raise exception 'NUMERO: unknown class of attention.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p->'links', '[]'::jsonb)) <> 'array' then raise exception 'NUMERO: the linked records must be a list.' using errcode = 'P0001'; end if;
  for k in select * from jsonb_array_elements(coalesce(p->'links', '[]'::jsonb)) loop
    if coalesce(k->>'entity', '') = '' or (k->>'entity_id') is null then
      raise exception 'NUMERO: each linked record names its kind and its record.' using errcode = 'P0001';
    end if;
  end loop;
  if p->>'dedupe_key' is not null then
    select id into v_id from public.cases where company_id = v_company and dedupe_key = p->>'dedupe_key';
    if v_id is not null then return v_id; end if;      -- the same difference is one case, however often it is found
  end if;
  if p->>'alert_id' is not null then
    select * into al from public.alerts where id = (p->>'alert_id')::uuid and company_id = v_company;
    if not found then raise exception 'NUMERO: the alert belongs to another company.' using errcode = 'P0001'; end if;
  end if;
  insert into public.cases(company_id, case_no, kind, title, summary, attention, amount, owner_user, owner_name, links, finding, dedupe_key, alert_id, confidentiality)
  values (v_company, numero_private.next_doc_no(v_company, 'case', 'CASE', current_date), v_kind, trim(p->>'title'), p->>'summary',
          coalesce(p->>'attention', 'finance_action'), (p->>'amount')::numeric, (p->>'owner_user')::uuid, p->>'owner_name',
          coalesce(p->'links', '[]'::jsonb), coalesce(p->'finding', '{}'::jsonb), p->>'dedupe_key', al.id, v_level)
  returning id into v_id;
  insert into public.case_events(case_id, company_id, event, to_status, note) values (v_id, v_company, 'opened', 'open', p->>'summary');
  if al.id is not null and al.status = 'open' then
    update public.alerts set status = 'reviewing', reviewed_by = (select auth.uid()), reviewed_at = now(),
           review_note = 'A case was opened.' where id = al.id;
  end if;
  return v_id;
end $$;

create or replace function numero_private.update_case(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_to text := p->>'status'; v_note text := nullif(trim(coalesce(p->>'note', '')), ''); k jsonb;
begin
  select * into c from public.cases where id = (p->>'id')::uuid for update;
  if not found then raise exception 'NUMERO: case not found.' using errcode = 'P0001'; end if;
  if not numero_private.case_perm(c.company_id, c.kind) then
    raise exception 'NUMERO: you are not authorised to work on this case.' using errcode = '42501';
  end if;
  if not numero_private.can_view_level(c.company_id, c.confidentiality) then
    raise exception 'NUMERO: you are not cleared for this case.' using errcode = '42501';
  end if;

  if v_to is not null and v_to <> c.status then
    if v_to not in ('open','triage','under_review','investigating','substantiated','unsubstantiated','remediated','closed') then
      raise exception 'NUMERO: unknown status.' using errcode = 'P0001';
    end if;
    if v_note is null then raise exception 'NUMERO: a change of status records what was found or decided.' using errcode = 'P0001'; end if;
    if v_to = 'closed' and coalesce(trim(coalesce(p->>'resolution', c.resolution)), '') = '' then
      raise exception 'NUMERO: a case is closed with its resolution.' using errcode = 'P0001';
    end if;
    insert into public.case_events(case_id, company_id, event, from_status, to_status, note)
    values (c.id, c.company_id, case when c.status = 'closed' then 'reopened' else 'status' end, c.status, v_to, v_note);
    update public.cases set status = v_to, resolution = coalesce(p->>'resolution', resolution),
           closed_at = case when v_to = 'closed' then now() end, closed_by = case when v_to = 'closed' then (select auth.uid()) end
     where id = c.id;
    if c.alert_id is not null and v_to in ('unsubstantiated','remediated','closed') then
      update public.alerts set status = case when v_to = 'unsubstantiated' then 'false_positive' else 'resolved' end,
             reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = v_note
       where id = c.alert_id and status in ('open','reviewing');
    end if;
  elsif v_note is not null then
    insert into public.case_events(case_id, company_id, event, note) values (c.id, c.company_id, 'note', v_note);
  end if;

  if p ? 'owner_user' or p ? 'owner_name' then
    update public.cases set owner_user = (p->>'owner_user')::uuid, owner_name = p->>'owner_name' where id = c.id;
    insert into public.case_events(case_id, company_id, event, note, detail)
    values (c.id, c.company_id, 'owner', v_note, jsonb_build_object('owner_user', p->>'owner_user', 'owner_name', p->>'owner_name'));
  end if;
  if p ? 'attention' and p->>'attention' <> c.attention then
    if p->>'attention' not in ('information','finance_action','management_action','owner_action','critical') then
      raise exception 'NUMERO: unknown class of attention.' using errcode = 'P0001';
    end if;
    update public.cases set attention = p->>'attention' where id = c.id;
    insert into public.case_events(case_id, company_id, event, note, detail)
    values (c.id, c.company_id, 'attention', v_note, jsonb_build_object('from', c.attention, 'to', p->>'attention'));
  end if;
  if jsonb_typeof(p->'add_links') = 'array' then
    for k in select * from jsonb_array_elements(p->'add_links') loop
      if coalesce(k->>'entity', '') = '' or (k->>'entity_id') is null then
        raise exception 'NUMERO: each linked record names its kind and its record.' using errcode = 'P0001';
      end if;
      update public.cases set links = links || jsonb_build_array(k) where id = c.id
         and not exists (select 1 from jsonb_array_elements(links) x where x->>'entity' = k->>'entity' and x->>'entity_id' = k->>'entity_id');
      insert into public.case_events(case_id, company_id, event, note, detail) values (c.id, c.company_id, 'link', v_note, k);
    end loop;
  end if;
end $$;

-- ---------- physical verification (spec 575, 1385, 1387) ----------
create or replace function numero_private.ledger_balance_at(p_company uuid, p_account uuid, p_to date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.debit - l.credit), 0)
    from public.journal_lines l join public.journals j on j.id = l.journal_id
   where l.company_id = p_company and l.account_id = p_account and j.status in ('posted','reversed') and j.journal_date <= p_to;
$$;

create or replace function numero_private.open_verification(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_subject text := p->>'subject'; v_date date := coalesce((p->>'run_date')::date, current_date);
        v_id uuid; s jsonb := coalesce(p->'scope', '{}'::jsonb); v_n int;
begin
  if not numero_private.can(v_company, 'reality.manage') then
    raise exception 'NUMERO: you are not authorised to carry out a verification.' using errcode = '42501';
  end if;
  if v_subject is null or v_subject not in ('assets','inventory','cash','documents') then
    raise exception 'NUMERO: state what is verified: assets, inventory, cash or documents.' using errcode = 'P0001';
  end if;
  if v_subject = 'inventory' and not exists (
       select 1 from public.warehouses w where w.id = (s->>'warehouse_id')::uuid and w.company_id = v_company) then
    raise exception 'NUMERO: choose the location whose stock is verified.' using errcode = 'P0001';
  end if;
  insert into public.verification_runs(company_id, verify_no, subject, run_date, scope, performed_by_name, witness_name, note)
  values (v_company, numero_private.next_doc_no(v_company, 'verification', 'VER', v_date), v_subject, v_date, s,
          p->>'performed_by_name', p->>'witness_name', p->>'note')
  returning id into v_id;

  if v_subject = 'assets' then
    insert into public.verification_lines(run_id, company_id, entity, entity_id, label, place, book_qty, book_value)
    select v_id, v_company, 'fixed_assets', a.id, a.asset_no || ' · ' || a.name,
           nullif(concat_ws(' · ', a.location, (select u.name from public.org_units u where u.id = a.org_unit_id)), ''), 1,
           a.cost - a.accumulated_depreciation
      from public.fixed_assets a
     where a.company_id = v_company and a.status = 'active'
       and numero_private.can_view_level(v_company, a.confidentiality)
       and (s->>'category_id' is null or a.category_id = (s->>'category_id')::uuid)
       and (s->>'org_unit_id' is null or a.org_unit_id = (s->>'org_unit_id')::uuid)
       and (coalesce(s->>'location', '') = '' or a.location ilike '%' || (s->>'location') || '%');
  elsif v_subject = 'inventory' then
    insert into public.verification_lines(run_id, company_id, entity, entity_id, sub_id, label, place, book_qty, book_value)
    select v_id, v_company, 'inv_items', m.item_id, m.lot_id,
           i.sku || ' · ' || i.name || coalesce(' · ' || (select lt.lot_no from public.inv_lots lt where lt.id = m.lot_id), ''),
           (select w.code from public.warehouses w where w.id = m.warehouse_id), sum(m.qty),
           round(sum(m.qty) * case when i.qty_on_hand = 0 then 0 else i.value_on_hand / i.qty_on_hand end, 2)
      from public.inv_movements m join public.inv_items i on i.id = m.item_id
     where m.warehouse_id = (s->>'warehouse_id')::uuid and m.status = 'posted'
     group by m.item_id, m.lot_id, m.warehouse_id, i.sku, i.name, i.qty_on_hand, i.value_on_hand
    having sum(m.qty) <> 0;
  elsif v_subject = 'cash' then
    insert into public.verification_lines(run_id, company_id, entity, entity_id, label, place, book_value)
    select v_id, v_company, 'cash_boxes', b.id, b.name, b.custodian_name, numero_private.ledger_balance_at(v_company, b.ledger_account_id, v_date)
      from public.cash_boxes b where b.company_id = v_company and b.is_active
       and (s->>'box_id' is null or b.id = (s->>'box_id')::uuid);
  else
    insert into public.verification_lines(run_id, company_id, entity, entity_id, label, place, book_value)
    select v_id, v_company, 'documents', d.id, d.name || coalesce(' · ' || d.reference, ''), d.doc_kind, d.amount
      from public.documents d
     where d.company_id = v_company and d.status <> 'rejected' and numero_private.can_view_level(v_company, d.confidentiality)
       and (s->>'doc_kind' is null or d.doc_kind = s->>'doc_kind')
       and (s->>'party_id' is null or d.party_id = (s->>'party_id')::uuid);
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'NUMERO: nothing in the books falls within what was chosen, so there is nothing to verify.' using errcode = 'P0001'; end if;
  return v_id;
end $$;

create or replace function numero_private.record_verification(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare r public.verification_runs; l jsonb; v_res text; v_n int := 0; ln public.verification_lines;
begin
  select * into r from public.verification_runs where id = (p->>'run_id')::uuid for update;
  if not found then raise exception 'NUMERO: verification not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(r.company_id, 'reality.manage') then
    raise exception 'NUMERO: you are not authorised to carry out a verification.' using errcode = '42501';
  end if;
  if r.status <> 'open' then raise exception 'NUMERO: this verification is %.', r.status using errcode = 'P0001'; end if;
  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    select * into ln from public.verification_lines where id = (l->>'id')::uuid and run_id = r.id;
    if not found then raise exception 'NUMERO: a line does not belong to this verification.' using errcode = 'P0001'; end if;
    v_res := l->>'result';
    if r.subject in ('inventory','cash') then
      -- what was found decides the result: it either agrees with the books or it does not
      if r.subject = 'inventory' and (l->>'found_qty') is null then raise exception 'NUMERO: state the quantity found for %.', ln.label using errcode = 'P0001'; end if;
      if r.subject = 'cash' and (l->>'found_value') is null then raise exception 'NUMERO: state the amount found in %.', ln.label using errcode = 'P0001'; end if;
      v_res := case when (r.subject = 'inventory' and (l->>'found_qty')::numeric = ln.book_qty)
                      or (r.subject = 'cash' and round((l->>'found_value')::numeric, 2) = round(ln.book_value, 2)) then 'matched' else 'difference' end;
    elsif v_res is null or v_res not in ('located','transferred','damaged','missing','disposed','not_checked') then
      raise exception 'NUMERO: the result for % must be located, transferred, damaged, missing or disposed.', ln.label using errcode = 'P0001';
    end if;
    if v_res not in ('located','matched','not_checked') and coalesce(trim(l->>'note'), '') = '' then
      raise exception 'NUMERO: say what was found for %.', ln.label using errcode = 'P0001';
    end if;
    update public.verification_lines set result = v_res, found_qty = (l->>'found_qty')::numeric, found_value = (l->>'found_value')::numeric, note = l->>'note'
     where id = ln.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Completing a verification records what was found. It changes nothing in the books: differences are raised for a person to act on.
create or replace function numero_private.complete_verification(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.verification_runs; ln public.verification_lines; v_sum jsonb; v_open int; v_diff numeric; v_material boolean;
begin
  select * into r from public.verification_runs where id = p_id for update;
  if not found then raise exception 'NUMERO: verification not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(r.company_id, 'reality.manage') then
    raise exception 'NUMERO: you are not authorised to carry out a verification.' using errcode = '42501';
  end if;
  if r.status <> 'open' then raise exception 'NUMERO: this verification is %.', r.status using errcode = 'P0001'; end if;
  select count(*) into v_open from public.verification_lines where run_id = p_id and result = 'not_checked';
  if v_open > 0 and coalesce(trim(p_note), '') = '' then
    raise exception 'NUMERO: % item(s) were not checked. Say why before the verification is completed.', v_open using errcode = 'P0001';
  end if;
  for ln in select * from public.verification_lines where run_id = p_id and result not in ('located','matched','not_checked') loop
    v_diff := case r.subject when 'inventory' then round((coalesce(ln.found_qty, 0) - coalesce(ln.book_qty, 0)) * case when coalesce(ln.book_qty, 0) = 0 then 0 else ln.book_value / ln.book_qty end, 2)
                             when 'cash' then coalesce(ln.found_value, 0) - coalesce(ln.book_value, 0)
                             else -coalesce(ln.book_value, 0) end;
    v_material := numero_private.is_material(r.company_id, v_diff);
    if r.subject = 'assets' then
      insert into public.asset_events(asset_id, company_id, event_type, event_date, detail, created_by)
      values (ln.entity_id, r.company_id, 'verification', r.run_date,
              jsonb_build_object('result', ln.result, 'note', ln.note, 'verification', r.verify_no, 'verified_by', r.performed_by_name), (select auth.uid()));
    end if;
    insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
    values (r.company_id, 'verification_difference', case when v_material or ln.result = 'missing' then 'priority' else 'review' end,
      'VERIFICATION — ' || ln.label || ': ' || replace(ln.result, '_', ' '),
      'Verification ' || r.verify_no || ' of ' || r.run_date || ' found ' || ln.label || ' ' ||
        case r.subject when 'inventory' then 'at ' || coalesce(ln.found_qty, 0) || ' against ' || coalesce(ln.book_qty, 0) || ' in the books'
                       when 'cash' then 'at ' || coalesce(ln.found_value, 0) || ' against ' || coalesce(ln.book_value, 0) || ' in the books'
                       else 'to be ' || replace(ln.result, '_', ' ') || ', while the books carry it at ' || coalesce(ln.book_value, 0) end
        || '. ' || coalesce(ln.note, '') || ' The books have not been changed. Whether this is an error of recording, of counting or a loss is for a person to establish.',
      jsonb_build_object('run_id', r.id, 'line_id', ln.id, 'result', ln.result, 'difference', v_diff, 'above_materiality', v_material,
        'rule', 'what was found differs from what the books say'),
      ln.entity, ln.entity_id, 'verify:' || ln.id::text)
    on conflict (company_id, dedupe_key) do nothing;
  end loop;
  if r.subject = 'assets' then
    insert into public.asset_events(asset_id, company_id, event_type, event_date, detail, created_by)
    select ln2.entity_id, r.company_id, 'verification', r.run_date,
           jsonb_build_object('result', 'located', 'verification', r.verify_no, 'verified_by', r.performed_by_name), (select auth.uid())
      from public.verification_lines ln2 where ln2.run_id = p_id and ln2.result = 'located';
  end if;
  select jsonb_build_object(
      'lines', count(*), 'agree', count(*) filter (where result in ('located','matched')),
      'differ', count(*) filter (where result not in ('located','matched','not_checked')),
      'not_checked', count(*) filter (where result = 'not_checked'),
      'book_value', coalesce(sum(book_value), 0),
      'book_value_of_differences', coalesce(sum(book_value) filter (where result not in ('located','matched','not_checked')), 0),
      'method', 'Agreement = items found as the books describe them ÷ items checked. Items not checked are counted in neither.')
    into v_sum from public.verification_lines where run_id = p_id;
  update public.verification_runs set status = 'completed', summary = v_sum, note = coalesce(nullif(trim(p_note), ''), note),
         completed_by = (select auth.uid()), completed_at = now() where id = p_id;
  return v_sum;
end $$;

-- ---------- confirmation of balances (spec 1389) ----------
create or replace function numero_private.save_confirmation(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_subject text := p->>'subject'; v_date date := (p->>'as_of')::date; v_gid uuid;
  v_party uuid := (p->>'party_id')::uuid; v_entity text; v_eid uuid := (p->>'entity_id')::uuid; v_book numeric; v_basis text; v_label text; v_ccy text;
  v_counter uuid := (p->>'counter_company_id')::uuid; v_other numeric; v_id uuid;
  ba public.bank_accounts; ln public.loans; fd public.fixed_deposits; h public.holdings;
begin
  if not numero_private.can(v_company, 'reality.manage') then
    raise exception 'NUMERO: you are not authorised to prepare confirmations.' using errcode = '42501';
  end if;
  if v_subject is null or v_subject not in ('bank','customer','vendor','loan','deposit','investment','intercompany') then
    raise exception 'NUMERO: state what is confirmed.' using errcode = 'P0001';
  end if;
  if v_date is null then raise exception 'NUMERO: state the date as at which the balance is confirmed.' using errcode = 'P0001'; end if;
  select group_id, base_currency into v_gid, v_ccy from public.companies where id = v_company;

  if v_subject = 'bank' then
    select * into ba from public.bank_accounts where id = v_eid and company_id = v_company;
    if not found then raise exception 'NUMERO: choose the bank account.' using errcode = 'P0001'; end if;
    v_entity := 'bank_accounts'; v_label := ba.name || coalesce(' · ' || ba.account_no_masked, ''); v_ccy := ba.currency;
    v_book := numero_private.ledger_balance_at(v_company, ba.ledger_account_id, v_date);
    v_basis := 'Balance of the bank ledger in the books, from posted entries up to the date';
  elsif v_subject in ('customer','vendor') then
    if not exists (select 1 from public.parties x where x.id = v_party and x.group_id = v_gid) then
      raise exception 'NUMERO: choose the party.' using errcode = 'P0001';
    end if;
    select display_name into v_label from public.parties where id = v_party;
    select coalesce(sum(case when v_subject = 'customer' then l.debit - l.credit else l.credit - l.debit end), 0) into v_book
      from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
     where l.company_id = v_company and l.party_id = v_party and j.status in ('posted','reversed') and j.journal_date <= v_date
       and a.control_type = any(case when v_subject = 'customer' then array['receivable','advance_received'] else array['payable','advance_paid'] end);
    v_basis := case when v_subject = 'customer' then 'Owed to us by the party: receivables less advances received, from posted entries up to the date'
                    else 'Owed by us to the party: payables less advances paid, from posted entries up to the date' end;
    v_entity := 'party'; v_eid := v_party;
  elsif v_subject = 'loan' then
    select * into ln from public.loans where id = v_eid and company_id = v_company;
    if not found or not numero_private.can_view_level(v_company, ln.confidentiality) then raise exception 'NUMERO: choose the loan.' using errcode = 'P0001'; end if;
    v_entity := 'loans'; v_label := ln.loan_no || ' · ' || ln.name; v_party := ln.party_id; v_ccy := ln.currency;
    select coalesce(sum(case when ln.direction = 'borrowed' then l.credit - l.debit else l.debit - l.credit end), 0) into v_book
      from public.journal_lines l join public.journals j on j.id = l.journal_id
     where l.company_id = v_company and l.account_id = ln.loan_account_id and l.party_id = ln.party_id
       and j.status in ('posted','reversed') and j.journal_date <= v_date;
    v_basis := 'Principal outstanding with this party in the loan ledger, from posted entries up to the date';
  elsif v_subject = 'deposit' then
    select * into fd from public.fixed_deposits where id = v_eid and company_id = v_company;
    if not found or not numero_private.can_view_level(v_company, fd.confidentiality) then raise exception 'NUMERO: choose the deposit.' using errcode = 'P0001'; end if;
    v_entity := 'fixed_deposits'; v_label := fd.fd_no || ' · ' || fd.bank_name; v_party := fd.bank_party_id; v_ccy := fd.currency;
    v_book := case when fd.status in ('active','closed') and fd.start_date <= v_date and (fd.closed_on is null or fd.closed_on > v_date) then fd.principal else 0 end;
    v_basis := 'Principal of the deposit as placed, where it stood on the date';
  elsif v_subject = 'investment' then
    select * into h from public.holdings where id = v_eid and company_id = v_company;
    if not found or not numero_private.can_view_level(v_company, h.confidentiality) then raise exception 'NUMERO: choose the investment.' using errcode = 'P0001'; end if;
    v_entity := 'holdings'; v_label := h.holding_no || ' · ' || h.name; v_party := h.investee_party_id; v_ccy := h.currency;
    select coalesce(sum(case t.kind when 'purchase' then t.quantity when 'sale' then -t.quantity else 0 end), 0) into v_book
      from public.holding_txns t where t.holding_id = h.id and t.status = 'posted' and t.txn_date <= v_date;
    v_basis := 'Quantity held, from purchases and sales posted up to the date. The balance confirmed is a quantity, not an amount';
  else
    if v_counter is null or v_counter = v_company or not exists (select 1 from public.companies c where c.id = v_counter and c.group_id = v_gid) then
      raise exception 'NUMERO: choose the other company of the group.' using errcode = 'P0001';
    end if;
    select name into v_label from public.companies where id = v_counter;
    select coalesce(sum(l.debit - l.credit), 0) into v_book
      from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
     where l.company_id = v_company and a.control_type = 'intercompany' and a.counterparty_company_id = v_counter
       and j.status in ('posted','reversed') and j.journal_date <= v_date;
    v_basis := 'Net balance with the other company in our intercompany ledgers (receivable positive), from posted entries up to the date';
    v_entity := 'companies'; v_eid := v_counter;
    if numero_private.can(v_counter, 'journal.view') then
      select -coalesce(sum(l.debit - l.credit), 0) into v_other
        from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
       where l.company_id = v_counter and a.control_type = 'intercompany' and a.counterparty_company_id = v_company
         and j.status in ('posted','reversed') and j.journal_date <= v_date;
    end if;
  end if;

  insert into public.confirmations(company_id, confirm_no, subject, party_id, counter_company_id, entity, entity_id, label, as_of, currency, book_balance, book_basis,
    confirmed_balance, status, contact, sent_how, received_on, confidentiality)
  values (v_company, numero_private.next_doc_no(v_company, 'confirmation', 'CONF', v_date), v_subject, v_party, v_counter, v_entity, v_eid, v_label, v_date, v_ccy,
    round(v_book, 4), v_basis, v_other,
    case when v_other is null then 'drafted' when round(v_other, 2) = round(v_book, 2) then 'agreed' else 'difference' end,
    p->>'contact', case when v_other is not null then 'Read from the books of the other company' end,
    case when v_other is not null then current_date end, coalesce(p->>'confidentiality', 'internal'))
  returning id into v_id;
  if v_other is not null and round(v_other, 2) <> round(v_book, 2) then
    perform numero_private.raise_confirmation_alert(v_id);
  end if;
  return v_id;
end $$;

create or replace function numero_private.raise_confirmation_alert(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.confirmations; v_material boolean;
begin
  select * into c from public.confirmations where id = p_id;
  v_material := numero_private.is_material(c.company_id, c.difference);
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  values (c.company_id, 'confirmation_difference', case when v_material then 'priority' else 'review' end,
    'CONFIRMATION — ' || c.label || ' differs by ' || abs(c.difference),
    'Confirmation ' || c.confirm_no || ' as at ' || c.as_of || ': the books show ' || c.book_balance || ' and the other side confirms ' || c.confirmed_balance
      || ', a difference of ' || c.difference || '. A difference is often timing — items in transit, or recorded on one side only. It is for a person to reconcile.',
    jsonb_build_object('confirmation_id', c.id, 'book_balance', c.book_balance, 'confirmed_balance', c.confirmed_balance, 'difference', c.difference,
      'above_materiality', v_material, 'basis', c.book_basis, 'rule', 'the balance confirmed differs from the books'),
    'confirmations', c.id, 'confirm:' || c.id::text)
  on conflict (company_id, dedupe_key) do nothing;
end $$;

-- NUMERO prepares a confirmation and records the reply. A person sends it and receives the answer.
create or replace function numero_private.update_confirmation(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.confirmations; v_action text := p->>'action'; v_bal numeric;
begin
  select * into c from public.confirmations where id = (p->>'id')::uuid for update;
  if not found then raise exception 'NUMERO: confirmation not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(c.company_id, 'reality.manage') then
    raise exception 'NUMERO: you are not authorised to work on confirmations.' using errcode = '42501';
  end if;
  if not numero_private.can_view_level(c.company_id, c.confidentiality) then
    raise exception 'NUMERO: you are not cleared for this record.' using errcode = '42501';
  end if;
  if c.status = 'cancelled' then raise exception 'NUMERO: this confirmation was cancelled.' using errcode = 'P0001'; end if;
  if v_action = 'sent' then
    if c.status <> 'drafted' then raise exception 'NUMERO: this confirmation is already %.', c.status using errcode = 'P0001'; end if;
    if coalesce(trim(p->>'sent_how'), '') = '' then raise exception 'NUMERO: record how and to whom it was sent.' using errcode = 'P0001'; end if;
    update public.confirmations set status = 'sent', sent_on = coalesce((p->>'sent_on')::date, current_date), sent_how = p->>'sent_how', contact = coalesce(p->>'contact', contact) where id = c.id;
    return 'sent';
  elsif v_action = 'reply' then
    v_bal := (p->>'confirmed_balance')::numeric;
    if v_bal is null then raise exception 'NUMERO: state the balance the other side confirms.' using errcode = 'P0001'; end if;
    if c.status not in ('drafted','sent','no_reply') then raise exception 'NUMERO: a reply is already recorded.' using errcode = 'P0001'; end if;
    if p->>'document_id' is not null and not exists (select 1 from public.documents d where d.id = (p->>'document_id')::uuid and d.company_id = c.company_id) then
      raise exception 'NUMERO: the document belongs to another company.' using errcode = 'P0001';
    end if;
    update public.confirmations set confirmed_balance = round(v_bal, 4), received_on = coalesce((p->>'received_on')::date, current_date),
           document_id = (p->>'document_id')::uuid, status = case when round(v_bal, 2) = round(c.book_balance, 2) then 'agreed' else 'difference' end
     where id = c.id;
    if round(v_bal, 2) <> round(c.book_balance, 2) then perform numero_private.raise_confirmation_alert(c.id); return 'difference'; end if;
    return 'agreed';
  elsif v_action in ('explained','disputed') then
    if c.status not in ('difference','explained','disputed') then raise exception 'NUMERO: there is no difference to explain.' using errcode = 'P0001'; end if;
    if coalesce(trim(p->>'explanation'), '') = '' then raise exception 'NUMERO: record the explanation.' using errcode = 'P0001'; end if;
    update public.confirmations set status = v_action, explanation = p->>'explanation' where id = c.id;
    return v_action;
  elsif v_action = 'no_reply' then
    if c.status <> 'sent' then raise exception 'NUMERO: only a confirmation that was sent can be marked as unanswered.' using errcode = 'P0001'; end if;
    update public.confirmations set status = 'no_reply', explanation = p->>'explanation' where id = c.id;
    return 'no_reply';
  elsif v_action = 'cancel' then
    if coalesce(trim(p->>'explanation'), '') = '' then raise exception 'NUMERO: a reason is required.' using errcode = 'P0001'; end if;
    update public.confirmations set status = 'cancelled', explanation = p->>'explanation' where id = c.id;
    return 'cancelled';
  end if;
  raise exception 'NUMERO: unknown action.' using errcode = 'P0001';
end $$;

-- ---------- reclassification (spec 1581) ----------
create or replace function numero_private.propose_reclassification(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.journal_lines; j public.journals; a_from public.accounts; a_to public.accounts; v_amt numeric; v_done numeric;
        v_date date := coalesce((p->>'date')::date, current_date); v_side text; v_id uuid; v_j uuid; v_dims jsonb; v_line_amt numeric;
begin
  select * into l from public.journal_lines where id = (p->>'line_id')::uuid;
  if not found then raise exception 'NUMERO: entry line not found.' using errcode = 'P0001'; end if;
  select * into j from public.journals where id = l.journal_id;
  if not numero_private.can(l.company_id, 'journal.create') then
    raise exception 'NUMERO: you are not authorised to propose a reclassification.' using errcode = '42501';
  end if;
  if not numero_private.can_view_level(l.company_id, j.confidentiality) then
    raise exception 'NUMERO: you are not cleared for this entry.' using errcode = '42501';
  end if;
  if j.status <> 'posted' then raise exception 'NUMERO: only a posted entry is reclassified. This entry is %.', j.status using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'reason'), '') = '' then raise exception 'NUMERO: a reclassification records its reason.' using errcode = 'P0001'; end if;
  select * into a_from from public.accounts where id = l.account_id;
  select * into a_to from public.accounts where id = (p->>'to_account_id')::uuid;
  if not found or a_to.company_id <> l.company_id or a_to.is_group or not a_to.is_active then
    raise exception 'NUMERO: choose an active posting account of this company.' using errcode = 'P0001';
  end if;
  if a_to.id = a_from.id then raise exception 'NUMERO: the entry is already in that ledger.' using errcode = 'P0001'; end if;
  if coalesce(a_from.control_type, '') in ('bank','cash','receivable','payable','tax','intercompany')
     or coalesce(a_to.control_type, '') in ('bank','cash','receivable','payable','tax','intercompany') then
    raise exception 'NUMERO: bank, cash, party, tax and intercompany ledgers record what happened with someone else. They are corrected by reversing the source document, not by reclassification.' using errcode = 'P0001';
  end if;
  v_side := case when l.debit > 0 then 'debit' else 'credit' end;
  v_line_amt := greatest(l.debit, l.credit);
  v_amt := round(coalesce((p->>'amount')::numeric, v_line_amt), 2);
  select coalesce(sum(r.amount), 0) into v_done from public.reclassifications r where r.line_id = l.id and r.status in ('proposed','posted');
  if v_amt <= 0 or v_amt > v_line_amt - v_done then
    raise exception 'NUMERO: the line carries %, of which % has been reclassified already. At most % can be moved.', v_line_amt, v_done, v_line_amt - v_done using errcode = 'P0001';
  end if;
  select coalesce(jsonb_object_agg(d.type_key, d.org_unit_id), '{}'::jsonb) into v_dims from public.journal_line_dims d where d.line_id = l.id;
  insert into public.reclassifications(company_id, journal_id, line_id, from_account_id, to_account_id, amount, side, reclass_date, reason)
  values (l.company_id, j.id, l.id, a_from.id, a_to.id, v_amt, v_side, v_date, trim(p->>'reason'))
  returning id into v_id;
  v_j := numero_private.propose_posting(l.company_id, 'adjustment', v_date,
    'Reclassification of ' || v_amt || ' from ' || a_from.name || ' to ' || a_to.name || ' — entry ' || coalesce(j.voucher_no, '') || ' — ' || trim(p->>'reason'),
    'reclassification', v_id,
    jsonb_build_array(
      jsonb_build_object('account_id', a_to.id, v_side, v_amt, 'party_id', l.party_id, 'dims', v_dims, 'description', 'Reclassified from ' || a_from.name),
      jsonb_build_object('account_id', a_from.id, case when v_side = 'debit' then 'credit' else 'debit' end, v_amt, 'party_id', l.party_id, 'dims', v_dims,
        'description', 'Reclassified to ' || a_to.name)),
    jsonb_build_object('original_journal', j.id, 'original_voucher', j.voucher_no, 'original_line', l.id, 'from_account', a_from.id, 'to_account', a_to.id,
      'amount', v_amt, 'reason', trim(p->>'reason'), 'rule', 'The original entry is unchanged. This entry moves the amount and both remain on record.'),
    j.confidentiality);
  update public.reclassifications set new_journal_id = v_j where id = v_id;
  return v_j;
end $$;

create or replace function numero_private.wf_reclassification(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.reclassifications set status = case p_event when 'posted' then 'posted' when 'voided' then 'rejected' else 'reversed' end where id = w.source_id;
end $$;

-- ---------- allocation of cost (spec 1245, 1557) ----------
create or replace function numero_private.save_allocation(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; al public.allocations; a public.accounts; v_src uuid := (p->>'source_org_unit_id')::uuid;
  v_from date := (p->>'period_from')::date; v_to date := (p->>'period_to')::date; v_amt numeric := round((p->>'amount')::numeric, 2); v_driver text := p->>'driver';
  v_type text := p->>'dimension_type'; v_pool numeric; r jsonb; v_total numeric := 0; v_out jsonb := '[]'::jsonb; v_n int; v_i int := 0; v_left numeric; v_share numeric; v_val numeric; u public.org_units;
begin
  if not numero_private.can(v_company, 'allocation.manage') then
    raise exception 'NUMERO: you are not authorised to prepare allocations.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: a name is required.' using errcode = 'P0001'; end if;
  if v_from is null or v_to is null or v_to < v_from then raise exception 'NUMERO: state the period.' using errcode = 'P0001'; end if;
  if v_driver is null or v_driver not in ('headcount','revenue','area','usage','equal','manual') then raise exception 'NUMERO: state the driver the cost is shared by.' using errcode = 'P0001'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'NUMERO: the amount must be greater than zero.' using errcode = 'P0001'; end if;
  select * into a from public.accounts where id = (p->>'source_account_id')::uuid;
  if not found or a.company_id <> v_company or a.is_group or not a.is_active or a.type not in ('expense','income') then
    raise exception 'NUMERO: an allocation shares out an income or expense ledger of this company.' using errcode = 'P0001';
  end if;
  if v_type is null or not exists (select 1 from public.org_unit_types t where t.key = v_type) then
    raise exception 'NUMERO: state the kind of unit the cost is shared between: department, project, branch and so on.' using errcode = 'P0001';
  end if;
  if v_src is not null then
    select * into u from public.org_units where id = v_src and company_id = v_company;
    if not found or u.type_key <> v_type then raise exception 'NUMERO: the unit that holds the cost must be a % of this company.', v_type using errcode = 'P0001'; end if;
  end if;
  -- what the source holds in the period
  select coalesce(sum(l.debit - l.credit), 0) into v_pool
    from public.journal_lines l join public.journals j on j.id = l.journal_id
   where l.company_id = v_company and l.account_id = a.id and j.status in ('posted','reversed') and j.journal_date between v_from and v_to
     and case when v_src is not null then exists (select 1 from public.journal_line_dims d where d.line_id = l.id and d.org_unit_id = v_src)
              else not exists (select 1 from public.journal_line_dims d where d.line_id = l.id and d.type_key = v_type) end;
  if a.type = 'income' then v_pool := -v_pool; end if;
  if v_amt > v_pool then
    raise exception 'NUMERO: % holds % for the period%. No more than that can be shared out.', a.name, v_pool,
      case when v_src is not null then ' in ' || u.name else ' without a ' || v_type end using errcode = 'P0001';
  end if;
  if jsonb_typeof(p->'recipients') is distinct from 'array' or jsonb_array_length(p->'recipients') = 0 then
    raise exception 'NUMERO: name the units that receive the cost.' using errcode = 'P0001';
  end if;
  v_n := jsonb_array_length(p->'recipients');
  for r in select * from jsonb_array_elements(p->'recipients') loop
    select * into u from public.org_units where id = (r->>'org_unit_id')::uuid and company_id = v_company;
    if not found or u.type_key <> v_type then raise exception 'NUMERO: every recipient must be a % of this company.', v_type using errcode = 'P0001'; end if;
    if u.id = v_src then raise exception 'NUMERO: the unit that holds the cost cannot also receive it.' using errcode = 'P0001'; end if;
    v_val := case when v_driver = 'equal' then 1 else (r->>'driver_value')::numeric end;
    if v_val is null or v_val < 0 then raise exception 'NUMERO: % needs the value of its driver.', u.name using errcode = 'P0001'; end if;
    v_total := v_total + v_val;
  end loop;
  if v_total <= 0 then raise exception 'NUMERO: the drivers add up to nothing, so there is nothing to share by.' using errcode = 'P0001'; end if;
  v_left := v_amt;
  for r in select * from jsonb_array_elements(p->'recipients') loop
    v_i := v_i + 1;
    v_val := case when v_driver = 'equal' then 1 else (r->>'driver_value')::numeric end;
    v_share := case when v_i = v_n then v_left else round(v_amt * v_val / v_total, 2) end;
    v_left := v_left - v_share;
    v_out := v_out || jsonb_build_object('org_unit_id', r->>'org_unit_id', 'name', (select name from public.org_units where id = (r->>'org_unit_id')::uuid),
      'driver_value', v_val, 'share_pct', round(v_val * 100 / v_total, 4), 'amount', v_share);
  end loop;
  if v_id is not null then
    select * into al from public.allocations where id = v_id and company_id = v_company for update;
    if not found then raise exception 'NUMERO: allocation not found.' using errcode = 'P0001'; end if;
    if al.status not in ('draft','rejected') then raise exception 'NUMERO: only a draft can be edited. This allocation is %.', al.status using errcode = 'P0001'; end if;
    update public.allocations set status = 'draft', name = trim(p->>'name'), period_from = v_from, period_to = v_to, source_account_id = a.id, source_org_unit_id = v_src,
      dimension_type = v_type, pool_balance = v_pool, amount = v_amt, driver = v_driver, driver_note = p->>'driver_note',
      formula = 'Share of a unit = ' || v_amt || ' × its ' || v_driver || ' ÷ total ' || v_driver || ' of ' || v_total, recipients = v_out, journal_id = null
    where id = v_id;
  else
    insert into public.allocations(company_id, alloc_no, name, period_from, period_to, source_account_id, source_org_unit_id, dimension_type, pool_balance, amount,
      driver, driver_note, formula, recipients)
    values (v_company, numero_private.next_doc_no(v_company, 'allocation', 'ALLOC', v_to), trim(p->>'name'), v_from, v_to, a.id, v_src, v_type, v_pool, v_amt,
      v_driver, p->>'driver_note', 'Share of a unit = ' || v_amt || ' × its ' || v_driver || ' ÷ total ' || v_driver || ' of ' || v_total, v_out)
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function numero_private.propose_allocation(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare al public.allocations; a public.accounts; v_lines jsonb := '[]'::jsonb; r jsonb; v_out text; v_in text; v_j uuid;
begin
  select * into al from public.allocations where id = p_id for update;
  if not found then raise exception 'NUMERO: allocation not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(al.company_id, 'allocation.manage') then
    raise exception 'NUMERO: you are not authorised to propose allocations.' using errcode = '42501';
  end if;
  if al.status not in ('draft','rejected') then raise exception 'NUMERO: this allocation is %.', al.status using errcode = 'P0001'; end if;
  select * into a from public.accounts where id = al.source_account_id;
  v_out := case when a.type = 'expense' then 'credit' else 'debit' end;
  v_in := case when a.type = 'expense' then 'debit' else 'credit' end;
  v_lines := v_lines || jsonb_build_object('account_id', a.id, v_out, al.amount,
    'dims', case when al.source_org_unit_id is not null then jsonb_build_object(al.dimension_type, al.source_org_unit_id) else '{}'::jsonb end,
    'description', 'Shared out — ' || al.name);
  for r in select * from jsonb_array_elements(al.recipients) loop
    if (r->>'amount')::numeric > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', a.id, v_in, (r->>'amount')::numeric,
        'dims', jsonb_build_object(al.dimension_type, r->>'org_unit_id'),
        'description', al.name || ' — ' || (r->>'share_pct') || '% by ' || al.driver);
    end if;
  end loop;
  v_j := numero_private.propose_posting(al.company_id, 'adjustment', al.period_to,
    'Allocation ' || al.alloc_no || ' · ' || al.name || ' — ' || al.amount || ' of ' || a.name || ' shared by ' || al.driver,
    'allocation', al.id, v_lines,
    jsonb_build_object('amount', al.amount, 'driver', al.driver, 'formula', al.formula, 'period_from', al.period_from, 'period_to', al.period_to), 'internal');
  update public.allocations set status = 'proposed', journal_id = v_j where id = al.id;
  return v_j;
end $$;

create or replace function numero_private.wf_allocation(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.allocations set status = case p_event when 'posted' then 'posted' when 'voided' then 'rejected' else 'reversed' end where id = w.source_id;
end $$;

create or replace function public.set_materiality(p_company uuid, p_amount numeric, p_pct numeric default null, p_note text default null) returns void language sql set search_path = '' as $$ select numero_private.set_materiality(p_company, p_amount, p_pct, p_note); $$;
create or replace function public.open_case(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.open_case(p); $$;
create or replace function public.update_case(p jsonb) returns void language sql set search_path = '' as $$ select numero_private.update_case(p); $$;
create or replace function public.open_verification(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.open_verification(p); $$;
create or replace function public.record_verification(p jsonb) returns int language sql set search_path = '' as $$ select numero_private.record_verification(p); $$;
create or replace function public.complete_verification(p_id uuid, p_note text default null) returns jsonb language sql set search_path = '' as $$ select numero_private.complete_verification(p_id, p_note); $$;
create or replace function public.save_confirmation(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_confirmation(p); $$;
create or replace function public.update_confirmation(p jsonb) returns text language sql set search_path = '' as $$ select numero_private.update_confirmation(p); $$;
create or replace function public.propose_reclassification(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.propose_reclassification(p); $$;
create or replace function public.save_allocation(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_allocation(p); $$;
create or replace function public.propose_allocation(p_id uuid) returns uuid language sql set search_path = '' as $$ select numero_private.propose_allocation(p_id); $$;

insert into numero_private.internal_functions(name) values
  ('is_material'), ('case_perm'), ('ledger_balance_at'), ('raise_confirmation_alert')
on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();
