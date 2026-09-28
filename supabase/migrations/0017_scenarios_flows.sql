-- >>> applied as migration 20260927131508 · p3_11_scenarios_flows
-- =====================================================================
-- GHL NUMERO · 0017 · SCENARIOS (DIGITAL TWIN) AND SCENARIO STUDIO
-- Spec: 54, 89, 427, 428, 508, 815, 1285, 1295-1297, 1358, 1359, 1425,
--       1768-1772, 1809, 1820, 1828, 1901
--
-- Two different things share the word "scenario" in the specification:
--   * a SIMULATION — "what happens if revenue falls 20%?" — which is a
--     calculation beside the books and never touches them;
--   * a BUSINESS SITUATION with its own workflow — employee travel, a site
--     advance, an insurance claim — built in the Scenario Studio.
-- They are kept in separate tables so that neither can be taken for the other.
-- =====================================================================

-- ---------- simulations ----------
create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  company_id uuid references public.companies(id),          -- null = the group
  name text not null,
  kind text not null default 'custom' check (kind in ('base','optimistic','conservative','custom')),
  description text,
  horizon_months int not null default 12 check (horizon_months between 1 and 60),
  shocks jsonb not null default '[]'::jsonb,
  status text not null default 'saved' check (status in ('saved','archived')),
  shared boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scenarios_group_idx on public.scenarios(group_id, company_id);

-- A saved result of a simulation. It is a record of a calculation, labelled as such; it is not accounting.
create table public.scenario_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scenarios(id),
  group_id uuid not null references public.groups(id),
  company_ids uuid[] not null,
  as_of date not null,
  label text not null default 'SIMULATION' check (label = 'SIMULATION'),
  base jsonb not null,
  result jsonb not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index scenario_runs_scenario_idx on public.scenario_runs(scenario_id, created_at desc);

-- Financial drivers a simulation may use: recorded facts or assumptions approved by a person.
create table public.twin_drivers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  company_id uuid references public.companies(id),
  key text not null,
  name text not null,
  unit text not null default 'amount' check (unit in ('amount','percent','days','count','rate')),
  value numeric(20,6) not null,
  basis text not null,
  source text not null default 'assumed' check (source in ('recorded','assumed')),
  status text not null default 'proposed' check (status in ('proposed','approved','retired')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz
);
create unique index twin_drivers_key on public.twin_drivers(group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key) where status <> 'retired';

