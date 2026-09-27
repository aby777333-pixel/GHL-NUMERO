-- =====================================================================
-- GHL NUMERO · 0002 · PARTIES, DIMENSIONS, CHART OF ACCOUNTS, LEDGER ENGINE
-- Spec: 6, 7, 17, 42, 66, 67, 91, 95-97, 162, 369-377, 399, 1483, 1435-1436
-- Invariants enforced in the database:
--   * total debits = total credits for every posted journal
--   * posted journals and their lines are immutable (reversal only)
--   * journals are never deleted
--   * status transitions only through controlled workflow functions
--   * no posting into a locked period
-- =====================================================================

-- ---------- reference data ----------
create table public.currencies (
  code text primary key, name text not null, symbol text, decimals int not null default 2
);
insert into public.currencies(code, name, symbol, decimals) values
  ('INR','Indian Rupee','₹',2),('USD','US Dollar','$',2),('EUR','Euro','€',2),('GBP','Pound Sterling','£',2),
  ('AED','UAE Dirham','د.إ',2),('SGD','Singapore Dollar','S$',2),('JPY','Japanese Yen','¥',0),
  ('AUD','Australian Dollar','A$',2),('CAD','Canadian Dollar','C$',2),('CHF','Swiss Franc','CHF',2),
  ('SAR','Saudi Riyal','﷼',2),('CNY','Chinese Yuan','¥',2);

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  from_currency text not null references public.currencies(code),
  to_currency text not null references public.currencies(code),
  rate_date date not null,
  rate numeric(20,8) not null check (rate > 0),
  rate_type text not null default 'spot',
  source text not null default 'manual',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (group_id, from_currency, to_currency, rate_date, rate_type)
);

create table public.org_unit_types (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id),      -- null = system default
  key text not null, name text not null, sort int not null default 100
);
create unique index org_unit_types_key on public.org_unit_types(coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
insert into public.org_unit_types(key, name, sort) values
  ('business_unit','Business Unit',10),('branch','Branch',20),('office','Office',25),('department','Department',30),
  ('division','Division',40),('cost_centre','Cost Centre',50),('profit_centre','Profit Centre',60),('project','Project',70),
  ('property','Property / Site',80),('fund','Fund / Scheme',90),('portfolio','Portfolio',100),('warehouse','Warehouse',110),
  ('store','Store',120),('team','Team',130),('vehicle','Vehicle',140),('trip','Trip',150),('campaign','Campaign',160),
  ('contract','Contract',170),('event','Event',180),('path','Financial Path',190);

create table public.org_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  type_key text not null,
  parent_id uuid references public.org_units(id),
  code text not null,
  name text not null,
  head_user uuid references public.profiles(id),
  status text not null default 'active' check (status in ('active','inactive','closed')),
  confidentiality text not null default 'internal',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (company_id, type_key, code)
);
create index org_units_company_idx on public.org_units(company_id, type_key);

create table public.voucher_types (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id),
  key text not null, name text not null, prefix text not null
);
create unique index voucher_types_key on public.voucher_types(coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
insert into public.voucher_types(key, name, prefix) values
  ('journal','Journal Voucher','JV'),('payment','Payment Voucher','PV'),('receipt','Receipt Voucher','RV'),
  ('contra','Contra Voucher','CV'),('purchase','Purchase Voucher','PU'),('sales','Sales Voucher','SV'),
  ('debit_note','Debit Note','DN'),('credit_note','Credit Note','CN'),('expense','Expense Voucher','EV'),
  ('petty_cash','Petty Cash Voucher','PC'),('adjustment','Adjustment Journal','AJ'),('accrual','Accrual Journal','AC'),
  ('depreciation','Depreciation Journal','DP'),('reclassification','Reclassification Journal','RC'),
  ('intercompany','Intercompany Journal','IC'),('closing','Closing Journal','CL'),('reversal','Reversal Journal','RJ'),
  ('correction','Correction Journal','CJ'),('fx','Foreign Exchange Journal','FX'),('consolidation','Consolidation Journal','CO'),
  ('opening','Opening Balance','OB');

-- ---------- party universe ----------
create table public.party_types (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id),
  key text not null, name text not null, prefix text not null default 'PTY', category text not null default 'other'
);
create unique index party_types_key on public.party_types(coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
insert into public.party_types(key, name, prefix, category) values
  ('customer','Customer','CUS','customer'),('client','Client','CUS','customer'),('vendor','Vendor','VEN','vendor'),
  ('supplier','Supplier','VEN','vendor'),('employee','Employee','EMP','employee'),('director','Director','PER','other'),
  ('shareholder','Shareholder','PER','investor'),('investor','Investor','INV','investor'),('agent','Agent','AGT','agent'),
  ('broker','Broker','BRK','broker'),('sub_broker','Sub-Broker','BRK','broker'),('referral_partner','Referral Partner','AGT','agent'),
  ('channel_partner','Channel Partner','PTN','partner'),('consultant','Consultant','CON','consultant'),
  ('freelancer','Freelancer','FRL','freelancer'),('contractor','Contractor','CTR','contractor'),
  ('subcontractor','Subcontractor','CTR','contractor'),('landlord','Landlord','LND','other'),('tenant','Tenant','TNT','customer'),
  ('transporter','Transporter','LOG','vendor'),('bank','Bank','BNK','bank'),('lender','Lender','BNK','bank'),
  ('government','Government / Regulator','GOV','government'),('insurer','Insurance Company','INS','vendor'),
  ('group_company','Group Company','GRP','group'),('related_party','Related Party','REL','other'),('other','Other','PTY','other');

create table public.party_sequences (
  group_id uuid not null references public.groups(id),
  prefix text not null,
  last_no bigint not null default 0,
  primary key (group_id, prefix)
);

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  party_no text not null,
  kind text not null default 'organization' check (kind in ('person','organization')),
  display_name text not null,
  legal_name text,
  pan text, gstin text, email text, phone text,
  address jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','suspended','blocked','inactive','terminated')),
  status_reason text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (group_id, party_no)
);
create index parties_group_name_idx on public.parties(group_id, lower(display_name));

