-- =====================================================================
-- GHL NUMERO · 0001 · CORE TENANCY, ROLES, PERMISSIONS, IMMUTABLE AUDIT
-- Spec: 1, 2, 43, 45, 65, 66, 1304-1322, 1483-1485, 1546
-- Principles: tenant isolation at the data layer (RLS), least privilege,
-- helper functions live in a non-exposed schema, audit log is append-only.
-- =====================================================================

create schema if not exists numero_private;
revoke all on schema numero_private from public;
grant usage on schema numero_private to authenticated;

-- ---------- deployment configuration (no client access at all) ----------
create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;

-- ---------- groups / profiles / companies ----------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency text not null default 'INR',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  group_id uuid references public.groups(id),
  is_group_super_admin boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index profiles_group_idx on public.profiles(group_id);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  code text not null,
  name text not null,
  legal_name text,
  business_type text,
  industry text,
  country text not null default 'IN',
  state text,
  registered_address text,
  operating_locations text,
  tax_jurisdiction text,
  pan text,
  gstin text,
  cin text,
  registration_numbers jsonb not null default '{}'::jsonb,
  fy_start_month int not null default 4 check (fy_start_month between 1 and 12),
  base_currency text not null default 'INR',
  additional_currencies text[] not null default '{}',
  accounting_method text not null default 'accrual' check (accounting_method in ('accrual','cash')),
  modules jsonb not null default '{}'::jsonb,
  template_key text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (group_id, code)
);
create index companies_group_idx on public.companies(group_id);

-- ---------- roles & permissions ----------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (group_id, key)
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission text not null,
  primary key (role_id, permission)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  role_id uuid not null references public.roles(id),
  valid_from date,
  valid_to date,
  granted_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (user_id, company_id, role_id)
);
create index memberships_user_idx on public.memberships(user_id);
create index memberships_company_idx on public.memberships(company_id);

-- ---------- immutable audit log ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  group_id uuid,
  company_id uuid,
  entity text not null,
  entity_id uuid,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  meta jsonb
);
create index audit_company_idx on public.audit_log(company_id, at desc);
create index audit_entity_idx on public.audit_log(entity, entity_id);
create index audit_group_idx on public.audit_log(group_id, at desc);

create or replace function numero_private.audit_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'NUMERO: the audit trail is append-only. History cannot be altered or erased.' using errcode = 'P0001';
end $$;

create trigger audit_no_update before update or delete on public.audit_log
  for each row execute function numero_private.audit_is_append_only();
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function numero_private.audit_is_append_only();

-- ---------- helper functions (SECURITY DEFINER, non-exposed schema) ----------
create or replace function numero_private.my_group() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.group_id from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function numero_private.is_group_admin(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.group_id = gid and p.is_group_super_admin
  );
$$;

create or replace function numero_private.has_company_access(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.companies c
           where c.id = cid and numero_private.is_group_admin(c.group_id))
      or exists (
           select 1 from public.memberships m
           where m.company_id = cid and m.user_id = (select auth.uid())
             and (m.valid_from is null or m.valid_from <= current_date)
             and (m.valid_to is null or m.valid_to >= current_date));
$$;

create or replace function numero_private.can(cid uuid, perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.companies c
           where c.id = cid and numero_private.is_group_admin(c.group_id))
      or exists (
           select 1 from public.memberships m
           join public.role_permissions rp on rp.role_id = m.role_id
           where m.company_id = cid and m.user_id = (select auth.uid())
             and rp.permission = perm
             and (m.valid_from is null or m.valid_from <= current_date)
             and (m.valid_to is null or m.valid_to >= current_date));
$$;

create or replace function numero_private.has_role(cid uuid, role_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.company_id = cid and m.user_id = (select auth.uid()) and r.key = role_key
      and (m.valid_from is null or m.valid_from <= current_date)
      and (m.valid_to is null or m.valid_to >= current_date));
$$;

