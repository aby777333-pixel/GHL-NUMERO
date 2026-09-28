-- >>> applied as migration 20260927131747 · p3_12_platform_notifications_health
-- =====================================================================
-- GHL NUMERO · 0018 · PLATFORM
-- Notifications, communications, register of integrations, feature flags,
-- backup records, system health.
-- Spec: 60, 61, 592, 598, 608, 1277, 1280, 1428-1432, 1543
--
-- What is NOT here, and is said plainly wherever it matters:
--   * NUMERO sends nothing outside itself. No email, SMS, push or WhatsApp
--     provider is connected. A communication is PREPARED here and sent by a
--     person; NUMERO records that it was sent.
--   * No integration is connected. The register describes integrations,
--     their scope and their risk. It holds no key, password or token.
--   * NUMERO cannot see the backups of its own database. A person records
--     each backup and each restore test.
-- =====================================================================

-- ---------- notifications (in the application) ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  company_id uuid references public.companies(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  class text not null default 'information'
    check (class in ('information','finance_action','management_action','owner_action','critical')),
  title text not null,
  body text,
  entity text,
  entity_id uuid,
  mandatory boolean not null default false,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications(user_id, read_at, created_at desc);

create table public.notification_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  channel text not null default 'in_app' check (channel in ('in_app','email','push','sms','whatsapp')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, channel)
);

-- who attends to what (spec 608): the class of an alert or an approval, by kind and amount
create table public.attention_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  kind text not null,                 -- an alert kind, 'approval:<entity>' or '*'
  min_amount numeric(20,4) not null default 0,
  class text not null check (class in ('information','finance_action','management_action','owner_action','critical')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (group_id, kind, min_amount)
);

create or replace function numero_private.attention_class(p_group uuid, p_kind text, p_amount numeric, p_default text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.class from public.attention_rules r
     where r.group_id = p_group and r.kind in (p_kind, '*') and coalesce(p_amount, 0) >= r.min_amount
     order by (r.kind = p_kind) desc, r.min_amount desc limit 1), p_default);
$$;

-- Tells every person who holds a permission in a company. A person is never told about their own action.
create or replace function numero_private.notify_holders(
  p_company uuid, p_perm text, p_except uuid, p_kind text, p_class text, p_title text, p_body text,
  p_entity text, p_entity_id uuid, p_dedupe text, p_mandatory boolean default false) returns int