create table public.party_roles (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id),
  company_id uuid not null references public.companies(id),
  type_key text not null,
  status text not null default 'active',
  credit_limit numeric(20,4),
  credit_days int,
  payment_terms text,
  relationship_manager uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (party_id, company_id, type_key)
);
create index party_roles_company_idx on public.party_roles(company_id, type_key);

create table public.party_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id),
  company_id uuid not null references public.companies(id),
  bank_name text not null,
  account_no text not null,
  ifsc text,
  beneficiary_name text not null,
  status text not null default 'pending_verification' check (status in ('pending_verification','verified','superseded','rejected')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  verified_by uuid, verified_at timestamptz
);

-- ---------- alerts (Sentinel) ----------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null,
  attention text not null default 'review' check (attention in ('info','review','priority','critical')),
  title text not null,
  explanation text not null,
  evidence jsonb not null default '{}'::jsonb,
  entity text, entity_id uuid,
  dedupe_key text,
  status text not null default 'open' check (status in ('open','reviewing','false_positive','resolved')),
  created_at timestamptz not null default now(),
  reviewed_by uuid, reviewed_at timestamptz, review_note text,
  unique (company_id, dedupe_key)
);
create index alerts_company_idx on public.alerts(company_id, status, created_at desc);

-- ---------- chart of accounts ----------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  subtype text not null,
  parent_id uuid references public.accounts(id),
  is_group boolean not null default false,
  currency text references public.currencies(code),
  control_type text check (control_type in ('receivable','payable','bank','cash','tax','intercompany','suspense','advance_paid','advance_received','retained_earnings')),
  counterparty_company_id uuid references public.companies(id),
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (company_id, code)
);
create index accounts_company_idx on public.accounts(company_id, type);

create table public.company_account_map (
  company_id uuid not null references public.companies(id),
  key text not null,
  account_id uuid not null references public.accounts(id),
  primary key (company_id, key)
);

create table public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open','soft_closed','locked')),
  changed_by uuid, changed_at timestamptz, reason text,
  unique (company_id, period_start)
);

create table public.voucher_sequences (
  company_id uuid not null references public.companies(id),
  voucher_type text not null,
  fy int not null,
  last_no bigint not null default 0,
  primary key (company_id, voucher_type, fy)
);

-- ---------- journals ----------
create table public.journals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  voucher_type text not null default 'journal',
  voucher_no text,
  journal_date date not null,
  narration text,
  purpose text,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','posted','reversed','rejected','cancelled')),
  source text not null default 'manual',
  source_id uuid,
  origin text not null default 'human' check (origin in ('human','ai_suggested','system','import')),
  reversal_of uuid references public.journals(id),
  reversed_by uuid references public.journals(id),
  idempotency_key text,
  confidentiality text not null default 'internal'
    check (confidentiality in ('internal','confidential','highly_confidential','restricted','super_admin_only')),
  total numeric(20,4) not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_by uuid, submitted_at timestamptz,
  approved_by uuid, approved_at timestamptz,
  posted_by uuid, posted_at timestamptz,
  unique (company_id, idempotency_key),
  unique (company_id, voucher_no)
);
create index journals_company_date_idx on public.journals(company_id, journal_date);
create index journals_status_idx on public.journals(company_id, status);
create index journals_source_idx on public.journals(source, source_id);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.journals(id),
  company_id uuid not null references public.companies(id),
  line_no int not null,
  account_id uuid not null references public.accounts(id),
  party_id uuid references public.parties(id),
  description text,
  debit numeric(20,4) not null default 0 check (debit >= 0),
  credit numeric(20,4) not null default 0 check (credit >= 0),
  txn_currency text references public.currencies(code),
  txn_amount numeric(20,4),
  fx_rate numeric(20,8),
  constraint one_sided check ((debit = 0) <> (credit = 0)),
  unique (journal_id, line_no)
);
create index journal_lines_account_idx on public.journal_lines(company_id, account_id);
create index journal_lines_party_idx on public.journal_lines(party_id) where party_id is not null;
create index journal_lines_journal_idx on public.journal_lines(journal_id);

create table public.journal_line_dims (
  line_id uuid not null references public.journal_lines(id),
  type_key text not null,
  org_unit_id uuid not null references public.org_units(id),
  primary key (line_id, type_key)
);
create index journal_line_dims_unit_idx on public.journal_line_dims(org_unit_id);

-- ---------- approvals ----------
create table public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  company_id uuid references public.companies(id),
  entity text not null,
  name text not null,
  min_amount numeric(20,4) not null default 0,
  max_amount numeric(20,4),
  conditions jsonb not null default '{}'::jsonb,
  steps text[] not null,
  is_active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entity text not null,
  entity_id uuid not null,
  amount numeric(20,4) not null default 0,
  rule_id uuid references public.approval_rules(id),
  steps text[] not null,
  current_step int not null default 1,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  summary text,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
create index approval_requests_idx on public.approval_requests(company_id, status);
create index approval_requests_entity_idx on public.approval_requests(entity, entity_id);