create or replace function numero_private.company_group(cid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.group_id from public.companies c where c.id = cid;
$$;

-- Generic row audit trigger. Reason is passed by workflow functions through
-- the transaction-local setting numero.reason.
create or replace function numero_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb; v_new jsonb; v_id uuid; v_company uuid; v_group uuid;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  begin
    v_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
  exception when others then v_id := null;
  end;
  v_company := coalesce(v_new->>'company_id', v_old->>'company_id')::uuid;
  v_group := coalesce(v_new->>'group_id', v_old->>'group_id')::uuid;
  if tg_table_name = 'companies' then v_company := v_id; end if;
  if tg_table_name = 'groups' then v_group := v_id; end if;
  if v_group is null and v_company is not null then
    select c.group_id into v_group from public.companies c where c.id = v_company;
  end if;
  insert into public.audit_log(actor, group_id, company_id, entity, entity_id, action, old_value, new_value, reason)
  values ((select auth.uid()), v_group, v_company, tg_table_name, v_id, lower(tg_op), v_old, v_new,
          nullif(current_setting('numero.reason', true), ''));
  return coalesce(new, old);
end $$;

create or replace function numero_private.log_event(
  p_company uuid, p_entity text, p_entity_id uuid, p_action text,
  p_old jsonb, p_new jsonb, p_reason text, p_meta jsonb default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_group uuid;
begin
  if p_company is not null then
    select c.group_id into v_group from public.companies c where c.id = p_company;
  else
    v_group := numero_private.my_group();
  end if;
  insert into public.audit_log(actor, group_id, company_id, entity, entity_id, action, old_value, new_value, reason, meta)
  values ((select auth.uid()), v_group, p_company, p_entity, p_entity_id, p_action, p_old, p_new, p_reason, p_meta);
end $$;

-- ---------- profile bootstrap on signup ----------
create or replace function numero_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function numero_private.handle_new_user();

-- Privileged profile columns can never be changed directly by a client.
create or replace function numero_private.guard_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.is_group_super_admin is distinct from old.is_group_super_admin
       or new.group_id is distinct from old.group_id
       or new.id is distinct from old.id then
      raise exception 'NUMERO: privilege fields can only change through controlled administration functions.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function numero_private.guard_profile();

-- ---------- system roles ----------
create or replace function numero_private.seed_roles(gid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_role uuid; p text;
  all_perms text[] := array[
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
begin
  for r in select * from (values
    ('owner','Owner', all_perms),
    ('group_cfo','Group CFO', all_perms),
    ('company_director','Company Director', array['company.view','account.view','journal.view','journal.approve','journal.reject','invoice.view','invoice.approve','bill.view','bill.approve','payment.view','payment.approve','party.view','bank.view','budget.view','budget.approve','report.view','report.export','audit.view','sentinel.view','numi.use']),
    ('finance_head','Finance Head', array['company.view','account.view','account.configure','orgunit.configure','journal.view','journal.create','journal.edit','journal.submit','journal.approve','journal.reject','journal.post','journal.reverse','invoice.view','invoice.create','invoice.approve','bill.view','bill.create','bill.approve','payment.view','payment.create','payment.approve','party.view','party.create','party.edit','party.bank.verify','bank.view','bank.import','bank.reconcile','budget.view','budget.edit','budget.approve','period.lock','report.view','report.export','audit.view','sentinel.view','sentinel.review','numi.use','tax.configure','approval.configure']),
    ('accountant','Accountant', array['company.view','account.view','journal.view','journal.create','journal.edit','journal.submit','journal.post','invoice.view','invoice.create','bill.view','bill.create','payment.view','payment.create','party.view','party.create','party.edit','bank.view','bank.import','bank.reconcile','budget.view','report.view','report.export','sentinel.view','numi.use']),
    ('junior_accountant','Junior Accountant', array['company.view','account.view','journal.view','journal.create','journal.edit','journal.submit','invoice.view','invoice.create','bill.view','bill.create','payment.view','payment.create','party.view','bank.view','report.view','numi.use']),
    ('auditor','Auditor', array['company.view','account.view','journal.view','invoice.view','bill.view','payment.view','party.view','bank.view','budget.view','report.view','report.export','audit.view','sentinel.view','numi.use']),
    ('tax_consultant','Tax Consultant', array['company.view','account.view','journal.view','invoice.view','bill.view','report.view','report.export','numi.use']),
    ('department_head','Department Head', array['company.view','budget.view','report.view','journal.view','numi.use']),
    ('project_manager','Project Manager', array['company.view','budget.view','report.view','numi.use']),
    ('purchase_manager','Purchase Manager', array['company.view','bill.view','bill.create','party.view','party.create','report.view','numi.use']),
    ('sales_manager','Sales Manager', array['company.view','invoice.view','invoice.create','party.view','party.create','report.view','numi.use']),
    ('employee','Employee', array['company.view','numi.use']),
    ('read_only','Read Only', array['company.view','account.view','journal.view','invoice.view','bill.view','payment.view','party.view','bank.view','budget.view','report.view'])
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

-- ---------- bootstrap: first Group Super Admin ----------
create or replace function numero_private.bootstrap_group(p_name text, p_currency text, p_maker_checker text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_owner text; v_gid uuid; v_multi boolean;
begin
  if v_uid is null then raise exception 'NUMERO: authentication required.'; end if;
  if p_maker_checker not in ('enforced', 'owner_override') then
    raise exception 'NUMERO: maker-checker mode must be enforced or owner_override.';
  end if;
  select email into v_email from public.profiles where id = v_uid;
  if exists (select 1 from public.profiles where id = v_uid and group_id is not null) then
    raise exception 'NUMERO: this user already belongs to a group.';
  end if;
  select value #>> '{}' into v_owner from public.app_config where key = 'owner_email';
  select coalesce((value #>> '{}')::boolean, false) into v_multi from public.app_config where key = 'allow_multiple_groups';
  if v_owner is not null and lower(v_owner) <> lower(coalesce(v_email, '')) then
    raise exception 'NUMERO: only the designated owner can initialise this financial universe.';
  end if;
  if not coalesce(v_multi, false) and exists (select 1 from public.groups) then
    raise exception 'NUMERO: this deployment is already initialised. Ask the Group Super Admin for access.';
  end if;

  insert into public.groups(name, base_currency, settings, created_by)
  values (p_name, coalesce(p_currency, 'INR'),
          jsonb_build_object('controls', jsonb_build_object('maker_checker', p_maker_checker)), v_uid)
  returning id into v_gid;

  update public.profiles set group_id = v_gid, is_group_super_admin = true where id = v_uid;
  perform numero_private.seed_roles(v_gid);
  perform numero_private.log_event(null, 'groups', v_gid, 'bootstrap', null,
    jsonb_build_object('name', p_name, 'maker_checker', p_maker_checker), 'Financial universe initialised');
  return v_gid;
end $$;

create or replace function public.bootstrap_group(p_name text, p_currency text default 'INR', p_maker_checker text default 'enforced')
returns uuid language sql set search_path = '' as $$
  select numero_private.bootstrap_group(p_name, p_currency, p_maker_checker);
$$;

-- ---------- membership administration ----------
create or replace function numero_private.grant_membership(
  p_email text, p_company uuid, p_role_key text, p_valid_from date, p_valid_to date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid; v_user uuid; v_user_group uuid; v_role uuid; v_id uuid;
begin
  select group_id into v_gid from public.companies where id = p_company;
  if v_gid is null or not numero_private.is_group_admin(v_gid) then
    raise exception 'NUMERO: only a Group Super Admin can grant access.';
  end if;
  select id, group_id into v_user, v_user_group from public.profiles where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'NUMERO: no user with email % has signed up yet.', p_email;
  end if;
  if v_user_group is not null and v_user_group <> v_gid then
    raise exception 'NUMERO: this user belongs to a different group.';
  end if;
  select id into v_role from public.roles where group_id = v_gid and key = p_role_key;
  if v_role is null then raise exception 'NUMERO: unknown role %.', p_role_key; end if;
  if v_user_group is null then update public.profiles set group_id = v_gid where id = v_user; end if;
  insert into public.memberships(user_id, company_id, role_id, valid_from, valid_to, granted_by)
  values (v_user, p_company, v_role, p_valid_from, p_valid_to, (select auth.uid()))
  on conflict (user_id, company_id, role_id) do update set valid_from = excluded.valid_from, valid_to = excluded.valid_to
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.grant_membership(
  p_email text, p_company uuid, p_role_key text, p_valid_from date default null, p_valid_to date default null)
returns uuid language sql set search_path = '' as $$
  select numero_private.grant_membership(p_email, p_company, p_role_key, p_valid_from, p_valid_to);
$$;

-- ---------- audit triggers ----------
create trigger audit_groups after insert or update or delete on public.groups
  for each row execute function numero_private.audit_row();
create trigger audit_companies after insert or update or delete on public.companies
  for each row execute function numero_private.audit_row();
create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function numero_private.audit_row();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.groups enable row level security;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;

create policy groups_select on public.groups for select to authenticated
  using (id = (select numero_private.my_group()));
create policy groups_update on public.groups for update to authenticated
  using ((select numero_private.is_group_admin(id))) with check ((select numero_private.is_group_admin(id)));

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (group_id is not null and group_id = (select numero_private.my_group())));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy companies_select on public.companies for select to authenticated
  using ((select numero_private.has_company_access(id)));
create policy companies_update on public.companies for update to authenticated
  using ((select numero_private.can(id, 'company.configure')))
  with check ((select numero_private.can(id, 'company.configure')));

create policy roles_select on public.roles for select to authenticated
  using (group_id = (select numero_private.my_group()));
create policy roles_write on public.roles for all to authenticated
  using ((select numero_private.is_group_admin(group_id)))
  with check ((select numero_private.is_group_admin(group_id)));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and numero_private.is_group_admin(r.group_id)))
  with check (exists (select 1 from public.roles r where r.id = role_id and numero_private.is_group_admin(r.group_id)));

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or (select numero_private.is_group_admin(numero_private.company_group(company_id))));
create policy memberships_delete on public.memberships for delete to authenticated
  using ((select numero_private.is_group_admin(numero_private.company_group(company_id))));

create policy audit_select on public.audit_log for select to authenticated
  using (
    (group_id is not null and (select numero_private.is_group_admin(group_id)))
    or (company_id is not null and (select numero_private.can(company_id, 'audit.view')))
  );

-- ---------- grants ----------
-- Private functions: never callable by anon/public. The schema is not exposed through the API.
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
-- Public RPC wrappers: authenticated users only.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