language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_n int;
begin
  select group_id into v_group from public.companies where id = p_company;
  insert into public.notifications(group_id, company_id, user_id, kind, class, title, body, entity, entity_id, mandatory, dedupe_key)
  select distinct v_group, p_company, u.user_id, p_kind, p_class, p_title, p_body, p_entity, p_entity_id, p_mandatory, p_dedupe
    from (
      select m.user_id from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
       where m.company_id = p_company and rp.permission = p_perm
         and (m.valid_from is null or m.valid_from <= current_date) and (m.valid_to is null or m.valid_to >= current_date)
      union
      select pr.id from public.profiles pr where pr.group_id = v_group and pr.is_group_admin) u
   where u.user_id is distinct from p_except
     and (p_mandatory or not exists (
           select 1 from public.notification_prefs np where np.user_id = u.user_id and np.kind = p_kind and np.channel = 'in_app' and not np.enabled))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function numero_private.notify_user(
  p_company uuid, p_user uuid, p_kind text, p_class text, p_title text, p_body text, p_entity text, p_entity_id uuid, p_dedupe text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user = (select auth.uid()) then return; end if;
  if exists (select 1 from public.notification_prefs np where np.user_id = p_user and np.kind = p_kind and np.channel = 'in_app' and not np.enabled) then return; end if;
  insert into public.notifications(group_id, company_id, user_id, kind, class, title, body, entity, entity_id, dedupe_key)
  values ((select group_id from public.companies where id = p_company), p_company, p_user, p_kind, p_class, p_title, p_body, p_entity, p_entity_id, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing;
end $$;

-- an approval waiting
create or replace function numero_private.on_approval_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_perm text; v_group uuid;
begin
  if new.status <> 'pending' then return new; end if;
  v_perm := case new.entity when 'journal' then 'journal.approve' when 'advance' then 'expense.approve' when 'expense_claim' then 'expense.approve'
              when 'requisition' then 'purchase.approve' when 'purchase_order' then 'purchase.approve'
              when 'capital_call' then 'investment.approve' when 'distribution' then 'investment.approve' else 'journal.approve' end;
  select group_id into v_group from public.companies where id = new.company_id;
  perform numero_private.notify_holders(new.company_id, v_perm, new.requested_by, 'approval_waiting',
    numero_private.attention_class(v_group, 'approval:' || new.entity, new.amount, 'finance_action'),
    'Approval waiting — ' || replace(new.entity, '_', ' '), coalesce(new.summary, '') || ' · ' || new.amount,
    new.entity, new.entity_id, 'approval:' || new.id::text, true);
  return new;
end $$;
create trigger notify_approval_request after insert on public.approval_requests for each row execute function numero_private.on_approval_request();

-- an alert that needs more than routine review
create or replace function numero_private.on_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_default text;
begin
  if new.attention not in ('priority','critical') then return new; end if;
  select group_id into v_group from public.companies where id = new.company_id;
  v_default := case new.attention when 'critical' then 'critical' else 'management_action' end;
  perform numero_private.notify_holders(new.company_id, 'sentinel.view', null, 'alert',
    numero_private.attention_class(v_group, new.kind, (new.evidence->>'amount')::numeric, v_default),
    new.title, new.explanation, coalesce(new.entity, 'alerts'), coalesce(new.entity_id, new.id), 'alert:' || new.id::text, new.attention = 'critical');
  return new;
exception when others then
  return new;      -- an alert is never lost because a notification could not be written
end $$;
create trigger notify_alert after insert on public.alerts for each row execute function numero_private.on_alert();

-- a follow-up given to a person, a case given to a person
create or replace function numero_private.on_task_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_user is not null and (tg_op = 'INSERT' or new.owner_user is distinct from old.owner_user) and new.status in ('open','in_progress') then
    perform numero_private.notify_user(new.company_id, new.owner_user, 'follow_up_assigned', 'finance_action',
      'Follow-up for you — ' || new.title, coalesce('Due ' || new.due_date::text, 'No due date'), 'tasks', new.id, 'task:' || new.id::text || ':' || new.owner_user::text);
  end if;
  return new;
end $$;
create trigger notify_task after insert or update of owner_user on public.tasks for each row execute function numero_private.on_task_assigned();

create or replace function numero_private.on_case_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_user is not null and (tg_op = 'INSERT' or new.owner_user is distinct from old.owner_user) and new.status <> 'closed' then
    perform numero_private.notify_user(new.company_id, new.owner_user, 'case_assigned', new.attention,
      'Case for you — ' || new.case_no, new.title, 'cases', new.id, 'case:' || new.id::text || ':' || new.owner_user::text);
  end if;
  return new;
end $$;
create trigger notify_case after insert or update of owner_user on public.cases for each row execute function numero_private.on_case_assigned();

-- Things that become due with the passing of time. Nothing in NUMERO runs on a schedule:
-- this is run when a person opens the application, and looks only at what that person may see.
create or replace function numero_private.refresh_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_group uuid := numero_private.my_group(); v_n int := 0; v_c int; r record;
begin
  if v_uid is null then return 0; end if;
  -- follow-ups of mine that are due or overdue
  insert into public.notifications(group_id, company_id, user_id, kind, class, title, body, entity, entity_id, dedupe_key)
  select v_group, t.company_id, v_uid, 'follow_up_due', case when t.due_date < current_date then 'management_action' else 'finance_action' end,
         case when t.due_date < current_date then 'Follow-up overdue — ' else 'Follow-up due — ' end || t.title, 'Due ' || t.due_date, 'tasks', t.id,
         'taskdue:' || t.id::text || ':' || t.due_date::text
    from public.tasks t
   where t.owner_user = v_uid and t.status in ('open','in_progress') and t.due_date <= current_date + 2
     and numero_private.has_company_access(t.company_id)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  -- deadlines and renewals in the registers I may read
  insert into public.notifications(group_id, company_id, user_id, kind, class, title, body, entity, entity_id, dedupe_key)
  select v_group, i.company_id, v_uid, 'deadline', case when i.next_due < current_date then 'management_action' else 'finance_action' end,
         case when i.kind = 'compliance' then 'Compliance deadline — ' else 'Falls due — ' end || i.title,
         i.ref_no || ' · due ' || i.next_due, 'register_items', i.id, 'due:' || i.id::text || ':' || i.next_due::text
    from public.register_items i
   where i.status = 'active' and i.next_due between current_date - 30 and current_date + 7
     and i.kind in ('compliance','insurance','rent','lease','amc','subscription','software_licence','domain_hosting','bank_guarantee','letter_of_credit','covenant')
     and numero_private.can(i.company_id, 'register.view') and numero_private.can_view_level(i.company_id, i.confidentiality)
     and not exists (select 1 from public.notification_prefs np where np.user_id = v_uid and np.kind = 'deadline' and np.channel = 'in_app' and not np.enabled)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  -- approvals I could decide that have waited more than three days
  insert into public.notifications(group_id, company_id, user_id, kind, class, title, body, entity, entity_id, mandatory, dedupe_key)
  select v_group, a.company_id, v_uid, 'approval_waiting_long', 'management_action',
         'Waiting ' || (current_date - a.requested_at::date) || ' days for approval — ' || replace(a.entity, '_', ' '), coalesce(a.summary, ''),
         a.entity, a.entity_id, true, 'approvallong:' || a.id::text || ':' || to_char(current_date, 'IYYY-IW')
    from public.approval_requests a
   where a.status = 'pending' and a.requested_at < now() - interval '3 days' and a.requested_by is distinct from v_uid
     and numero_private.can(a.company_id, case a.entity when 'journal' then 'journal.approve' when 'advance' then 'expense.approve' when 'expense_claim' then 'expense.approve'
              when 'requisition' then 'purchase.approve' when 'purchase_order' then 'purchase.approve'
              when 'capital_call' then 'investment.approve' when 'distribution' then 'investment.approve' else 'journal.approve' end)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  -- bank statements that have not been reconciled, for those who reconcile
  for r in select b.company_id, b.id, b.name, count(*) as n, min(t.txn_date) as oldest
             from public.bank_transactions t join public.bank_accounts b on b.id = t.bank_account_id
            where t.status in ('unmatched','suggested','needs_review') and t.txn_date < current_date - 7
              and numero_private.can(b.company_id, 'bank.reconcile')
            group by b.company_id, b.id, b.name loop
    insert into public.notifications(group_id, company_id, user_id, kind, class, title, body, entity, entity_id, dedupe_key)
    values (v_group, r.company_id, v_uid, 'reconciliation_incomplete', 'finance_action',
            'Bank reconciliation incomplete — ' || r.name, r.n || ' statement line(s) are unmatched, the oldest of ' || r.oldest,
            'bank_accounts', r.id, 'recon:' || r.id::text || ':' || to_char(current_date, 'IYYY-IW'))
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_c = row_count; v_n := v_n + v_c;
  end loop;
  return v_n;
end $$;

create or replace function numero_private.mark_notifications(p_ids uuid[], p_read boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.notifications set read_at = case when p_read then coalesce(read_at, now()) end
   where user_id = (select auth.uid()) and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- A person chooses what they are told. What governance requires cannot be switched off.
create or replace function numero_private.set_notification_pref(p_kind text, p_channel text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'NUMERO: authentication required.' using errcode = '42501'; end if;
  if p_channel not in ('in_app','email','push','sms','whatsapp') then raise exception 'NUMERO: unknown channel.' using errcode = 'P0001'; end if;
  if not p_enabled and p_kind in ('approval_waiting','approval_waiting_long') then
    raise exception 'NUMERO: approvals that wait for you are a governance notice and cannot be switched off.' using errcode = 'P0001';
  end if;
  insert into public.notification_prefs(user_id, kind, channel, enabled) values ((select auth.uid()), p_kind, p_channel, p_enabled)
  on conflict (user_id, kind, channel) do update set enabled = excluded.enabled, updated_at = now();
end $$;

create or replace function numero_private.save_attention_rule(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_id uuid;
begin
  if not numero_private.is_group_admin(v_gid) then
    raise exception 'NUMERO: only a Group Super Admin decides who attends to what.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'kind'), '') = '' then raise exception 'NUMERO: state the kind of notice the rule is for.' using errcode = 'P0001'; end if;
  if p->>'class' is null or p->>'class' not in ('information','finance_action','management_action','owner_action','critical') then
    raise exception 'NUMERO: unknown class of attention.' using errcode = 'P0001';
  end if;
  if coalesce((p->>'remove')::boolean, false) then
    delete from public.attention_rules where group_id = v_gid and kind = p->>'kind' and min_amount = coalesce((p->>'min_amount')::numeric, 0);
    return null;
  end if;
  insert into public.attention_rules(group_id, kind, min_amount, class, note)
  values (v_gid, trim(p->>'kind'), coalesce((p->>'min_amount')::numeric, 0), p->>'class', p->>'note')
  on conflict (group_id, kind, min_amount) do update set class = excluded.class, note = excluded.note
  returning id into v_id;
  return v_id;
end $$;

-- ---------- communications: prepared here, sent by a person ----------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  company_id uuid references public.companies(id),
  key text not null check (key in ('invoice','payment_reminder','statement','receipt','approval_request','report','confirmation','capital_call','other')),
  name text not null,
  subject text not null,
  body text not null,
  is_active boolean not null default true,
  version int not null default 1,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index message_templates_key on public.message_templates(group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key, version);

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  channel text not null default 'email' check (channel in ('email','letter','whatsapp','sms','phone','in_person','portal')),
  template_key text,
  party_id uuid references public.parties(id),
  to_address text,
  subject text not null,
  body text not null,
  entity text,
  entity_id uuid,
  status text not null default 'prepared' check (status in ('prepared','sent_by_person','not_sent')),
  sent_on date,
  sent_note text,
  prepared_by uuid default auth.uid(),
  prepared_at timestamptz not null default now()
);
create index communications_party_idx on public.communications(company_id, party_id, prepared_at desc);
create index communications_entity_idx on public.communications(entity, entity_id);

create or replace function numero_private.save_message_template(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_company uuid := (p->>'company_id')::uuid; v_id uuid; v_ver int;
begin
  if not ((v_company is not null and numero_private.can(v_company, 'company.configure')) or numero_private.is_group_admin(v_gid)) then
    raise exception 'NUMERO: you are not authorised to maintain message templates.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'name'), '') = '' or coalesce(trim(p->>'subject'), '') = '' or coalesce(trim(p->>'body'), '') = '' then
    raise exception 'NUMERO: a template needs a name, a subject and a body.' using errcode = 'P0001';
  end if;
  -- a template that has been used is not overwritten: what was sent stays as it was sent
  update public.message_templates set is_active = false
   where group_id = v_gid and company_id is not distinct from v_company and key = p->>'key' and is_active;
  select coalesce(max(version), 0) + 1 into v_ver from public.message_templates
   where group_id = v_gid and company_id is not distinct from v_company and key = p->>'key';
  insert into public.message_templates(group_id, company_id, key, name, subject, body, version)
  values (v_gid, v_company, p->>'key', trim(p->>'name'), p->>'subject', p->>'body', v_ver)
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.prepare_communication(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid;
begin
  if not numero_private.can(v_company, 'communication.send') then
    raise exception 'NUMERO: you are not authorised to prepare communications for this company.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'subject'), '') = '' or coalesce(trim(p->>'body'), '') = '' then
    raise exception 'NUMERO: a communication needs a subject and a body.' using errcode = 'P0001';
  end if;
  perform numero_private.inv_party(v_company, (p->>'party_id')::uuid, 'party');
  insert into public.communications(company_id, channel, template_key, party_id, to_address, subject, body, entity, entity_id)
  values (v_company, coalesce(p->>'channel', 'email'), p->>'template_key', (p->>'party_id')::uuid, p->>'to_address', p->>'subject', p->>'body',
          p->>'entity', (p->>'entity_id')::uuid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.mark_communication(p_id uuid, p_status text, p_sent_on date, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.communications;
begin
  select * into c from public.communications where id = p_id for update;
  if not found then raise exception 'NUMERO: communication not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(c.company_id, 'communication.send') then
    raise exception 'NUMERO: you are not authorised to record communications for this company.' using errcode = '42501';
  end if;
  if c.status <> 'prepared' then raise exception 'NUMERO: this communication is already recorded as %.', replace(c.status, '_', ' ') using errcode = 'P0001'; end if;
  if p_status not in ('sent_by_person','not_sent') then raise exception 'NUMERO: record whether it was sent or not.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'NUMERO: record how it was sent, or why it was not.' using errcode = 'P0001'; end if;
  update public.communications set status = p_status, sent_on = case when p_status = 'sent_by_person' then coalesce(p_sent_on, current_date) end, sent_note = p_note where id = p_id;
end $$;

-- what has been sent is a record of what was said: it is never altered or removed
create or replace function numero_private.guard_communication() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'NUMERO: the history of communications is kept.' using errcode = 'P0001'; end if;
  if new.subject <> old.subject or new.body <> old.body or new.party_id is distinct from old.party_id or new.to_address is distinct from old.to_address
     or (old.status <> 'prepared' and new.status <> old.status) then
    raise exception 'NUMERO: a communication on record cannot be changed. Prepare a new one.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_communication before update or delete on public.communications for each row execute function numero_private.guard_communication();

-- ---------- register of integrations ----------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  company_id uuid references public.companies(id),
  key text not null,
  name text not null,
  kind text not null check (kind in ('bank','payment_gateway','crm','hr','payroll','pos','erp','ecommerce','logistics','ghl_platform','email','sms','whatsapp','speech','ocr','ai_model','tax_portal','other')),
  direction text not null default 'inbound' check (direction in ('inbound','outbound','both')),
  moves_money boolean not null default false,
  risk text not null default 'normal' check (risk in ('normal','high')),
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  status text not null default 'planned' check (status in ('planned','configured','testing','active','suspended','retired')),
  scopes text[] not null default '{}',
  auth_method text,
  secret_location text,               -- where the secret is kept (for example "Supabase secret SARVAM_API_KEY"). Never the secret itself.
  owner_name text,
  tested_in_sandbox_on date,
  last_checked_on date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not moves_money or risk = 'high')
);
create unique index integrations_key on public.integrations(group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create or replace function numero_private.save_integration(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; i public.integrations;
        v_money boolean := coalesce((p->>'moves_money')::boolean, false); v_status text := coalesce(p->>'status', 'planned'); v_env text := coalesce(p->>'environment', 'sandbox');
        v_text text := lower(coalesce(p->>'secret_location', '') || ' ' || coalesce(p->>'notes', '') || ' ' || coalesce(p->>'auth_method', ''));
begin
  if not (numero_private.is_group_admin(v_gid) or (v_company is not null and numero_private.can(v_company, 'integration.manage'))) then
    raise exception 'NUMERO: you are not authorised to maintain the register of integrations.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'key'), '') = '' or coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: an integration needs a key and a name.' using errcode = 'P0001'; end if;
  -- the register holds no secret
  if v_text ~ '(sk_live|sk_test|eyj[a-z0-9_-]{10,}|-----begin|password\s*[:=]|api[_-]?key\s*[:=]\s*\S{8,}|secret\s*[:=]\s*\S{8,})' then
    raise exception 'NUMERO: this looks like a key, a password or a token. The register records where a secret is kept, never the secret.' using errcode = 'P0001';
  end if;
  if v_id is not null then
    select * into i from public.integrations where id = v_id and group_id = v_gid for update;
    if not found then raise exception 'NUMERO: integration not found.' using errcode = 'P0001'; end if;
  end if;
  -- real money safety (spec 1543): an integration that can move money reaches production only after a recorded test in a sandbox
  if v_money and v_env = 'production' and v_status in ('testing','active')
     and coalesce((p->>'tested_in_sandbox_on')::date, i.tested_in_sandbox_on) is null then
    raise exception 'NUMERO: an integration that can move money is HIGH RISK. Record its test in a sandbox before it is used in production.' using errcode = 'P0001';
  end if;
  if v_money and v_status = 'active' and not numero_private.is_group_admin(v_gid) then
    raise exception 'NUMERO: only a Group Super Admin makes active an integration that can move money.' using errcode = '42501';
  end if;
  if v_id is null then
    insert into public.integrations(group_id, company_id, key, name, kind, direction, moves_money, risk, environment, status, scopes, auth_method, secret_location,
      owner_name, tested_in_sandbox_on, last_checked_on, notes)
    values (v_gid, v_company, lower(trim(p->>'key')), trim(p->>'name'), coalesce(p->>'kind', 'other'), coalesce(p->>'direction', 'inbound'), v_money,
      case when v_money then 'high' else coalesce(p->>'risk', 'normal') end, v_env, v_status,
      coalesce((select array_agg(e.value) from jsonb_array_elements_text(coalesce(p->'scopes', '[]'::jsonb)) e), '{}'),
      p->>'auth_method', p->>'secret_location', p->>'owner_name', (p->>'tested_in_sandbox_on')::date, (p->>'last_checked_on')::date, p->>'notes')
    returning id into v_id;
  else
    perform set_config('numero.reason', coalesce(p->>'reason', ''), true);
    update public.integrations set name = trim(p->>'name'), kind = coalesce(p->>'kind', kind), direction = coalesce(p->>'direction', direction),
      moves_money = v_money, risk = case when v_money then 'high' else coalesce(p->>'risk', risk) end, environment = v_env, status = v_status,
      scopes = coalesce((select array_agg(e.value) from jsonb_array_elements_text(coalesce(p->'scopes', '[]'::jsonb)) e), '{}'),
      auth_method = p->>'auth_method', secret_location = p->>'secret_location', owner_name = p->>'owner_name',
      tested_in_sandbox_on = coalesce((p->>'tested_in_sandbox_on')::date, tested_in_sandbox_on), last_checked_on = (p->>'last_checked_on')::date,
      notes = p->>'notes', updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------- feature flags (spec 1428) ----------
create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  module text not null,
  company_id uuid references public.companies(id),
  role_key text,
  enabled boolean not null,
  note text,
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now()
);
create unique index feature_flags_key on public.feature_flags(group_id, module, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(role_key, ''));

create or replace function numero_private.set_feature_flag(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group();
begin
  if not numero_private.is_group_admin(v_gid) then
    raise exception 'NUMERO: only a Group Super Admin switches capabilities on or off.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'module'), '') = '' then raise exception 'NUMERO: name the capability.' using errcode = 'P0001'; end if;
  if p->>'company_id' is not null and not exists (select 1 from public.companies c where c.id = (p->>'company_id')::uuid and c.group_id = v_gid) then
    raise exception 'NUMERO: company not found.' using errcode = 'P0001';
  end if;
  if p->>'role_key' is not null and not exists (select 1 from public.roles r where r.group_id = v_gid and r.key = p->>'role_key') then
    raise exception 'NUMERO: role not found.' using errcode = 'P0001';
  end if;
  if (p->>'enabled') is null then
    delete from public.feature_flags where group_id = v_gid and module = p->>'module'
       and company_id is not distinct from (p->>'company_id')::uuid and role_key is not distinct from (p->>'role_key');
    return;
  end if;
  perform set_config('numero.reason', coalesce(p->>'note', ''), true);
  insert into public.feature_flags(group_id, module, company_id, role_key, enabled, note)
  values (v_gid, trim(p->>'module'), (p->>'company_id')::uuid, p->>'role_key', (p->>'enabled')::boolean, p->>'note')
  on conflict (group_id, module, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(role_key, ''))
  do update set enabled = excluded.enabled, note = excluded.note, set_by = (select auth.uid()), set_at = now();
end $$;

-- ---------- backups: recorded by a person (spec 592, 1432) ----------
create table public.backup_checks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  kind text not null check (kind in ('backup','restore_test')),
  performed_on date not null,
  outcome text not null check (outcome in ('succeeded','failed','partial')),
  covers text not null default 'database' check (covers in ('database','files','database_and_files')),
  evidence text not null,
  recovery_point text,
  recovery_minutes int check (recovery_minutes is null or recovery_minutes >= 0),
  performed_by_name text not null,
  note text,
  recorded_by uuid default auth.uid(),
  recorded_at timestamptz not null default now()
);
create index backup_checks_group_idx on public.backup_checks(group_id, kind, performed_on desc);

create or replace function numero_private.record_backup_check(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_id uuid;
begin
  if not (numero_private.is_group_admin(v_gid)
          or exists (select 1 from public.companies c where c.group_id = v_gid and numero_private.can(c.id, 'system.health'))) then
    raise exception 'NUMERO: you are not authorised to record backups.' using errcode = '42501';
  end if;
  if p->>'kind' is null or p->>'kind' not in ('backup','restore_test') then raise exception 'NUMERO: record a backup or a restore test.' using errcode = 'P0001'; end if;
  if p->>'outcome' is null or p->>'outcome' not in ('succeeded','failed','partial') then raise exception 'NUMERO: record the outcome.' using errcode = 'P0001'; end if;
  if (p->>'performed_on') is null or (p->>'performed_on')::date > current_date then raise exception 'NUMERO: the date is required and cannot be in the future.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'evidence'), '') = '' or coalesce(trim(p->>'performed_by_name'), '') = '' then
    raise exception 'NUMERO: record who did it and what shows that it was done.' using errcode = 'P0001';
  end if;
  insert into public.backup_checks(group_id, kind, performed_on, outcome, covers, evidence, recovery_point, recovery_minutes, performed_by_name, note)
  values (v_gid, p->>'kind', (p->>'performed_on')::date, p->>'outcome', coalesce(p->>'covers', 'database'), trim(p->>'evidence'), p->>'recovery_point',
          (p->>'recovery_minutes')::int, trim(p->>'performed_by_name'), p->>'note')
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.guard_backup_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'NUMERO: a record of a backup or a restore test is not changed or removed. Record a new one.' using errcode = 'P0001';
end $$;
create trigger guard_backup_check before update or delete on public.backup_checks for each row execute function numero_private.guard_backup_check();

-- ---------- audit ----------
create trigger audit_attention_rules after insert or update or delete on public.attention_rules for each row execute function numero_private.audit_row();
create trigger audit_message_templates after insert or update or delete on public.message_templates for each row execute function numero_private.audit_row();
create trigger audit_communications after insert or update on public.communications for each row execute function numero_private.audit_row();
create trigger audit_integrations after insert or update or delete on public.integrations for each row execute function numero_private.audit_row();
create trigger audit_feature_flags after insert or update or delete on public.feature_flags for each row execute function numero_private.audit_row();
create trigger audit_backup_checks after insert on public.backup_checks for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.attention_rules enable row level security;
alter table public.message_templates enable row level security;
alter table public.communications enable row level security;
alter table public.integrations enable row level security;
alter table public.feature_flags enable row level security;
alter table public.backup_checks enable row level security;

create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notification_prefs_select on public.notification_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy attention_rules_select on public.attention_rules for select to authenticated using (group_id = (select numero_private.my_group()));
create policy message_templates_select on public.message_templates for select to authenticated using (group_id = (select numero_private.my_group()));
create policy communications_select on public.communications for select to authenticated
  using ((select numero_private.can(company_id, 'communication.send')) or (select numero_private.can(company_id, 'party.view')));
create policy integrations_select on public.integrations for select to authenticated
  using (group_id = (select numero_private.my_group())
         and ((select numero_private.is_group_admin(group_id))
              or exists (select 1 from public.companies c where c.group_id = integrations.group_id
                          and (c.id = integrations.company_id or integrations.company_id is null)
                          and ((select numero_private.can(c.id, 'integration.manage')) or (select numero_private.can(c.id, 'system.health'))))));
create policy feature_flags_select on public.feature_flags for select to authenticated using (group_id = (select numero_private.my_group()));
create policy backup_checks_select on public.backup_checks for select to authenticated
  using (group_id = (select numero_private.my_group())
         and ((select numero_private.is_group_admin(group_id))
              or exists (select 1 from public.companies c where c.group_id = backup_checks.group_id and (select numero_private.can(c.id, 'system.health')))));

create or replace function public.refresh_notifications() returns int language sql set search_path = '' as $$ select numero_private.refresh_notifications(); $$;
create or replace function public.mark_notifications(p_ids uuid[], p_read boolean default true) returns int language sql set search_path = '' as $$ select numero_private.mark_notifications(p_ids, p_read); $$;
create or replace function public.set_notification_pref(p_kind text, p_channel text, p_enabled boolean) returns void language sql set search_path = '' as $$ select numero_private.set_notification_pref(p_kind, p_channel, p_enabled); $$;
create or replace function public.save_attention_rule(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_attention_rule(p); $$;
create or replace function public.save_message_template(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_message_template(p); $$;
create or replace function public.prepare_communication(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.prepare_communication(p); $$;
create or replace function public.mark_communication(p_id uuid, p_status text, p_sent_on date default null, p_note text default null) returns void language sql set search_path = '' as $$ select numero_private.mark_communication(p_id, p_status, p_sent_on, p_note); $$;
create or replace function public.save_integration(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_integration(p); $$;
create or replace function public.set_feature_flag(p jsonb) returns void language sql set search_path = '' as $$ select numero_private.set_feature_flag(p); $$;
create or replace function public.record_backup_check(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.record_backup_check(p); $$;

insert into numero_private.internal_functions(name) values
  ('attention_class'), ('notify_holders'), ('notify_user'), ('on_approval_request'), ('on_alert'), ('on_task_assigned'), ('on_case_assigned'),
  ('guard_communication'), ('guard_backup_check')
on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927131813 · p3_13_notification_fix
-- The group administrators are named by profiles.is_group_super_admin.
-- A notification is a convenience: failing to write one must never stop an approval, a follow-up or a case.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'notify_holders';
  v_new := replace(v_def, 'pr.group_id = v_group and pr.is_group_admin', 'pr.group_id = v_group and pr.is_group_super_admin');
  if v_new = v_def then raise exception 'NUMERO: notify_holders could not be corrected.'; end if;
  execute v_new;
end $$;

create or replace function numero_private.on_approval_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_perm text; v_group uuid;
begin
  if new.status <> 'pending' then return new; end if;
  v_perm := case new.entity when 'journal' then 'journal.approve' when 'advance' then 'expense.approve' when 'expense_claim' then 'expense.approve'
              when 'requisition' then 'purchase.approve' when 'purchase_order' then 'purchase.approve'
              when 'capital_call' then 'investment.approve' when 'distribution' then 'investment.approve' else 'journal.approve' end;
  select group_id into v_group from public.companies where id = new.company_id;
  perform numero_private.notify_holders(new.company_id, v_perm, new.requested_by, 'approval_waiting',
    numero_private.attention_class(v_group, 'approval:' || new.entity, new.amount, 'finance_action'),
    'Approval waiting — ' || replace(new.entity, '_', ' '), coalesce(new.summary, '') || ' · ' || new.amount,
    new.entity, new.entity_id, 'approval:' || new.id::text, true);
  return new;
exception when others then
  return new;
end $$;

create or replace function numero_private.on_task_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_user is not null and (tg_op = 'INSERT' or new.owner_user is distinct from old.owner_user) and new.status in ('open','in_progress') then
    perform numero_private.notify_user(new.company_id, new.owner_user, 'follow_up_assigned', 'finance_action',
      'Follow-up for you — ' || new.title, coalesce('Due ' || new.due_date::text, 'No due date'), 'tasks', new.id, 'task:' || new.id::text || ':' || new.owner_user::text);
  end if;
  return new;
exception when others then
  return new;
end $$;

create or replace function numero_private.on_case_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_user is not null and (tg_op = 'INSERT' or new.owner_user is distinct from old.owner_user) and new.status <> 'closed' then
    perform numero_private.notify_user(new.company_id, new.owner_user, 'case_assigned', new.attention,
      'Case for you — ' || new.case_no, new.title, 'cases', new.id, 'case:' || new.id::text || ':' || new.owner_user::text);
  end if;
  return new;
exception when others then
  return new;
end $$;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927132021 · p3_14_imports_facts_health
-- =====================================================================
-- PLATFORM — imports with validation, parallel run, analytical store,
-- system health.   Spec: 635, 1275, 1280, 1370, 1429-1434, 1535
-- =====================================================================

-- ---------- imports: preview → validate → duplicate check → balance check → mapping check → commit ----------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null check (kind in ('journals','opening_balances','legacy_trial_balance')),
  file_name text not null,
  sha256 text not null,
  period_end date,
  status text not null default 'staged' check (status in ('staged','committed','discarded')),
  row_count int not null default 0,
  rows jsonb not null default '[]'::jsonb,
  mapping jsonb not null default '{}'::jsonb,
  checks jsonb not null default '{}'::jsonb,
  ok boolean not null default false,
  committed jsonb not null default '{}'::jsonb,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  committed_by uuid,
  committed_at timestamptz
);
create index import_batches_company_idx on public.import_batches(company_id, created_at desc);

-- the books of the system that NUMERO is replacing, kept beside NUMERO's own for comparison
create table public.legacy_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  batch_id uuid not null references public.import_batches(id),
  period_end date not null,
  legacy_code text not null,
  legacy_name text,
  account_id uuid references public.accounts(id),
  debit numeric(20,4) not null default 0,
  credit numeric(20,4) not null default 0
);
create index legacy_balances_company_idx on public.legacy_balances(company_id, period_end);

create or replace function numero_private.stage_import(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_kind text := p->>'kind'; v_id uuid; r jsonb; v_no int := 0; v_out jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb; v_unmapped text[] := '{}'; v_code text; v_acc public.accounts; v_d numeric; v_c numeric; v_date date;
  v_td numeric := 0; v_tc numeric := 0; v_dup_file int := 0; v_dup_books int := 0; v_seen boolean; v_unbal jsonb := '[]'::jsonb; v_keys text[] := '{}'; v_key text;
  v_map jsonb := coalesce(p->'mapping', '{}'::jsonb); v_err text; v_ok boolean; g record; v_period date := (p->>'period_end')::date;
begin
  if not numero_private.can(v_company, 'import.manage') then
    raise exception 'NUMERO: you are not authorised to import into this company.' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('journals','opening_balances','legacy_trial_balance') then
    raise exception 'NUMERO: state what is imported: journals, opening balances, or the trial balance of the earlier system.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p->>'file_name'), '') = '' or coalesce(trim(p->>'sha256'), '') = '' then
    raise exception 'NUMERO: the file name and the fingerprint of the file are required.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') = 0 then
    raise exception 'NUMERO: the file has no rows.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p->'rows') > 5000 then
    raise exception 'NUMERO: a file of more than 5,000 rows is imported in parts.' using errcode = 'P0001';
  end if;
  if v_kind <> 'journals' and v_period is null then raise exception 'NUMERO: state the date of the balances.' using errcode = 'P0001'; end if;
  v_seen := exists (select 1 from public.import_batches b where b.company_id = v_company and b.sha256 = p->>'sha256' and b.status = 'committed');

  for r in select * from jsonb_array_elements(p->'rows') loop
    v_no := v_no + 1; v_err := null; v_acc := null;
    v_code := trim(coalesce(r->>'account', ''));
    begin
      v_d := round(coalesce(nullif(trim(r->>'debit'), '')::numeric, 0), 2);
      v_c := round(coalesce(nullif(trim(r->>'credit'), '')::numeric, 0), 2);
    exception when others then v_err := 'the amounts are not numbers'; v_d := 0; v_c := 0;
    end;
    v_date := null;
    if v_kind = 'journals' then
      begin v_date := (r->>'date')::date; exception when others then v_err := coalesce(v_err || '; ', '') || 'the date cannot be read'; end;
      if v_date is null and v_err is null then v_err := 'the date is missing'; end if;
      if coalesce(trim(r->>'ref'), '') = '' then v_err := coalesce(v_err || '; ', '') || 'the voucher reference is missing'; end if;
    end if;
    if v_code = '' then v_err := coalesce(v_err || '; ', '') || 'the account is missing';
    else
      select * into v_acc from public.accounts a where a.company_id = v_company and a.code = coalesce(nullif(trim(v_map->>v_code), ''), v_code);
      if not found then
        if not v_code = any(v_unmapped) then v_unmapped := v_unmapped || v_code; end if;
        if v_kind <> 'legacy_trial_balance' then v_err := coalesce(v_err || '; ', '') || 'account ' || v_code || ' is not in the chart and is not mapped'; end if;
      elsif v_kind <> 'legacy_trial_balance' and (v_acc.is_group or not v_acc.is_active) then
        v_err := coalesce(v_err || '; ', '') || 'account ' || v_acc.code || ' cannot receive postings';
      end if;
    end if;
    if v_d < 0 or v_c < 0 then v_err := coalesce(v_err || '; ', '') || 'an amount is negative'; end if;
    if v_kind = 'legacy_trial_balance' then
      if v_d <> 0 and v_c <> 0 then v_err := coalesce(v_err || '; ', '') || 'a balance is a debit or a credit, not both'; end if;
    elsif (v_d = 0) = (v_c = 0) then
      v_err := coalesce(v_err || '; ', '') || 'a line carries either a debit or a credit';
    end if;
    v_key := coalesce(r->>'ref', '') || '|' || coalesce(v_date::text, '') || '|' || v_code || '|' || v_d || '|' || v_c || '|' || coalesce(r->>'narration', '');
    if v_key = any(v_keys) then v_dup_file := v_dup_file + 1; else v_keys := v_keys || v_key; end if;
    if v_err is not null and jsonb_array_length(v_errors) < 200 then
      v_errors := v_errors || jsonb_build_object('row', v_no, 'message', v_err);
    end if;
    v_td := v_td + v_d; v_tc := v_tc + v_c;
    v_out := v_out || jsonb_build_object('row', v_no, 'date', v_date, 'ref', nullif(trim(coalesce(r->>'ref', '')), ''), 'account', v_code, 'name', r->>'name',
      'account_id', v_acc.id, 'debit', v_d, 'credit', v_c, 'narration', r->>'narration', 'error', v_err);
  end loop;

  if v_kind = 'journals' then
    for g in select x->>'ref' as ref, sum((x->>'debit')::numeric) as d, sum((x->>'credit')::numeric) as c, min((x->>'date')::date) as dt, count(distinct x->>'date') as dates
               from jsonb_array_elements(v_out) x where x->>'ref' is not null group by x->>'ref' loop
      if g.d <> g.c then v_unbal := v_unbal || jsonb_build_object('ref', g.ref, 'debit', g.d, 'credit', g.c); end if;
      if g.dates > 1 then v_errors := v_errors || jsonb_build_object('row', null, 'message', 'voucher ' || g.ref || ' carries more than one date'); end if;
      -- already in the books? same date, same total and the same reference in the narration
      if exists (select 1 from public.journals j where j.company_id = v_company and j.journal_date = g.dt and j.total = g.d
                   and j.status not in ('cancelled','rejected') and (j.narration ilike '%' || g.ref || '%' or j.idempotency_key like 'import:%:' || g.ref)) then
        v_dup_books := v_dup_books + 1;
      end if;
    end loop;
  elsif v_td <> v_tc then
    v_unbal := v_unbal || jsonb_build_object('ref', 'whole file', 'debit', v_td, 'credit', v_tc);
  end if;

  v_ok := jsonb_array_length(v_errors) = 0 and jsonb_array_length(v_unbal) = 0 and not v_seen
          and (v_kind = 'legacy_trial_balance' or coalesce(array_length(v_unmapped, 1), 0) = 0);
  insert into public.import_batches(company_id, kind, file_name, sha256, period_end, row_count, rows, mapping, ok, note, checks)
  values (v_company, v_kind, trim(p->>'file_name'), p->>'sha256', v_period, v_no, v_out, v_map, v_ok, p->>'note',
    jsonb_build_object(
      'rows', v_no, 'total_debit', v_td, 'total_credit', v_tc,
      'validation', jsonb_build_object('passed', jsonb_array_length(v_errors) = 0, 'errors', v_errors),
      'duplicates', jsonb_build_object('passed', not v_seen, 'file_already_committed', v_seen, 'repeated_rows_in_file', v_dup_file, 'vouchers_that_look_already_recorded', v_dup_books,
        'note', 'Rows repeated in the file and vouchers that look already recorded are shown for a person to judge. They do not stop the import; a file already committed does.'),
      'balance', jsonb_build_object('passed', jsonb_array_length(v_unbal) = 0, 'unbalanced', v_unbal),
      'mapping', jsonb_build_object('passed', coalesce(array_length(v_unmapped, 1), 0) = 0, 'unmapped', to_jsonb(v_unmapped))))
  returning id into v_id;
  return v_id;
end $$;

-- Commit puts journals and opening balances into the books as DRAFTS. They are then submitted and approved like any entry.
create or replace function numero_private.commit_import(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.import_batches; g record; v_j uuid; v_ids uuid[] := '{}'; v_lines jsonb; v_n int := 0;
begin
  select * into b from public.import_batches where id = p_id for update;
  if not found then raise exception 'NUMERO: import not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(b.company_id, 'import.manage') then
    raise exception 'NUMERO: you are not authorised to import into this company.' using errcode = '42501';
  end if;
  if b.status <> 'staged' then raise exception 'NUMERO: this import is %.', b.status using errcode = 'P0001'; end if;
  if not b.ok then
    raise exception 'NUMERO: the file did not pass its checks. Correct the file or the mapping and bring it in again; nothing of it has entered the books.' using errcode = 'P0001';
  end if;
  if b.kind = 'journals' then
    for g in select x->>'ref' as ref, min((x->>'date')::date) as dt, min(x->>'narration') as narration,
                    jsonb_agg(jsonb_build_object('account_id', x->>'account_id', 'debit', (x->>'debit')::numeric, 'credit', (x->>'credit')::numeric, 'description', x->>'narration')
                              order by (x->>'row')::int) as lines
               from jsonb_array_elements(b.rows) x group by x->>'ref' order by min((x->>'row')::int) loop
      v_j := numero_private.save_journal_draft(jsonb_build_object('company_id', b.company_id, 'journal_date', g.dt, 'voucher_type', 'journal',
        'narration', coalesce(g.narration, 'Imported') || ' · ' || g.ref, 'source', 'import', 'source_id', b.id, 'origin', 'import',
        'idempotency_key', 'import:' || b.id::text || ':' || g.ref, 'lines', g.lines));
      v_ids := v_ids || v_j; v_n := v_n + 1;
    end loop;
  elsif b.kind = 'opening_balances' then
    select jsonb_agg(jsonb_build_object('account_id', x->>'account_id', 'debit', (x->>'debit')::numeric, 'credit', (x->>'credit')::numeric,
             'description', 'Opening balance — ' || coalesce(x->>'name', x->>'account')) order by (x->>'row')::int)
      into v_lines from jsonb_array_elements(b.rows) x;
    v_j := numero_private.save_journal_draft(jsonb_build_object('company_id', b.company_id, 'journal_date', b.period_end, 'voucher_type', 'opening',
      'narration', 'Opening balances as at ' || b.period_end || ' · ' || b.file_name, 'source', 'import', 'source_id', b.id, 'origin', 'import',
      'idempotency_key', 'import:' || b.id::text || ':opening', 'lines', v_lines));
    v_ids := v_ids || v_j; v_n := 1;
  else
    insert into public.legacy_balances(company_id, batch_id, period_end, legacy_code, legacy_name, account_id, debit, credit)
    select b.company_id, b.id, b.period_end, x->>'account', x->>'name', (x->>'account_id')::uuid, (x->>'debit')::numeric, (x->>'credit')::numeric
      from jsonb_array_elements(b.rows) x;
    get diagnostics v_n = row_count;
  end if;
  update public.import_batches set status = 'committed', committed_by = (select auth.uid()), committed_at = now(),
         committed = jsonb_build_object('records', v_n, 'journal_ids', to_jsonb(v_ids),
           'rule', case when b.kind = 'legacy_trial_balance' then 'Kept beside the books for comparison. Nothing was posted.'
                        else 'Entered as drafts. Each is submitted and approved like any other entry before it is posted.' end)
   where id = b.id;
  return jsonb_build_object('records', v_n, 'journal_ids', to_jsonb(v_ids));
end $$;

create or replace function numero_private.discard_import(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.import_batches;
begin
  select * into b from public.import_batches where id = p_id for update;
  if not found then raise exception 'NUMERO: import not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(b.company_id, 'import.manage') then
    raise exception 'NUMERO: you are not authorised to import into this company.' using errcode = '42501';
  end if;
  if b.status <> 'staged' then raise exception 'NUMERO: this import is %. What has been committed is corrected in the books, not discarded.', b.status using errcode = 'P0001'; end if;
  update public.import_batches set status = 'discarded', note = coalesce(nullif(trim(p_reason), ''), note) where id = p_id;
end $$;

-- ---------- analytical store (spec 1275): monthly totals, so that analysis over years does not read every line ----------
create table public.fact_ledger_monthly (
  company_id uuid not null references public.companies(id),
  month date not null,
  account_id uuid not null references public.accounts(id),
  org_unit_id uuid references public.org_units(id),
  debit numeric(20,4) not null default 0,
  credit numeric(20,4) not null default 0,
  entries int not null default 0
);
create unique index fact_ledger_monthly_key on public.fact_ledger_monthly(company_id, month, account_id, coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid));
create table public.fact_refresh (
  company_id uuid primary key references public.companies(id),
  refreshed_at timestamptz not null,
  refreshed_by uuid,
  last_posted_at timestamptz,
  rows int not null default 0,
  journals int not null default 0
);

-- Rebuilds the monthly totals of a company from its posted entries. The totals include every posted line,
-- whatever its confidentiality: a total is not a detail, and statements must stay truthful.
create or replace function numero_private.refresh_facts(p_company uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rows int; v_j int; v_last timestamptz;
begin
  if not (numero_private.can(p_company, 'report.view') or numero_private.can(p_company, 'system.health')) then
    raise exception 'NUMERO: you are not authorised to refresh the analytical store.' using errcode = '42501';
  end if;
  delete from public.fact_ledger_monthly where company_id = p_company;
  insert into public.fact_ledger_monthly(company_id, month, account_id, org_unit_id, debit, credit, entries)
  select l.company_id, date_trunc('month', j.journal_date)::date, l.account_id, null, sum(l.debit), sum(l.credit), count(*)
    from public.journal_lines l join public.journals j on j.id = l.journal_id
   where l.company_id = p_company and j.status in ('posted','reversed')
   group by l.company_id, date_trunc('month', j.journal_date), l.account_id
  union all
  select l.company_id, date_trunc('month', j.journal_date)::date, l.account_id, d.org_unit_id, sum(l.debit), sum(l.credit), count(*)
    from public.journal_lines l join public.journals j on j.id = l.journal_id join public.journal_line_dims d on d.line_id = l.id
   where l.company_id = p_company and j.status in ('posted','reversed')
   group by l.company_id, date_trunc('month', j.journal_date), l.account_id, d.org_unit_id;
  get diagnostics v_rows = row_count;
  select count(*), max(posted_at) into v_j, v_last from public.journals where company_id = p_company and status in ('posted','reversed');
  insert into public.fact_refresh(company_id, refreshed_at, refreshed_by, last_posted_at, rows, journals)
  values (p_company, now(), (select auth.uid()), v_last, v_rows, v_j)
  on conflict (company_id) do update set refreshed_at = excluded.refreshed_at, refreshed_by = excluded.refreshed_by,
     last_posted_at = excluded.last_posted_at, rows = excluded.rows, journals = excluded.journals;
  return jsonb_build_object('rows', v_rows, 'journals', v_j, 'last_posted_at', v_last);
end $$;

-- ---------- system health (spec 1280, 1429, 1430): NUMERO looking at itself ----------
create or replace function numero_private.system_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_gid uuid := numero_private.my_group(); v_ids uuid[]; v_admin boolean; o jsonb := '{}'::jsonb;
  v_n bigint; v_n2 bigint; v_d date; v_ts timestamptz; v_x numeric; r record; v_list jsonb;
begin
  if v_gid is null then raise exception 'NUMERO: authentication required.' using errcode = '42501'; end if;
  v_admin := numero_private.is_group_admin(v_gid);
  select array_agg(c.id) into v_ids from public.companies c where c.group_id = v_gid and (v_admin or numero_private.can(c.id, 'system.health'));
  if v_ids is null then raise exception 'NUMERO: you are not authorised to see the health of the system.' using errcode = '42501'; end if;

  -- posting engine
  select count(*) into v_n from public.journals j where j.company_id = any(v_ids) and j.status in ('posted','reversed')
     and (select coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) from public.journal_lines l where l.journal_id = j.id) <> 0;
  select count(*), min(w.created_at) into v_n2, v_ts from public.workflow_postings w where w.company_id = any(v_ids) and w.status = 'pending';
  o := o || jsonb_build_object('posting_engine', jsonb_build_object(
    'state', case when v_n > 0 then 'failure' when v_n2 > 0 and v_ts < now() - interval '7 days' then 'attention' else 'ok' end,
    'posted_entries_that_do_not_balance', v_n, 'proposed_entries_awaiting_approval', v_n2, 'oldest_awaiting_since', v_ts,
    'explanation', case when v_n > 0 then 'A posted entry does not balance. This must never happen: stop and investigate.'
                        when v_n2 > 0 and v_ts < now() - interval '7 days' then 'Entries proposed by operations have waited more than seven days for approval. Until they are approved the books do not show them.'
                        else 'Every posted entry balances.' end));

  -- volumes (spec 1434)
  select count(*) into v_n from public.journals where company_id = any(v_ids);
  select count(*) into v_n2 from public.journal_lines where company_id = any(v_ids);
  o := o || jsonb_build_object('database', jsonb_build_object('state', 'ok', 'companies', coalesce(array_length(v_ids, 1), 0), 'entries', v_n, 'entry_lines', v_n2,
    'checked_at', now(), 'explanation', 'The database answered. Volumes are counted, not estimated.'));

  -- stock ledger against general ledger
  select coalesce(jsonb_agg(jsonb_build_object('company_id', q.company_id, 'ledger', q.name, 'stock_ledger', q.stock, 'general_ledger', q.gl, 'difference', q.stock - q.gl)), '[]'::jsonb)
    into v_list
    from (select c.company_id, a.name, sum(i.value_on_hand) as stock,
                 (select coalesce(sum(l.debit - l.credit), 0) from public.journal_lines l join public.journals j on j.id = l.journal_id
                   where l.account_id = c.inventory_account_id and j.status in ('posted','reversed')) as gl
            from public.inv_categories c join public.inv_items i on i.category_id = c.id join public.accounts a on a.id = c.inventory_account_id
           where c.company_id = any(v_ids) group by c.company_id, c.inventory_account_id, a.name) q
   where q.stock <> q.gl;
  o := o || jsonb_build_object('stock_and_ledger', jsonb_build_object('state', case when jsonb_array_length(v_list) > 0 then 'attention' else 'ok' end, 'differences', v_list,
    'explanation', case when jsonb_array_length(v_list) > 0 then 'The value of stock differs from its ledger. A manual entry in a stock ledger, or a bill coded straight to stock, causes this.'
                        else 'Where stock is kept, its value agrees with its ledger.' end));

  -- bank statements and reconciliation (spec 1280: stale feeds, reconciliation failures)
  select coalesce(jsonb_agg(jsonb_build_object('company_id', b.company_id, 'bank_account', b.name, 'last_statement_line', x.last_line, 'unmatched', x.unmatched,
           'stale', x.last_line is null or x.last_line < current_date - 35)), '[]'::jsonb),
         count(*) filter (where x.last_line is null or x.last_line < current_date - 35), coalesce(sum(x.unmatched), 0)
    into v_list, v_n, v_n2
    from public.bank_accounts b left join lateral (
      select max(t.txn_date) as last_line, count(*) filter (where t.status in ('unmatched','suggested','needs_review')) as unmatched
        from public.bank_transactions t where t.bank_account_id = b.id) x on true
   where b.company_id = any(v_ids) and b.is_active;
  o := o || jsonb_build_object('bank_statements', jsonb_build_object(
    'state', case when jsonb_array_length(v_list) = 0 then 'not_recorded' when v_n > 0 or v_n2 > 0 then 'attention' else 'ok' end,
    'accounts', v_list, 'accounts_without_a_recent_statement', v_n, 'statement_lines_unmatched', v_n2,
    'explanation', 'No bank feed is connected. Statements are imported by a person; an account with no statement line in 35 days is shown as stale.'));

  -- alerts, cases
  select count(*) filter (where status in ('open','reviewing')), count(*) filter (where status in ('open','reviewing') and attention = 'critical')
    into v_n, v_n2 from public.alerts where company_id = any(v_ids);
  o := o || jsonb_build_object('alerts', jsonb_build_object('state', case when v_n2 > 0 then 'attention' else 'ok' end, 'open', v_n, 'critical', v_n2,
    'open_cases', (select count(*) from public.cases where company_id = any(v_ids) and status <> 'closed')));

  -- storage
  select count(*), coalesce(sum(size_bytes), 0) into v_n, v_x from public.documents where company_id = any(v_ids);
  o := o || jsonb_build_object('storage', jsonb_build_object('state', 'ok', 'documents', v_n, 'bytes', v_x,
    'explanation', 'Counted from the register of documents. NUMERO does not measure the storage bucket itself.'));

  -- audit trail
  select max(at), count(*) into v_ts, v_n from public.audit_log where group_id = v_gid;
  o := o || jsonb_build_object('audit_trail', jsonb_build_object('state', 'ok', 'entries', v_n, 'last_entry', v_ts, 'explanation', 'The audit trail can only be added to.'));

  -- backups: recorded by a person
  select max(performed_on) filter (where kind = 'backup' and outcome = 'succeeded'), max(performed_on) filter (where kind = 'restore_test' and outcome = 'succeeded')
    into v_d, v_ts from (select kind, outcome, performed_on from public.backup_checks where group_id = v_gid) q;
  o := o || jsonb_build_object('backups', jsonb_build_object(
    'state', case when v_d is null then 'not_recorded' when v_d < current_date - 7 or v_ts is null or v_ts::date < current_date - 120 then 'attention' else 'ok' end,
    'last_backup_recorded', v_d, 'last_restore_test_recorded', v_ts::date,
    'last_failure', (select jsonb_build_object('kind', kind, 'on', performed_on) from public.backup_checks where group_id = v_gid and outcome <> 'succeeded' order by performed_on desc limit 1),
    'recovery_readiness', case when v_d is null then 'unknown — no backup is on record'
                               when v_ts is null then 'unproven — a backup is on record, but no restore has been tested'
                               when v_ts::date < current_date - 120 then 'stale — the last restore test is more than 120 days old' else 'tested' end,
    'explanation', 'NUMERO cannot see the backups of its own database. These are the records a person has entered. A backup that has never been restored is not yet a backup.'));

  -- analytical store
  select count(*) filter (where f.company_id is null), count(*) filter (where f.company_id is not null and coalesce(f.last_posted_at, 'epoch') < coalesce(m.last, 'epoch'))
    into v_n, v_n2
    from unnest(v_ids) c(id)
    left join public.fact_refresh f on f.company_id = c.id
    left join lateral (select max(posted_at) as last from public.journals j where j.company_id = c.id and j.status in ('posted','reversed')) m on true;
  o := o || jsonb_build_object('analytical_store', jsonb_build_object('state', case when v_n + v_n2 > 0 then 'attention' else 'ok' end,
    'companies_never_refreshed', v_n, 'companies_with_entries_posted_since', v_n2,
    'explanation', 'Monthly totals are rebuilt when a person asks. Nothing refreshes them on a schedule.'));

  -- what is not connected
  select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'kind', i.kind, 'status', i.status, 'environment', i.environment, 'moves_money', i.moves_money, 'last_checked_on', i.last_checked_on)), '[]'::jsonb)
    into v_list from public.integrations i where i.group_id = v_gid and i.status <> 'retired';
  o := o || jsonb_build_object('integrations', jsonb_build_object(
    'state', case when exists (select 1 from public.integrations i where i.group_id = v_gid and i.status = 'active') then 'ok' else 'not_connected' end,
    'register', v_list, 'explanation', 'The register describes integrations. NUMERO itself calls no outside service.'));
  o := o || jsonb_build_object('notifications', jsonb_build_object('state', 'ok',
    'unread', (select count(*) from public.notifications where user_id = (select auth.uid()) and read_at is null),
    'channels', jsonb_build_object('in_app', 'working', 'email', 'not connected', 'sms', 'not connected', 'push', 'not connected', 'whatsapp', 'not connected')));
  o := o || jsonb_build_object('queues_and_jobs', jsonb_build_object('state', 'not_connected',
    'explanation', 'NUMERO runs nothing on a schedule and keeps no queue. Depreciation, payroll, Sentinel and the analytical store are each started by a person.'));
  return o;
end $$;

-- ---------- audit ----------
create trigger audit_import_batches after insert or update on public.import_batches for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.import_batches enable row level security;
alter table public.legacy_balances enable row level security;
alter table public.fact_ledger_monthly enable row level security;
alter table public.fact_refresh enable row level security;

create policy import_batches_select on public.import_batches for select to authenticated
  using ((select numero_private.can(company_id, 'import.manage')) or (select numero_private.can(company_id, 'audit.view')));
create policy legacy_balances_select on public.legacy_balances for select to authenticated
  using ((select numero_private.can(company_id, 'report.view')));
create policy fact_ledger_monthly_select on public.fact_ledger_monthly for select to authenticated
  using ((select numero_private.can(company_id, 'report.view')));
create policy fact_refresh_select on public.fact_refresh for select to authenticated
  using ((select numero_private.has_company_access(company_id)));

create or replace function public.stage_import(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.stage_import(p); $$;
create or replace function public.commit_import(p_id uuid) returns jsonb language sql set search_path = '' as $$ select numero_private.commit_import(p_id); $$;
create or replace function public.discard_import(p_id uuid, p_reason text default null) returns void language sql set search_path = '' as $$ select numero_private.discard_import(p_id, p_reason); $$;
create or replace function public.refresh_facts(p_company uuid) returns jsonb language sql set search_path = '' as $$ select numero_private.refresh_facts(p_company); $$;
create or replace function public.system_health() returns jsonb language sql stable set search_path = '' as $$ select numero_private.system_health(); $$;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927132121 · p3_15_travel_detail_generator
-- =====================================================================
-- Travel bookings on a claim line (spec 199-202) and generators (spec 304)
-- =====================================================================

-- What is known about a journey or a stay: operator, booking reference, origin, destination, class, and how the amount is made up.
alter table public.expense_claim_lines add column if not exists detail jsonb not null default '{}'::jsonb;

create or replace function numero_private.check_travel_detail(d jsonb, p_amount numeric, p_line int) returns jsonb
language plpgsql immutable security definer set search_path = '' as $$
declare k text; v numeric; v_sum numeric := 0; v_any boolean := false;
begin
  if d is null or jsonb_typeof(d) <> 'object' or d = '{}'::jsonb then return '{}'::jsonb; end if;
  if d->>'kind' is null or d->>'kind' not in ('air','train','bus','cab','hotel') then
    raise exception 'NUMERO: line % — the booking is by air, train, bus, cab or a hotel stay.', p_line using errcode = 'P0001';
  end if;
  foreach k in array array['base_fare','taxes','booking_charges','baggage','seat','cancellation_fee','change_fee','tip','toll','parking','room_charges','meals','laundry','other_charges'] loop
    if d ? k and nullif(trim(d->>k), '') is not null then
      begin v := round((d->>k)::numeric, 2); exception when others then
        raise exception 'NUMERO: line % — "%" is not an amount.', p_line, replace(k, '_', ' ') using errcode = 'P0001';
      end;
      if v < 0 then raise exception 'NUMERO: line % — "%" cannot be negative.', p_line, replace(k, '_', ' ') using errcode = 'P0001'; end if;
      v_sum := v_sum + v; v_any := true;
    end if;
  end loop;
  if v_any and v_sum <> round(p_amount, 2) then
    raise exception 'NUMERO: line % — the parts of the booking add up to %, and the line is %. They must agree.', p_line, v_sum, round(p_amount, 2) using errcode = 'P0001';
  end if;
  if d->>'kind' = 'hotel' and d->>'check_in' is not null and d->>'check_out' is not null and (d->>'check_out')::date < (d->>'check_in')::date then
    raise exception 'NUMERO: line % — the stay ends before it begins.', p_line using errcode = 'P0001';
  end if;
  return jsonb_strip_nulls(d);
end $$;

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'save_claim';
  if position('check_travel_detail' in v_def) = 0 then
    v_new := replace(v_def,
      'amount, approved_amount, paid_by, paid_from_ledger_id, has_receipt, document_id, flags, dims)',
      'amount, approved_amount, paid_by, paid_from_ledger_id, has_receipt, document_id, flags, dims, detail)');
    v_new := replace(v_new,
      'coalesce(l->''dims'', ''{}''::jsonb));',
      'coalesce(l->''dims'', ''{}''::jsonb), numero_private.check_travel_detail(l->''detail'', v_amt, v_no));');
    if v_new = v_def or position('check_travel_detail' in v_new) = 0 or position('flags, dims, detail)' in v_new) = 0 then
      raise exception 'NUMERO: save_claim could not be extended.';
    end if;
    execute v_new;
  end if;
end $$;

-- A generator, or any equipment whose running cost is to be followed, gets a tag of its own.
insert into public.org_unit_types(key, name, sort) values ('equipment', 'Equipment', 145)
on conflict (coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;

insert into public.register_kinds(key, name, category, direction, default_certainty, dimension_type, prefix, sort, fields) values
  ('generator', 'Generator / Backup Power', 'asset', 'none', 'scheduled', 'equipment', 'GEN', 520,
   '[{"key": "located_at", "label": "Office or site it serves", "type": "text", "required": true}, {"key": "make_model", "label": "Make and model", "type": "text"}, {"key": "capacity_kva", "label": "Capacity (kVA)", "type": "number"}, {"key": "fuel_type", "label": "Fuel", "type": "select", "options": ["Diesel", "Petrol", "Gas", "Battery / inverter", "Solar hybrid"]}, {"key": "ownership", "label": "Ownership", "type": "select", "options": ["Owned", "Hired", "Landlord''s"]}, {"key": "operating_hours", "label": "Operating hours (as last read)", "type": "number"}, {"key": "hours_read_on", "label": "Hours read on", "type": "date"}, {"key": "fuel_stock_litres", "label": "Fuel in the tank (litres, as last read)", "type": "number"}, {"key": "last_service", "label": "Last serviced", "type": "date"}, {"key": "next_service", "label": "Next service due", "type": "date", "alert": true}, {"key": "amc_expiry", "label": "Maintenance contract expires", "type": "date", "alert": true}]'::jsonb)
on conflict (coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do update set
  name = excluded.name, category = excluded.category, direction = excluded.direction,
  default_certainty = excluded.default_certainty, dimension_type = excluded.dimension_type,
  prefix = excluded.prefix, sort = excluded.sort, fields = excluded.fields;

insert into numero_private.internal_functions(name) values ('check_travel_detail') on conflict do nothing;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();