create table public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.approval_requests(id),
  step int not null,
  actor uuid not null,
  action text not null check (action in ('approve','reject','override','request_info','comment')),
  comment text,
  at timestamptz not null default now()
);

-- ---------- Black Vault ----------
create table public.vault_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  max_level text not null check (max_level in ('confidential','highly_confidential','restricted')),
  scope text,
  read_only boolean not null default true,
  valid_from date, valid_to date,
  granted_by uuid default auth.uid(),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.vault_access_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  company_id uuid,
  entity text not null,
  entity_id uuid,
  action text not null,
  meta jsonb
);
create trigger vault_log_append_only before update or delete on public.vault_access_log
  for each row execute function numero_private.audit_is_append_only();

create or replace function numero_private.conf_rank(level text) returns int
language sql immutable set search_path = '' as $$
  select case level when 'internal' then 0 when 'confidential' then 1 when 'highly_confidential' then 2
                    when 'restricted' then 3 when 'super_admin_only' then 4 else 5 end;
$$;

create or replace function numero_private.can_view_level(cid uuid, level text) returns boolean
language sql stable security definer set search_path = '' as $$
  select level = 'internal'
      or exists (select 1 from public.companies c where c.id = cid and numero_private.is_group_admin(c.group_id))
      or (level <> 'super_admin_only' and exists (
            select 1 from public.vault_grants g
            where g.user_id = (select auth.uid()) and g.company_id = cid
              and numero_private.conf_rank(g.max_level) >= numero_private.conf_rank(level)
              and (g.valid_from is null or g.valid_from <= current_date)
              and (g.valid_to is null or g.valid_to >= current_date)));
$$;