create or replace function numero_private.scenario_scope_ok(p_company uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_company is not null then numero_private.can(p_company, p_perm)
              else numero_private.is_group_admin(numero_private.my_group())
                   or exists (select 1 from public.companies c where c.group_id = numero_private.my_group() and numero_private.can(c.id, p_perm)) end;
$$;

create or replace function numero_private.save_scenario(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; s public.scenarios; k jsonb;
begin
  if v_gid is null then raise exception 'NUMERO: authentication required.' using errcode = '42501'; end if;
  if not numero_private.scenario_scope_ok(v_company, 'scenario.manage') then
    raise exception 'NUMERO: you are not authorised to build simulations.' using errcode = '42501';
  end if;
  if v_company is not null and not exists (select 1 from public.companies c where c.id = v_company and c.group_id = v_gid) then
    raise exception 'NUMERO: company not found.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: a simulation needs a name.' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p->'shocks', '[]'::jsonb)) <> 'array' then raise exception 'NUMERO: the assumptions must be a list.' using errcode = 'P0001'; end if;
  for k in select * from jsonb_array_elements(coalesce(p->'shocks', '[]'::jsonb)) loop
    if coalesce(k->>'kind', '') = '' then raise exception 'NUMERO: each assumption names what it changes.' using errcode = 'P0001'; end if;
  end loop;
  if v_id is null then
    insert into public.scenarios(group_id, company_id, name, kind, description, horizon_months, shocks, shared)
    values (v_gid, v_company, trim(p->>'name'), coalesce(p->>'kind', 'custom'), p->>'description', coalesce((p->>'horizon_months')::int, 12),
            coalesce(p->'shocks', '[]'::jsonb), coalesce((p->>'shared')::boolean, false))
    returning id into v_id;
  else
    select * into s from public.scenarios where id = v_id and group_id = v_gid for update;
    if not found then raise exception 'NUMERO: simulation not found.' using errcode = 'P0001'; end if;
    if s.created_by <> (select auth.uid()) and not numero_private.is_group_admin(v_gid) then
      raise exception 'NUMERO: a simulation is changed by the person who built it. Save a copy under your own name.' using errcode = '42501';
    end if;
    update public.scenarios set company_id = v_company, name = trim(p->>'name'), kind = coalesce(p->>'kind', kind), description = p->>'description',
      horizon_months = coalesce((p->>'horizon_months')::int, horizon_months), shocks = coalesce(p->'shocks', shocks),
      shared = coalesce((p->>'shared')::boolean, shared), status = coalesce(p->>'status', status), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function numero_private.save_scenario_run(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.scenarios; v_ids uuid[]; v_id uuid; c uuid;
begin
  select * into s from public.scenarios where id = (p->>'scenario_id')::uuid and group_id = numero_private.my_group();
  if not found then raise exception 'NUMERO: simulation not found.' using errcode = 'P0001'; end if;
  if not numero_private.scenario_scope_ok(s.company_id, 'scenario.manage') then
    raise exception 'NUMERO: you are not authorised to save the result of a simulation.' using errcode = '42501';
  end if;
  select array_agg((e.value)::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'company_ids', '[]'::jsonb)) e;
  if v_ids is null then raise exception 'NUMERO: state the companies the simulation was run for.' using errcode = 'P0001'; end if;
  foreach c in array v_ids loop
    if not numero_private.can(c, 'scenario.view') or not numero_private.can(c, 'report.view') then
      raise exception 'NUMERO: the result contains figures of a company you may not read.' using errcode = '42501';
    end if;
  end loop;
  if jsonb_typeof(p->'base') is distinct from 'object' or jsonb_typeof(p->'result') is distinct from 'object' then
    raise exception 'NUMERO: a result records the figures it started from and the figures it arrived at.' using errcode = 'P0001';
  end if;
  insert into public.scenario_runs(scenario_id, group_id, company_ids, as_of, base, result, note)
  values (s.id, s.group_id, v_ids, coalesce((p->>'as_of')::date, current_date), p->'base', p->'result', p->>'note')
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.save_twin_driver(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_company uuid := (p->>'company_id')::uuid; v_id uuid;
begin
  if not numero_private.scenario_scope_ok(v_company, 'scenario.manage') then
    raise exception 'NUMERO: you are not authorised to propose drivers.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'key'), '') = '' or coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: a driver needs a key and a name.' using errcode = 'P0001'; end if;
  if (p->>'value') is null then raise exception 'NUMERO: a driver needs its value.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'basis'), '') = '' then raise exception 'NUMERO: a driver states what it rests on.' using errcode = 'P0001'; end if;
  update public.twin_drivers set status = 'retired'
   where group_id = v_gid and company_id is not distinct from v_company and key = lower(trim(p->>'key')) and status <> 'retired';
  insert into public.twin_drivers(group_id, company_id, key, name, unit, value, basis, source)
  values (v_gid, v_company, lower(trim(p->>'key')), trim(p->>'name'), coalesce(p->>'unit', 'amount'), (p->>'value')::numeric, trim(p->>'basis'), coalesce(p->>'source', 'assumed'))
  returning id into v_id;
  return v_id;
end $$;

-- An assumption is used by simulations only after a second person has approved it.
create or replace function numero_private.decide_twin_driver(p_id uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.twin_drivers;
begin
  select * into d from public.twin_drivers where id = p_id and group_id = numero_private.my_group() for update;
  if not found then raise exception 'NUMERO: driver not found.' using errcode = 'P0001'; end if;
  if not numero_private.scenario_scope_ok(d.company_id, 'scenario.manage') then
    raise exception 'NUMERO: you are not authorised to approve drivers.' using errcode = '42501';
  end if;
  if d.status <> 'proposed' then raise exception 'NUMERO: this driver is %.', d.status using errcode = 'P0001'; end if;
  if p_decision not in ('approved','retired') then raise exception 'NUMERO: the decision is approved or retired.' using errcode = 'P0001'; end if;
  if p_decision = 'approved' and d.created_by = (select auth.uid()) then
    raise exception 'NUMERO: maker-checker control — the person who proposed this assumption cannot also approve it.' using errcode = '42501';
  end if;
  update public.twin_drivers set status = p_decision, approved_by = (select auth.uid()), approved_at = now() where id = p_id;
end $$;

-- ---------- scenario studio: a business situation with its own workflow ----------
create table public.flow_defs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  company_id uuid references public.companies(id),
  key text not null,
  version int not null default 1,
  name text not null,
  description text,
  category text not null default 'other',
  trigger_kind text not null default 'manual'
    check (trigger_kind in ('manual','form','voice','document_upload','email','api','schedule','event','bank_transaction','invoice','contract','numi_detection')),
  definition jsonb not null,
  status text not null default 'draft' check (status in ('draft','active','retired')),
  cloned_from uuid references public.flow_defs(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  activated_by uuid,
  activated_at timestamptz
);
create unique index flow_defs_key on public.flow_defs(group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key, version);

create table public.flow_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  flow_id uuid not null references public.flow_defs(id),
  case_no text not null,
  title text not null,
  party_id uuid references public.parties(id),
  amount numeric(20,4),
  register_item_id uuid references public.register_items(id),
  data jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  current_step int not null default 1,
  confidentiality text not null default 'internal'
    check (confidentiality in ('internal','confidential','highly_confidential','restricted','super_admin_only')),
  started_by uuid default auth.uid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  cancel_reason text,
  unique (company_id, case_no)
);
create index flow_cases_company_idx on public.flow_cases(company_id, status, started_at desc);

create table public.flow_case_steps (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.flow_cases(id),
  company_id uuid not null references public.companies(id),
  step_no int not null,
  step_key text not null,
  name text not null,
  action text not null,
  actor_role text not null default '*',
  links_to text,
  required_documents text[] not null default '{}',
  optional boolean not null default false,
  status text not null default 'pending' check (status in ('pending','active','done','skipped')),
  entity text,
  entity_id uuid,
  note text,
  done_by uuid,
  done_at timestamptz,
  unique (case_id, step_no)
);

-- what a step may be, and the record it may point to
create or replace function numero_private.flow_actions() returns text[]
language sql immutable set search_path = '' as $$
  select array['request','approval','fund_release','evidence','settlement','accounting','reconciliation','review','notice'];
$$;
create or replace function numero_private.flow_links() returns text[]
language sql immutable set search_path = '' as $$
  select array['advances','expense_claims','purchase_docs','register_items','journals','fund_transfers','invoices','payments','fixed_assets','loans','stock_docs','cases'];
$$;

create or replace function numero_private.check_flow_definition(p_group uuid, d jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; v_keys text[] := '{}'; v_n int := 0; f jsonb;
begin
  if jsonb_typeof(d->'steps') is distinct from 'array' or jsonb_array_length(d->'steps') = 0 then
    raise exception 'NUMERO: a workflow needs at least one step.' using errcode = 'P0001';
  end if;
  for s in select * from jsonb_array_elements(d->'steps') loop
    v_n := v_n + 1;
    if coalesce(trim(s->>'key'), '') = '' or coalesce(trim(s->>'name'), '') = '' then
      raise exception 'NUMERO: step % needs a key and a name.', v_n using errcode = 'P0001';
    end if;
    if (s->>'key') = any(v_keys) then raise exception 'NUMERO: two steps share the key "%".', s->>'key' using errcode = 'P0001'; end if;
    v_keys := v_keys || (s->>'key');
    if s->>'action' is null or not (s->>'action') = any(numero_private.flow_actions()) then
      raise exception 'NUMERO: step "%" — the action must be one of: %.', s->>'name', array_to_string(numero_private.flow_actions(), ', ') using errcode = 'P0001';
    end if;
    if coalesce(s->>'actor_role', '*') <> '*' and not exists (
         select 1 from public.roles r where r.group_id = p_group and r.key = s->>'actor_role') then
      raise exception 'NUMERO: step "%" names a role that does not exist: %.', s->>'name', s->>'actor_role' using errcode = 'P0001';
    end if;
    if s->>'links_to' is not null and not (s->>'links_to') = any(numero_private.flow_links()) then
      raise exception 'NUMERO: step "%" points to a kind of record that a workflow cannot link: %.', s->>'name', s->>'links_to' using errcode = 'P0001';
    end if;
    if s ? 'required_documents' and jsonb_typeof(s->'required_documents') <> 'array' then
      raise exception 'NUMERO: step "%" — the required documents must be a list.', s->>'name' using errcode = 'P0001';
    end if;
    -- money is released, and cost is recognised, only through the engines that propose an accounting entry
    if s->>'action' in ('fund_release','accounting','settlement') and s->>'links_to' is null then
      raise exception 'NUMERO: step "%" releases money or recognises cost. It must point to the record that does so (an advance, a claim, a transfer, a journal), because a workflow itself posts nothing.', s->>'name' using errcode = 'P0001';
    end if;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(d->'fields', '[]'::jsonb)) loop
    if coalesce(trim(f->>'key'), '') = '' or coalesce(trim(f->>'label'), '') = '' then
      raise exception 'NUMERO: each field of the form needs a key and a label.' using errcode = 'P0001';
    end if;
  end loop;
end $$;

create or replace function numero_private.save_flow_def(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; f public.flow_defs; v_key text := lower(trim(p->>'key')); v_ver int;
begin
  if v_gid is null then raise exception 'NUMERO: authentication required.' using errcode = '42501'; end if;
  if not numero_private.scenario_scope_ok(v_company, 'flow.configure') then
    raise exception 'NUMERO: you are not authorised to design workflows.' using errcode = '42501';
  end if;
  if v_company is null and not numero_private.is_group_admin(v_gid) then
    raise exception 'NUMERO: a workflow for the whole group is designed by a Group Super Admin.' using errcode = '42501';
  end if;
  if coalesce(v_key, '') = '' or coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: a workflow needs a key and a name.' using errcode = 'P0001'; end if;
  perform numero_private.check_flow_definition(v_gid, p->'definition');
  if v_id is not null then
    select * into f from public.flow_defs where id = v_id and group_id = v_gid for update;
    if not found then raise exception 'NUMERO: workflow not found.' using errcode = 'P0001'; end if;
    if f.status = 'draft' then
      update public.flow_defs set name = trim(p->>'name'), description = p->>'description', category = coalesce(p->>'category', category),
        trigger_kind = coalesce(p->>'trigger_kind', trigger_kind), definition = p->'definition' where id = v_id;
      return v_id;
    end if;
    -- a workflow in use is never edited: cases already started keep the steps they started with. A change is a new version.
    v_key := f.key; v_company := f.company_id;
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.flow_defs where group_id = v_gid and company_id is not distinct from v_company and key = v_key;
  insert into public.flow_defs(group_id, company_id, key, version, name, description, category, trigger_kind, definition, cloned_from)
  values (v_gid, v_company, v_key, v_ver, trim(p->>'name'), p->>'description', coalesce(p->>'category', 'other'), coalesce(p->>'trigger_kind', 'manual'),
          p->'definition', coalesce((p->>'cloned_from')::uuid, f.id))
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.set_flow_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.flow_defs;
begin
  select * into f from public.flow_defs where id = p_id and group_id = numero_private.my_group() for update;
  if not found then raise exception 'NUMERO: workflow not found.' using errcode = 'P0001'; end if;
  if not numero_private.scenario_scope_ok(f.company_id, 'flow.configure') or (f.company_id is null and not numero_private.is_group_admin(f.group_id)) then
    raise exception 'NUMERO: you are not authorised to change this workflow.' using errcode = '42501';
  end if;
  if p_status not in ('active','retired') then raise exception 'NUMERO: a workflow is made active or retired.' using errcode = 'P0001'; end if;
  if p_status = 'active' then
    perform numero_private.check_flow_definition(f.group_id, f.definition);
    update public.flow_defs set status = 'retired'
     where group_id = f.group_id and company_id is not distinct from f.company_id and key = f.key and status = 'active' and id <> f.id;
    update public.flow_defs set status = 'active', activated_by = (select auth.uid()), activated_at = now() where id = f.id;
  else
    update public.flow_defs set status = 'retired' where id = f.id;
  end if;
end $$;

create or replace function numero_private.clone_flow_def(p_id uuid, p_key text, p_name text, p_company uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.flow_defs;
begin
  select * into f from public.flow_defs where id = p_id and group_id = numero_private.my_group();
  if not found then raise exception 'NUMERO: workflow not found.' using errcode = 'P0001'; end if;
  return numero_private.save_flow_def(jsonb_build_object('company_id', p_company, 'key', p_key, 'name', p_name, 'description', f.description,
    'category', f.category, 'trigger_kind', f.trigger_kind, 'definition', f.definition, 'cloned_from', f.id));
end $$;

create or replace function numero_private.start_flow_case(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.flow_defs; v_company uuid := (p->>'company_id')::uuid; v_id uuid; s jsonb; v_n int := 0; fld jsonb; v_missing text; v_level text := coalesce(p->>'confidentiality', 'internal');
begin
  select * into f from public.flow_defs where id = (p->>'flow_id')::uuid and group_id = numero_private.my_group();
  if not found then raise exception 'NUMERO: workflow not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(v_company, 'flow.manage') and not numero_private.can(v_company, 'flow.view') then
    raise exception 'NUMERO: you are not authorised to start this workflow.' using errcode = '42501';
  end if;
  if f.status <> 'active' then raise exception 'NUMERO: this workflow is %. Only an active workflow can be started.', f.status using errcode = 'P0001'; end if;
  if f.company_id is not null and f.company_id <> v_company then raise exception 'NUMERO: this workflow belongs to another company.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'NUMERO: a title is required.' using errcode = 'P0001'; end if;
  if v_level <> 'internal' and not numero_private.can_view_level(v_company, v_level) then
    raise exception 'NUMERO: you cannot create records at a confidentiality level you are not cleared for.' using errcode = '42501';
  end if;
  for fld in select * from jsonb_array_elements(coalesce(f.definition->'fields', '[]'::jsonb)) loop
    if coalesce((fld->>'required')::boolean, false) and coalesce(trim(p->'data'->>(fld->>'key')), '') = '' then
      v_missing := concat_ws(', ', v_missing, fld->>'label');
    end if;
  end loop;
  if v_missing is not null then raise exception 'NUMERO: required information is missing — %.', v_missing using errcode = 'P0001'; end if;
  if p->>'register_item_id' is not null and not exists (select 1 from public.register_items r where r.id = (p->>'register_item_id')::uuid and r.company_id = v_company) then
    raise exception 'NUMERO: the register item belongs to another company.' using errcode = 'P0001';
  end if;
  insert into public.flow_cases(company_id, flow_id, case_no, title, party_id, amount, register_item_id, data, confidentiality)
  values (v_company, f.id, numero_private.next_doc_no(v_company, 'flow_case', upper(left(regexp_replace(f.key, '[^a-z0-9]', '', 'g'), 4)), current_date),
          trim(p->>'title'), (p->>'party_id')::uuid, (p->>'amount')::numeric, (p->>'register_item_id')::uuid, coalesce(p->'data', '{}'::jsonb), v_level)
  returning id into v_id;
  for s in select * from jsonb_array_elements(f.definition->'steps') loop
    v_n := v_n + 1;
    insert into public.flow_case_steps(case_id, company_id, step_no, step_key, name, action, actor_role, links_to, required_documents, optional, status)
    values (v_id, v_company, v_n, s->>'key', s->>'name', s->>'action', coalesce(s->>'actor_role', '*'), s->>'links_to',
            coalesce((select array_agg(e.value) from jsonb_array_elements_text(coalesce(s->'required_documents', '[]'::jsonb)) e), '{}'),
            coalesce((s->>'optional')::boolean, false), case when v_n = 1 then 'active' else 'pending' end);
  end loop;
  return v_id;
end $$;

-- Completes the step that is in turn. The step records what was done and points to the record that did it.
-- A workflow posts nothing and releases nothing: those belong to the engines whose records it points to.
create or replace function numero_private.complete_flow_step(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.flow_cases; s public.flow_case_steps; v_skip boolean := coalesce((p->>'skip')::boolean, false); v_doc text; v_have text[]; v_ok boolean; v_next int;
begin
  select * into c from public.flow_cases where id = (p->>'case_id')::uuid for update;
  if not found then raise exception 'NUMERO: case not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(c.company_id, 'flow.manage') then
    raise exception 'NUMERO: you are not authorised to work on this workflow.' using errcode = '42501';
  end if;
  if not numero_private.can_view_level(c.company_id, c.confidentiality) then
    raise exception 'NUMERO: you are not cleared for this case.' using errcode = '42501';
  end if;
  if c.status <> 'open' then raise exception 'NUMERO: this case is %.', c.status using errcode = 'P0001'; end if;
  select * into s from public.flow_case_steps where case_id = c.id and step_no = c.current_step for update;
  if s.actor_role <> '*' and not numero_private.has_role(c.company_id, s.actor_role)
     and not numero_private.is_group_admin(numero_private.company_group(c.company_id)) then
    raise exception 'NUMERO: the step "%" is for the role %.', s.name, s.actor_role using errcode = '42501';
  end if;
  if v_skip then
    if not s.optional then raise exception 'NUMERO: the step "%" cannot be skipped.', s.name using errcode = 'P0001'; end if;
    if coalesce(trim(p->>'note'), '') = '' then raise exception 'NUMERO: say why the step is skipped.' using errcode = 'P0001'; end if;
  else
    if s.action = 'approval' and c.started_by = (select auth.uid())
       and numero_private.maker_checker_mode(c.company_id) <> 'owner_override' then
      raise exception 'NUMERO: maker-checker control — the person who started this case cannot also approve it.' using errcode = '42501';
    end if;
    if s.links_to is not null then
      if (p->>'entity_id') is null then
        raise exception 'NUMERO: the step "%" is complete when it points to its record (%).', s.name, replace(s.links_to, '_', ' ') using errcode = 'P0001';
      end if;
      execute format('select exists (select 1 from public.%I x where x.id = $1 and x.company_id = $2)', s.links_to)
        into v_ok using (p->>'entity_id')::uuid, c.company_id;
      if not v_ok then raise exception 'NUMERO: that record was not found in this company.' using errcode = 'P0001'; end if;
    end if;
    -- the documents the step requires must be attached to the case, each of its kind
    select coalesce(array_agg(distinct d.doc_kind), '{}') into v_have
      from public.document_links l join public.documents d on d.id = l.document_id
     where l.entity = 'flow_cases' and l.entity_id = c.id;
    foreach v_doc in array s.required_documents loop
      if not v_doc = any(v_have) then
        raise exception 'NUMERO: the step "%" requires a document of the kind "%". Attach it to the case first.', s.name, v_doc using errcode = 'P0001';
      end if;
    end loop;
  end if;
  update public.flow_case_steps set status = case when v_skip then 'skipped' else 'done' end, entity = case when not v_skip then s.links_to end,
         entity_id = case when not v_skip then (p->>'entity_id')::uuid end, note = p->>'note', done_by = (select auth.uid()), done_at = now()
   where id = s.id;
  select min(step_no) into v_next from public.flow_case_steps where case_id = c.id and step_no > s.step_no;
  if v_next is null then
    update public.flow_cases set status = 'completed', completed_at = now() where id = c.id;
    return 'completed';
  end if;
  update public.flow_case_steps set status = 'active' where case_id = c.id and step_no = v_next;
  update public.flow_cases set current_step = v_next where id = c.id;
  return 'open';
end $$;

create or replace function numero_private.cancel_flow_case(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.flow_cases;
begin
  select * into c from public.flow_cases where id = p_id for update;
  if not found then raise exception 'NUMERO: case not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(c.company_id, 'flow.manage') then
    raise exception 'NUMERO: you are not authorised to work on this workflow.' using errcode = '42501';
  end if;
  if c.status <> 'open' then raise exception 'NUMERO: this case is %.', c.status using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'NUMERO: a reason is required.' using errcode = 'P0001'; end if;
  update public.flow_cases set status = 'cancelled', cancel_reason = p_reason, completed_at = now() where id = p_id;
end $$;

-- ---------- audit ----------
create trigger audit_scenarios after insert or update or delete on public.scenarios for each row execute function numero_private.audit_row();
create trigger audit_twin_drivers after insert or update or delete on public.twin_drivers for each row execute function numero_private.audit_row();
create trigger audit_flow_defs after insert or update or delete on public.flow_defs for each row execute function numero_private.audit_row();
create trigger audit_flow_cases after insert or update or delete on public.flow_cases for each row execute function numero_private.audit_row();
create trigger audit_flow_case_steps after insert or update or delete on public.flow_case_steps for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.scenarios enable row level security;
alter table public.scenario_runs enable row level security;
alter table public.twin_drivers enable row level security;
alter table public.flow_defs enable row level security;
alter table public.flow_cases enable row level security;
alter table public.flow_case_steps enable row level security;

create policy scenarios_select on public.scenarios for select to authenticated
  using (group_id = (select numero_private.my_group())
         and (created_by = (select auth.uid()) or (shared and (select numero_private.scenario_scope_ok(company_id, 'scenario.view')))));
-- a saved result carries figures: it is shown only to a person who may read every company in it
create policy scenario_runs_select on public.scenario_runs for select to authenticated
  using (exists (select 1 from public.scenarios s where s.id = scenario_id)
         and not exists (select 1 from unnest(company_ids) c(id)
                          where not (select numero_private.can(c.id, 'scenario.view')) or not (select numero_private.can(c.id, 'report.view'))));
create policy twin_drivers_select on public.twin_drivers for select to authenticated
  using (group_id = (select numero_private.my_group()) and (select numero_private.scenario_scope_ok(company_id, 'scenario.view')));
create policy flow_defs_select on public.flow_defs for select to authenticated
  using (group_id = (select numero_private.my_group()));
create policy flow_cases_select on public.flow_cases for select to authenticated
  using (((select numero_private.can(company_id, 'flow.view')) or started_by = (select auth.uid()))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy flow_case_steps_select on public.flow_case_steps for select to authenticated
  using (exists (select 1 from public.flow_cases c where c.id = case_id));

create or replace function public.save_scenario(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_scenario(p); $$;
create or replace function public.save_scenario_run(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_scenario_run(p); $$;
create or replace function public.save_twin_driver(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_twin_driver(p); $$;
create or replace function public.decide_twin_driver(p_id uuid, p_decision text) returns void language sql set search_path = '' as $$ select numero_private.decide_twin_driver(p_id, p_decision); $$;
create or replace function public.save_flow_def(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_flow_def(p); $$;
create or replace function public.set_flow_status(p_id uuid, p_status text) returns void language sql set search_path = '' as $$ select numero_private.set_flow_status(p_id, p_status); $$;
create or replace function public.clone_flow_def(p_id uuid, p_key text, p_name text, p_company uuid default null) returns uuid language sql set search_path = '' as $$ select numero_private.clone_flow_def(p_id, p_key, p_name, p_company); $$;
create or replace function public.start_flow_case(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.start_flow_case(p); $$;
create or replace function public.complete_flow_step(p jsonb) returns text language sql set search_path = '' as $$ select numero_private.complete_flow_step(p); $$;
create or replace function public.cancel_flow_case(p_id uuid, p_reason text) returns void language sql set search_path = '' as $$ select numero_private.cancel_flow_case(p_id, p_reason); $$;

insert into numero_private.internal_functions(name) values
  ('scenario_scope_ok'), ('flow_actions'), ('flow_links'), ('check_flow_definition')
on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927132834 · p3_16_policy_function_grant
-- scenario_scope_ok is called by the read policies of scenarios and twin_drivers, so the signed-in role must be able to run it.
-- It answers only whether the caller holds a permission for a company or for the group: the same question as numero_private.can().
delete from numero_private.internal_functions where name = 'scenario_scope_ok';
grant execute on function numero_private.scenario_scope_ok(uuid, text) to authenticated;

-- >>> applied as migration 20260927133503 · p3_17_flow_edit_scope
-- When a workflow is changed, the company and the key are those of the workflow on record, not of the request.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'save_flow_def';
  if position('the workflow on record decides' in v_def) = 0 then
    v_new := replace(v_def,
      '  if v_gid is null then raise exception ''NUMERO: authentication required.'' using errcode = ''42501''; end if;',
      '  if v_gid is null then raise exception ''NUMERO: authentication required.'' using errcode = ''42501''; end if;' || chr(10) ||
      '  if v_id is not null then' || chr(10) ||
      '    -- the workflow on record decides which company, and which key, the change belongs to' || chr(10) ||
      '    select * into f from public.flow_defs where id = v_id and group_id = v_gid;' || chr(10) ||
      '    if not found then raise exception ''NUMERO: workflow not found.'' using errcode = ''P0001''; end if;' || chr(10) ||
      '    v_company := f.company_id; v_key := f.key;' || chr(10) ||
      '  end if;');
    if v_new = v_def then raise exception 'NUMERO: save_flow_def could not be corrected.'; end if;
    execute v_new;
  end if;
end $$;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927150649 · p3_19_driver_superseded_on_approval
-- A driver that simulations rely on stays in use until its successor is approved.
-- Proposing a new value used to retire the approved driver at once, so that between the
-- proposal and its approval no driver of that key existed. Now a proposal replaces only an
-- earlier proposal; the approved driver is retired when the new one is approved.
-- Non-destructive: an index is replaced by a wider one, two functions are replaced. No row is changed.

drop index if exists public.twin_drivers_key;
create unique index twin_drivers_key on public.twin_drivers(group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key, status) where status <> 'retired';

create or replace function numero_private.save_twin_driver(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_company uuid := (p->>'company_id')::uuid; v_id uuid;
begin
  if not numero_private.scenario_scope_ok(v_company, 'scenario.manage') then
    raise exception 'NUMERO: you are not authorised to propose drivers.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'key'), '') = '' or coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: a driver needs a key and a name.' using errcode = 'P0001'; end if;
  if (p->>'value') is null then raise exception 'NUMERO: a driver needs its value.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'basis'), '') = '' then raise exception 'NUMERO: a driver states what it rests on.' using errcode = 'P0001'; end if;
  -- a new proposal takes the place of an earlier proposal; what is approved stays in use
  update public.twin_drivers set status = 'retired'
   where group_id = v_gid and company_id is not distinct from v_company and key = lower(trim(p->>'key')) and status = 'proposed';
  insert into public.twin_drivers(group_id, company_id, key, name, unit, value, basis, source)
  values (v_gid, v_company, lower(trim(p->>'key')), trim(p->>'name'), coalesce(p->>'unit', 'amount'), (p->>'value')::numeric, trim(p->>'basis'), coalesce(p->>'source', 'assumed'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.decide_twin_driver(p_id uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.twin_drivers;
begin
  select * into d from public.twin_drivers where id = p_id and group_id = numero_private.my_group() for update;
  if not found then raise exception 'NUMERO: driver not found.' using errcode = 'P0001'; end if;
  if not numero_private.scenario_scope_ok(d.company_id, 'scenario.manage') then
    raise exception 'NUMERO: you are not authorised to approve drivers.' using errcode = '42501';
  end if;
  if p_decision not in ('approved','retired') then raise exception 'NUMERO: the decision is approved or retired.' using errcode = 'P0001'; end if;
  -- a proposal is approved or retired; a driver in use can be retired
  if d.status = 'retired' or (d.status = 'approved' and p_decision = 'approved') then
    raise exception 'NUMERO: this driver is %.', d.status using errcode = 'P0001';
  end if;
  if p_decision = 'approved' and d.created_by = (select auth.uid()) then
    raise exception 'NUMERO: maker-checker control — the person who proposed this assumption cannot also approve it.' using errcode = '42501';
  end if;
  if p_decision = 'approved' then
    -- the driver it succeeds leaves use at the same moment
    update public.twin_drivers set status = 'retired'
     where group_id = d.group_id and company_id is not distinct from d.company_id and key = d.key and status = 'approved' and id <> d.id;
    update public.twin_drivers set status = 'approved', approved_by = (select auth.uid()), approved_at = now() where id = p_id;
  else
    update public.twin_drivers set status = 'retired' where id = p_id;
  end if;
end $$;

revoke all on all functions in schema numero_private from public, anon, authenticated;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927151329 · p3_20_flow_approval_maker_checker
-- The approval step of a workflow case follows the rule of every other approval:
-- the person who started the case cannot approve it. Where the group allows the owner to
-- override, only a Group Super Admin may, as for journals. Before this, the setting
-- "owner_override" let ANY person approve the case they had started.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('numero_private.complete_flow_step(jsonb)'::regprocedure);
  v_new := replace(v_def,
    'and numero_private.maker_checker_mode(c.company_id) <> ''owner_override'' then',
    'and not (numero_private.maker_checker_mode(c.company_id) = ''owner_override'' and numero_private.is_group_admin(numero_private.company_group(c.company_id))) then');
  if v_new = v_def then raise exception 'p3_20: complete_flow_step was not changed'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema numero_private from public, anon, authenticated;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927152913 · p3_22_flow_own_request_step
-- A person who may start a case may also complete their own part of it.
-- Starting a case needs flow.view or flow.manage; completing any step needed flow.manage, so a
-- person with flow.view alone (an employee) could raise a request and then not state it.
-- Now the person who started a case completes its steps of kind "request" and "evidence" —
-- what they ask for, and the documents they hand in. Every other step still needs flow.manage,
-- and the approval step still refuses the person who started the case.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('numero_private.complete_flow_step(jsonb)'::regprocedure);
  v_new := replace(v_def,
    'if not numero_private.can(c.company_id, ''flow.manage'') then',
    'select * into s from public.flow_case_steps where case_id = c.id and step_no = c.current_step;' || E'\n  ' ||
    'if not numero_private.can(c.company_id, ''flow.manage'')' || E'\n     ' ||
    'and not (c.started_by = (select auth.uid()) and s.action in (''request'', ''evidence'') and numero_private.can(c.company_id, ''flow.view'')) then');
  if v_new = v_def then raise exception 'p3_22: complete_flow_step was not changed'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema numero_private from public, anon, authenticated;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927152933 · p3_23_flow_own_step_null_safe
-- The rule of p3_22 made safe against a case that has no step in turn: nothing unknown is read as permission.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('numero_private.complete_flow_step(jsonb)'::regprocedure);
  v_new := replace(v_def,
    'and not (c.started_by = (select auth.uid()) and s.action in (''request'', ''evidence'') and numero_private.can(c.company_id, ''flow.view'')) then',
    'and not coalesce(c.started_by = (select auth.uid()) and s.action in (''request'', ''evidence'') and numero_private.can(c.company_id, ''flow.view''), false) then');
  if v_new = v_def then raise exception 'p3_23: complete_flow_step was not changed'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema numero_private from public, anon, authenticated;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();