-- ---------- integrity guards ----------
create or replace function numero_private.assert_balanced(jid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d numeric; c numeric; n int;
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into d, c, n
  from public.journal_lines where journal_id = jid;
  if n < 2 then raise exception 'NUMERO: a journal needs at least two lines.' using errcode = 'P0001'; end if;
  if d <> c then
    raise exception 'NUMERO: unbalanced journal. Debits % do not equal credits %. Posting refused.', d, c using errcode = 'P0001';
  end if;
  if d = 0 then raise exception 'NUMERO: journal total is zero.' using errcode = 'P0001'; end if;
end $$;

create or replace function numero_private.guard_journal() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'NUMERO: journals are never deleted. Cancel a draft or reverse a posted journal.' using errcode = 'P0001';
  end if;
  if old.status in ('posted','reversed') then
    if not (old.status = 'posted' and new.status = 'reversed' and new.reversed_by is not null
            and current_user not in ('authenticated','anon')
            and (to_jsonb(new) - 'status' - 'reversed_by') = (to_jsonb(old) - 'status' - 'reversed_by')) then
      raise exception 'NUMERO: posted accounting records are immutable. Use a reversal or adjustment journal.' using errcode = 'P0001';
    end if;
  end if;
  if new.status is distinct from old.status and current_user in ('authenticated','anon') then
    raise exception 'NUMERO: status changes happen only through controlled workflow functions.' using errcode = 'P0001';
  end if;
  if new.status = 'posted' and old.status <> 'posted' then
    perform numero_private.assert_balanced(new.id);
  end if;
  return new;
end $$;
create trigger journals_guard before update or delete on public.journals
  for each row execute function numero_private.guard_journal();

create or replace function numero_private.journal_status(jid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select status from public.journals where id = jid;
$$;

create or replace function numero_private.guard_journal_line() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  v_status := numero_private.journal_status(coalesce(new.journal_id, old.journal_id));
  if v_status is distinct from 'draft' then
    raise exception 'NUMERO: lines of a % journal cannot be changed. Use a reversal or adjustment journal.', coalesce(v_status, 'missing') using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger journal_lines_guard before insert or update or delete on public.journal_lines
  for each row execute function numero_private.guard_journal_line();

create or replace function numero_private.guard_journal_dim() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select numero_private.journal_status(l.journal_id) into v_status
  from public.journal_lines l where l.id = coalesce(new.line_id, old.line_id);
  if v_status is distinct from 'draft' then
    raise exception 'NUMERO: dimensions of a % journal cannot be changed directly.', coalesce(v_status, 'missing') using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger journal_dims_guard before insert or update or delete on public.journal_line_dims
  for each row execute function numero_private.guard_journal_dim();

-- ---------- periods ----------
create or replace function numero_private.ensure_period(p_company uuid, p_date date) returns public.fiscal_periods
language plpgsql security definer set search_path = '' as $$
declare r public.fiscal_periods;
begin
  select * into r from public.fiscal_periods
  where company_id = p_company and p_date between period_start and period_end limit 1;
  if not found then
    insert into public.fiscal_periods(company_id, period_start, period_end)
    values (p_company, date_trunc('month', p_date)::date, (date_trunc('month', p_date) + interval '1 month - 1 day')::date)
    on conflict (company_id, period_start) do update set period_end = excluded.period_end
    returning * into r;
  end if;
  return r;
end $$;

create or replace function numero_private.assert_period_open(p_company uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.fiscal_periods;
begin
  r := numero_private.ensure_period(p_company, p_date);
  if r.status = 'locked' then
    raise exception 'NUMERO: the accounting period % to % is locked. Posting refused.', r.period_start, r.period_end using errcode = 'P0001';
  end if;
  if r.status = 'soft_closed' and not numero_private.can(p_company, 'period.lock') then
    raise exception 'NUMERO: the period % to % is soft-closed. Only finance leadership can post into it.', r.period_start, r.period_end using errcode = 'P0001';
  end if;
end $$;

create or replace function numero_private.set_period_status(p_company uuid, p_date date, p_status text, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.fiscal_periods; v_old text;
begin
  if p_status not in ('open','soft_closed','locked') then raise exception 'NUMERO: invalid period status.'; end if;
  r := numero_private.ensure_period(p_company, p_date);
  v_old := r.status;
  if v_old = p_status then return r.id; end if;
  if v_old = 'locked' then
    if not numero_private.can(p_company, 'period.reopen') then
      raise exception 'NUMERO: you are not authorised to reopen a locked period.' using errcode = '42501';
    end if;
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'NUMERO: a reason is required to reopen a locked period.' using errcode = 'P0001';
    end if;
  elsif not numero_private.can(p_company, 'period.lock') then
    raise exception 'NUMERO: you are not authorised to close or lock periods.' using errcode = '42501';
  end if;
  update public.fiscal_periods
     set status = p_status, changed_by = (select auth.uid()), changed_at = now(), reason = p_reason
   where id = r.id;
  perform numero_private.log_event(p_company, 'fiscal_periods', r.id, 'period_' || p_status,
    jsonb_build_object('status', v_old), jsonb_build_object('status', p_status, 'period_start', r.period_start, 'period_end', r.period_end), p_reason);
  return r.id;
end $$;

create or replace function public.set_period_status(p_company uuid, p_date date, p_status text, p_reason text default null)
returns uuid language sql set search_path = '' as $$
  select numero_private.set_period_status(p_company, p_date, p_status, p_reason);
$$;

-- ---------- journal workflow ----------
create or replace function numero_private.fiscal_year(p_company uuid, p_date date) returns int
language sql stable security definer set search_path = '' as $$
  select case when extract(month from p_date)::int >= c.fy_start_month
              then extract(year from p_date)::int else extract(year from p_date)::int - 1 end
  from public.companies c where c.id = p_company;
$$;

create or replace function numero_private.write_journal_lines(p_journal uuid, p_company uuid, p_lines jsonb)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  l jsonb; v_no int := 0; v_line uuid; v_acc public.accounts; v_group uuid; v_total numeric := 0;
  v_debit numeric; v_credit numeric; d record;
begin
  select group_id into v_group from public.companies where id = p_company;
  delete from public.journal_line_dims where line_id in (select id from public.journal_lines where journal_id = p_journal);
  delete from public.journal_lines where journal_id = p_journal;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_no := v_no + 1;
    select * into v_acc from public.accounts where id = (l->>'account_id')::uuid;
    if not found or v_acc.company_id <> p_company then
      raise exception 'NUMERO: line % uses an account that does not belong to this company.', v_no using errcode = 'P0001';
    end if;
    if v_acc.is_group then
      raise exception 'NUMERO: line % — "%" is a group heading and cannot receive postings.', v_no, v_acc.name using errcode = 'P0001';
    end if;
    if not v_acc.is_active then
      raise exception 'NUMERO: line % — account "%" is inactive.', v_no, v_acc.name using errcode = 'P0001';
    end if;
    if l->>'party_id' is not null and not exists (
      select 1 from public.parties p where p.id = (l->>'party_id')::uuid and p.group_id = v_group) then
      raise exception 'NUMERO: line % references an unknown party.', v_no using errcode = 'P0001';
    end if;
    v_debit := round(coalesce((l->>'debit')::numeric, 0), 4);
    v_credit := round(coalesce((l->>'credit')::numeric, 0), 4);
    if v_debit < 0 or v_credit < 0 or (v_debit = 0) = (v_credit = 0) then
      raise exception 'NUMERO: line % must carry either a debit or a credit amount (not both, not neither).', v_no using errcode = 'P0001';
    end if;
    insert into public.journal_lines(journal_id, company_id, line_no, account_id, party_id, description,
                                     debit, credit, txn_currency, txn_amount, fx_rate)
    values (p_journal, p_company, v_no, v_acc.id, (l->>'party_id')::uuid, l->>'description',
            v_debit, v_credit, l->>'txn_currency', (l->>'txn_amount')::numeric, (l->>'fx_rate')::numeric)
    returning id into v_line;
    v_total := v_total + v_debit;
    for d in select key, value from jsonb_each_text(coalesce(l->'dims', '{}'::jsonb)) loop
      if d.value is not null and d.value <> '' then
        if not exists (select 1 from public.org_units u where u.id = d.value::uuid and u.company_id = p_company) then
          raise exception 'NUMERO: line % references a dimension outside this company.', v_no using errcode = 'P0001';
        end if;
        insert into public.journal_line_dims(line_id, type_key, org_unit_id) values (v_line, d.key, d.value::uuid);
      end if;
    end loop;
  end loop;
  return v_total;
end $$;

create or replace function numero_private.save_journal_draft(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := (p->>'company_id')::uuid;
  v_id uuid := (p->>'id')::uuid;
  j public.journals; v_total numeric; v_key text := nullif(p->>'idempotency_key', '');
begin
  if v_uid is null then raise exception 'NUMERO: authentication required.'; end if;
  if not numero_private.can(v_company, 'journal.create') then
    raise exception 'NUMERO: you are not authorised to create journals for this company.' using errcode = '42501';
  end if;
  if (p->>'journal_date') is null then raise exception 'NUMERO: journal date is required.' using errcode = 'P0001'; end if;
  if coalesce(p->>'confidentiality', 'internal') <> 'internal'
     and not numero_private.can_view_level(v_company, p->>'confidentiality') then
    raise exception 'NUMERO: you cannot create records at a confidentiality level you are not cleared for.' using errcode = '42501';
  end if;

  if v_id is null and v_key is not null then
    select * into j from public.journals where company_id = v_company and idempotency_key = v_key;
    if found then return j.id; end if;
  end if;

  if v_id is not null then
    select * into j from public.journals where id = v_id for update;
    if not found or j.company_id <> v_company then raise exception 'NUMERO: journal not found.' using errcode = 'P0001'; end if;
    if j.status not in ('draft','rejected') then
      raise exception 'NUMERO: only drafts can be edited. This journal is %.', j.status using errcode = 'P0001';
    end if;
    if j.created_by <> v_uid and not numero_private.can(v_company, 'journal.edit') then
      raise exception 'NUMERO: you are not authorised to edit this draft.' using errcode = '42501';
    end if;
    update public.journals set
      status = 'draft',
      voucher_type = coalesce(p->>'voucher_type', voucher_type),
      journal_date = (p->>'journal_date')::date,
      narration = p->>'narration',
      purpose = p->>'purpose',
      confidentiality = coalesce(p->>'confidentiality', confidentiality)
    where id = v_id;
  else
    insert into public.journals(company_id, voucher_type, journal_date, narration, purpose, source, source_id,
                                origin, idempotency_key, confidentiality, created_by)
    values (v_company, coalesce(p->>'voucher_type', 'journal'), (p->>'journal_date')::date, p->>'narration',
            p->>'purpose', coalesce(p->>'source', 'manual'), (p->>'source_id')::uuid,
            coalesce(p->>'origin', 'human'), v_key, coalesce(p->>'confidentiality', 'internal'), v_uid)
    returning id into v_id;
  end if;

  v_total := numero_private.write_journal_lines(v_id, v_company, p->'lines');
  update public.journals set total = v_total where id = v_id;
  perform numero_private.log_event(v_company, 'journals', v_id, 'draft_saved', null,
    jsonb_build_object('lines', p->'lines', 'total', v_total), null);
  return v_id;
end $$;

create or replace function numero_private.maker_checker_mode(p_company uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(g.settings #>> '{controls,maker_checker}', 'enforced')
  from public.companies c join public.groups g on g.id = c.group_id where c.id = p_company;
$$;

-- Returns 'approve' for an independent checker, 'override' for an explicitly
-- configured Owner self-approval, and raises otherwise.
create or replace function numero_private.check_maker_checker(p_company uuid, p_maker uuid, p_what text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if p_maker is distinct from v_uid then return 'approve'; end if;
  if numero_private.maker_checker_mode(p_company) = 'owner_override'
     and numero_private.is_group_admin(numero_private.company_group(p_company)) then
    return 'override';
  end if;
  raise exception 'NUMERO: maker-checker control — the person who created this % cannot also approve it.', p_what using errcode = '42501';
end $$;

create or replace function numero_private.submit_journal(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.journals; v_rule public.approval_rules; v_steps text[]; v_req uuid; v_group uuid;
begin
  select * into j from public.journals where id = p_id for update;
  if not found then raise exception 'NUMERO: journal not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(j.company_id, 'journal.submit') then
    raise exception 'NUMERO: you are not authorised to submit journals.' using errcode = '42501';
  end if;
  if j.status <> 'draft' then raise exception 'NUMERO: only a draft can be submitted. This journal is %.', j.status using errcode = 'P0001'; end if;
  perform numero_private.assert_balanced(p_id);
  perform numero_private.assert_period_open(j.company_id, j.journal_date);
  select group_id into v_group from public.companies where id = j.company_id;

  select * into v_rule from public.approval_rules r
  where r.is_active and r.entity = 'journal' and r.group_id = v_group
    and (r.company_id = j.company_id or r.company_id is null)
    and j.total >= r.min_amount and (r.max_amount is null or j.total < r.max_amount)
  order by (r.company_id is not null) desc, r.min_amount desc limit 1;
  v_steps := case when found then v_rule.steps else array['*'] end;

  update public.approval_requests set status = 'cancelled', completed_at = now()
   where entity = 'journal' and entity_id = p_id and status = 'pending';
  insert into public.approval_requests(company_id, entity, entity_id, amount, rule_id, steps, summary, requested_by)
  values (j.company_id, 'journal', p_id, j.total, v_rule.id, v_steps, j.narration, (select auth.uid()))
  returning id into v_req;

  update public.journals set status = 'submitted', submitted_by = (select auth.uid()), submitted_at = now() where id = p_id;
  perform numero_private.log_event(j.company_id, 'journals', p_id, 'submitted', null,
    jsonb_build_object('approval_request', v_req, 'steps', v_steps), null);
  return v_req;
end $$;

create or replace function numero_private.approve_journal(p_id uuid, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare j public.journals; r public.approval_requests; v_role text; v_action text; v_uid uuid := (select auth.uid());
begin
  select * into j from public.journals where id = p_id for update;
  if not found then raise exception 'NUMERO: journal not found.' using errcode = 'P0001'; end if;
  if j.status <> 'submitted' then raise exception 'NUMERO: this journal is % and is not awaiting approval.', j.status using errcode = 'P0001'; end if;
  select * into r from public.approval_requests
   where entity = 'journal' and entity_id = p_id and status = 'pending' for update;
  if not found then raise exception 'NUMERO: no pending approval request for this journal.' using errcode = 'P0001'; end if;
  v_role := r.steps[r.current_step];
  if not numero_private.can(j.company_id, 'journal.approve') then
    raise exception 'NUMERO: you are not authorised to approve journals.' using errcode = '42501';
  end if;
  if v_role <> '*' and not numero_private.has_role(j.company_id, v_role)
     and not numero_private.is_group_admin(numero_private.company_group(j.company_id)) then
    raise exception 'NUMERO: this approval step requires the role %.', v_role using errcode = '42501';
  end if;
  v_action := numero_private.check_maker_checker(j.company_id, j.created_by, 'journal');
  if v_action = 'approve' and exists (
       select 1 from public.approval_actions a where a.request_id = r.id and a.actor = v_uid and a.action in ('approve','override')) then
    raise exception 'NUMERO: you have already approved an earlier step of this request.' using errcode = '42501';
  end if;
  insert into public.approval_actions(request_id, step, actor, action, comment)
  values (r.id, r.current_step, v_uid, v_action, p_comment);

  if r.current_step >= array_length(r.steps, 1) then
    update public.approval_requests set status = 'approved', completed_at = now() where id = r.id;
    update public.journals set status = 'approved', approved_by = v_uid, approved_at = now() where id = p_id;
    perform numero_private.log_event(j.company_id, 'journals', p_id, 'approved', null,
      jsonb_build_object('action', v_action, 'step', r.current_step), p_comment);
    return 'approved';
  else
    update public.approval_requests set current_step = current_step + 1 where id = r.id;
    perform numero_private.log_event(j.company_id, 'journals', p_id, 'approval_step', null,
      jsonb_build_object('action', v_action, 'step', r.current_step), p_comment);
    return 'pending';
  end if;
end $$;

create or replace function numero_private.reject_journal(p_id uuid, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.journals; r public.approval_requests;
begin
  select * into j from public.journals where id = p_id for update;
  if not found then raise exception 'NUMERO: journal not found.' using errcode = 'P0001'; end if;
  if j.status <> 'submitted' then raise exception 'NUMERO: this journal is not awaiting approval.' using errcode = 'P0001'; end if;
  if not numero_private.can(j.company_id, 'journal.reject') then
    raise exception 'NUMERO: you are not authorised to reject journals.' using errcode = '42501';
  end if;
  if coalesce(trim(p_comment), '') = '' then raise exception 'NUMERO: a reason is required to reject.' using errcode = 'P0001'; end if;
  select * into r from public.approval_requests where entity = 'journal' and entity_id = p_id and status = 'pending' for update;
  if found then
    insert into public.approval_actions(request_id, step, actor, action, comment)
    values (r.id, r.current_step, (select auth.uid()), 'reject', p_comment);
    update public.approval_requests set status = 'rejected', completed_at = now() where id = r.id;
  end if;
  update public.journals set status = 'rejected' where id = p_id;
  perform numero_private.log_event(j.company_id, 'journals', p_id, 'rejected', null, null, p_comment);
end $$;

create or replace function numero_private.cancel_journal(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.journals;
begin
  select * into j from public.journals where id = p_id for update;
  if not found then raise exception 'NUMERO: journal not found.' using errcode = 'P0001'; end if;
  if j.status not in ('draft','rejected','submitted','approved') then
    raise exception 'NUMERO: a % journal cannot be cancelled. Use reversal.', j.status using errcode = 'P0001';
  end if;
  if j.created_by <> (select auth.uid()) and not numero_private.can(j.company_id, 'journal.edit') then
    raise exception 'NUMERO: you are not authorised to cancel this journal.' using errcode = '42501';
  end if;
  update public.approval_requests set status = 'cancelled', completed_at = now()
   where entity = 'journal' and entity_id = p_id and status = 'pending';
  update public.journals set status = 'cancelled' where id = p_id;
  perform numero_private.log_event(j.company_id, 'journals', p_id, 'cancelled', null, null, p_reason);
end $$;

-- Internal: performs the actual posting. Callers must have authorised the action.
create or replace function numero_private.do_post(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare j public.journals; v_fy int; v_no bigint; v_prefix text; v_total numeric; v_group uuid; v_voucher text;
begin
  select * into j from public.journals where id = p_id for update;
  perform numero_private.assert_period_open(j.company_id, j.journal_date);
  perform numero_private.assert_balanced(p_id);
  if exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id
             where l.journal_id = p_id and (a.company_id <> j.company_id or a.is_group or not a.is_active)) then
    raise exception 'NUMERO: journal contains an invalid, inactive or group account.' using errcode = 'P0001';
  end if;
  select group_id into v_group from public.companies where id = j.company_id;
  v_fy := numero_private.fiscal_year(j.company_id, j.journal_date);
  insert into public.voucher_sequences(company_id, voucher_type, fy, last_no)
  values (j.company_id, j.voucher_type, v_fy, 1)
  on conflict (company_id, voucher_type, fy) do update set last_no = public.voucher_sequences.last_no + 1
  returning last_no into v_no;
  select vt.prefix into v_prefix from public.voucher_types vt
   where vt.key = j.voucher_type and (vt.group_id = v_group or vt.group_id is null)
   order by (vt.group_id is not null) desc limit 1;
  v_voucher := coalesce(v_prefix, 'JV') || '-' || v_fy::text || '-' || lpad(v_no::text, 6, '0');
  select sum(debit) into v_total from public.journal_lines where journal_id = p_id;
  update public.journals
     set status = 'posted', voucher_no = v_voucher, total = v_total,
         posted_by = (select auth.uid()), posted_at = now()
   where id = p_id;
  return v_voucher;
end $$;

create or replace function numero_private.post_journal(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare j public.journals; v_voucher text;
begin
  select * into j from public.journals where id = p_id for update;
  if not found then raise exception 'NUMERO: journal not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(j.company_id, 'journal.post') then
    raise exception 'NUMERO: you are not authorised to post journals.' using errcode = '42501';
  end if;
  if j.status = 'posted' then return j.voucher_no; end if;   -- idempotent
  if j.status <> 'approved' then
    raise exception 'NUMERO: a journal must be approved before posting. This journal is %.', j.status using errcode = 'P0001';
  end if;
  v_voucher := numero_private.do_post(p_id);
  perform numero_private.log_event(j.company_id, 'journals', p_id, 'posted', null,
    jsonb_build_object('voucher_no', v_voucher, 'total', j.total), null);
  return v_voucher;
end $$;

create or replace function numero_private.reverse_journal(p_id uuid, p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.journals; v_new uuid; v_voucher text;
begin
  select * into j from public.journals where id = p_id for update;
  if not found then raise exception 'NUMERO: journal not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(j.company_id, 'journal.reverse') then
    raise exception 'NUMERO: you are not authorised to reverse journals.' using errcode = '42501';
  end if;
  if j.status = 'reversed' then raise exception 'NUMERO: this journal has already been reversed.' using errcode = 'P0001'; end if;
  if j.status <> 'posted' then raise exception 'NUMERO: only posted journals can be reversed.' using errcode = 'P0001'; end if;
  if j.reversal_of is not null then raise exception 'NUMERO: a reversal journal cannot itself be reversed. Post a new correcting journal.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'NUMERO: a reason is required for reversal.' using errcode = 'P0001'; end if;

  insert into public.journals(company_id, voucher_type, journal_date, narration, purpose, source, source_id,
                              origin, reversal_of, confidentiality, created_by, idempotency_key)
  values (j.company_id, 'reversal', coalesce(p_date, current_date),
          'Reversal of ' || j.voucher_no || ': ' || p_reason, p_reason, 'reversal', j.id,
          'system', j.id, j.confidentiality, (select auth.uid()), 'reversal:' || j.id::text)
  returning id into v_new;

  insert into public.journal_lines(journal_id, company_id, line_no, account_id, party_id, description,
                                   debit, credit, txn_currency, txn_amount, fx_rate)
  select v_new, company_id, line_no, account_id, party_id, description, credit, debit, txn_currency, txn_amount, fx_rate
  from public.journal_lines where journal_id = p_id order by line_no;
  insert into public.journal_line_dims(line_id, type_key, org_unit_id)
  select nl.id, d.type_key, d.org_unit_id
  from public.journal_lines ol
  join public.journal_line_dims d on d.line_id = ol.id
  join public.journal_lines nl on nl.journal_id = v_new and nl.line_no = ol.line_no
  where ol.journal_id = p_id;

  v_voucher := numero_private.do_post(v_new);
  update public.journals set status = 'reversed', reversed_by = v_new where id = p_id;
  perform numero_private.log_event(j.company_id, 'journals', p_id, 'reversed',
    jsonb_build_object('voucher_no', j.voucher_no), jsonb_build_object('reversal_journal', v_new, 'reversal_voucher', v_voucher), p_reason);
  return v_new;
end $$;

create or replace function public.save_journal_draft(p jsonb) returns uuid language sql set search_path = '' as $$
  select numero_private.save_journal_draft(p); $$;
create or replace function public.submit_journal(p_id uuid) returns uuid language sql set search_path = '' as $$
  select numero_private.submit_journal(p_id); $$;
create or replace function public.approve_journal(p_id uuid, p_comment text default null) returns text language sql set search_path = '' as $$
  select numero_private.approve_journal(p_id, p_comment); $$;
create or replace function public.reject_journal(p_id uuid, p_comment text) returns void language sql set search_path = '' as $$
  select numero_private.reject_journal(p_id, p_comment); $$;
create or replace function public.cancel_journal(p_id uuid, p_reason text default null) returns void language sql set search_path = '' as $$
  select numero_private.cancel_journal(p_id, p_reason); $$;
create or replace function public.post_journal(p_id uuid) returns text language sql set search_path = '' as $$
  select numero_private.post_journal(p_id); $$;
create or replace function public.reverse_journal(p_id uuid, p_date date, p_reason text) returns uuid language sql set search_path = '' as $$
  select numero_private.reverse_journal(p_id, p_date, p_reason); $$;

-- ---------- audit triggers ----------
create trigger audit_journals after insert or update on public.journals
  for each row execute function numero_private.audit_row();
create trigger audit_accounts after insert or update or delete on public.accounts
  for each row execute function numero_private.audit_row();
create trigger audit_org_units after insert or update or delete on public.org_units
  for each row execute function numero_private.audit_row();
create trigger audit_parties after insert or update or delete on public.parties
  for each row execute function numero_private.audit_row();
create trigger audit_party_roles after insert or update or delete on public.party_roles
  for each row execute function numero_private.audit_row();
create trigger audit_party_bank after insert or update or delete on public.party_bank_accounts
  for each row execute function numero_private.audit_row();
create trigger audit_approval_rules after insert or update or delete on public.approval_rules
  for each row execute function numero_private.audit_row();
create trigger audit_vault_grants after insert or update or delete on public.vault_grants
  for each row execute function numero_private.audit_row();
create trigger audit_exchange_rates after insert or update or delete on public.exchange_rates
  for each row execute function numero_private.audit_row();
create trigger audit_account_map after insert or update or delete on public.company_account_map
  for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.currencies enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.org_unit_types enable row level security;
alter table public.org_units enable row level security;
alter table public.voucher_types enable row level security;
alter table public.party_types enable row level security;
alter table public.party_sequences enable row level security;
alter table public.parties enable row level security;
alter table public.party_roles enable row level security;
alter table public.party_bank_accounts enable row level security;
alter table public.alerts enable row level security;
alter table public.accounts enable row level security;
alter table public.company_account_map enable row level security;
alter table public.fiscal_periods enable row level security;
alter table public.voucher_sequences enable row level security;
alter table public.journals enable row level security;
alter table public.journal_lines enable row level security;
alter table public.journal_line_dims enable row level security;
alter table public.approval_rules enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_actions enable row level security;
alter table public.vault_grants enable row level security;
alter table public.vault_access_log enable row level security;

create policy currencies_select on public.currencies for select to authenticated using (true);

create policy fx_select on public.exchange_rates for select to authenticated
  using (group_id = (select numero_private.my_group()));
create policy fx_write on public.exchange_rates for insert to authenticated
  with check ((select numero_private.is_group_admin(group_id)));

create policy out_select on public.org_unit_types for select to authenticated
  using (group_id is null or group_id = (select numero_private.my_group()));
create policy out_write on public.org_unit_types for all to authenticated
  using (group_id is not null and (select numero_private.is_group_admin(group_id)))
  with check (group_id is not null and (select numero_private.is_group_admin(group_id)));

create policy vt_select on public.voucher_types for select to authenticated
  using (group_id is null or group_id = (select numero_private.my_group()));
create policy vt_write on public.voucher_types for all to authenticated
  using (group_id is not null and (select numero_private.is_group_admin(group_id)))
  with check (group_id is not null and (select numero_private.is_group_admin(group_id)));

create policy pt_select on public.party_types for select to authenticated
  using (group_id is null or group_id = (select numero_private.my_group()));
create policy pt_write on public.party_types for all to authenticated
  using (group_id is not null and (select numero_private.is_group_admin(group_id)))
  with check (group_id is not null and (select numero_private.is_group_admin(group_id)));

create policy org_units_select on public.org_units for select to authenticated
  using ((select numero_private.has_company_access(company_id))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy org_units_insert on public.org_units for insert to authenticated
  with check ((select numero_private.can(company_id, 'orgunit.configure')));
create policy org_units_update on public.org_units for update to authenticated
  using ((select numero_private.can(company_id, 'orgunit.configure')))
  with check ((select numero_private.can(company_id, 'orgunit.configure')));

create policy parties_select on public.parties for select to authenticated
  using ((select numero_private.is_group_admin(group_id))
         or exists (select 1 from public.party_roles pr
                    where pr.party_id = id and numero_private.has_company_access(pr.company_id)));

create policy party_roles_select on public.party_roles for select to authenticated
  using ((select numero_private.has_company_access(company_id)));

create policy party_bank_select on public.party_bank_accounts for select to authenticated
  using ((select numero_private.can(company_id, 'payment.view')));

create policy alerts_select on public.alerts for select to authenticated
  using ((select numero_private.can(company_id, 'sentinel.view')));

create policy accounts_select on public.accounts for select to authenticated
  using ((select numero_private.has_company_access(company_id)));
create policy accounts_insert on public.accounts for insert to authenticated
  with check ((select numero_private.can(company_id, 'account.configure')));
create policy accounts_update on public.accounts for update to authenticated
  using ((select numero_private.can(company_id, 'account.configure')))
  with check ((select numero_private.can(company_id, 'account.configure')));

create policy account_map_select on public.company_account_map for select to authenticated
  using ((select numero_private.has_company_access(company_id)));
create policy account_map_write on public.company_account_map for all to authenticated
  using ((select numero_private.can(company_id, 'account.configure')))
  with check ((select numero_private.can(company_id, 'account.configure')));

create policy periods_select on public.fiscal_periods for select to authenticated
  using ((select numero_private.has_company_access(company_id)));

create policy journals_select on public.journals for select to authenticated
  using ((select numero_private.can(company_id, 'journal.view'))
         and (select numero_private.can_view_level(company_id, confidentiality)));

create policy journal_lines_select on public.journal_lines for select to authenticated
  using (exists (select 1 from public.journals j where j.id = journal_id));

create policy journal_dims_select on public.journal_line_dims for select to authenticated
  using (exists (select 1 from public.journal_lines l where l.id = line_id));

create policy approval_rules_select on public.approval_rules for select to authenticated
  using (group_id = (select numero_private.my_group()));
create policy approval_rules_write on public.approval_rules for all to authenticated
  using ((select numero_private.is_group_admin(group_id))
         or (company_id is not null and (select numero_private.can(company_id, 'approval.configure'))))
  with check ((select numero_private.is_group_admin(group_id))
         or (company_id is not null and (select numero_private.can(company_id, 'approval.configure'))));

create policy approval_requests_select on public.approval_requests for select to authenticated
  using ((select numero_private.has_company_access(company_id)));
create policy approval_actions_select on public.approval_actions for select to authenticated
  using (exists (select 1 from public.approval_requests r where r.id = request_id));

create policy vault_grants_select on public.vault_grants for select to authenticated
  using (user_id = (select auth.uid()) or (select numero_private.is_group_admin(numero_private.company_group(company_id))));
create policy vault_grants_write on public.vault_grants for all to authenticated
  using ((select numero_private.is_group_admin(numero_private.company_group(company_id))))
  with check ((select numero_private.is_group_admin(numero_private.company_group(company_id))));

create policy vault_log_select on public.vault_access_log for select to authenticated
  using ((select numero_private.is_group_admin(numero_private.company_group(company_id))));

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
