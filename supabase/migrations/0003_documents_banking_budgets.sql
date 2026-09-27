-- =====================================================================
-- GHL NUMERO · 0003 · TAX, INVOICES/BILLS, PAYMENTS, BANKING, BUDGETS,
--                     COMPANY CREATION, PARTY CREATION
-- Spec: 3, 9, 11, 12, 15, 16, 20, 69 (event-driven accounting), 82, 109,
--       138, 166-167, 178, 390-392, 441-444, 542
-- NUMERO records accounting facts about payments. It never moves money.
-- =====================================================================

-- ---------- tax engine (rates are data, never hard-coded) ----------
create table public.tax_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  kind text not null default 'gst',
  jurisdiction text not null default 'IN',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create table public.tax_code_components (
  id uuid primary key default gen_random_uuid(),
  tax_code_id uuid not null references public.tax_codes(id) on delete cascade,
  component text not null,
  rate numeric(9,4) not null check (rate >= 0),
  output_account_id uuid references public.accounts(id),
  input_account_id uuid references public.accounts(id),
  effective_from date not null default '2000-01-01',
  effective_to date
);

-- ---------- invoices / bills / notes ----------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  doc_type text not null check (doc_type in ('sales_invoice','purchase_bill','credit_note','debit_note')),
  doc_no text,
  party_id uuid not null references public.parties(id),
  doc_date date not null,
  due_date date,
  currency text not null references public.currencies(code),
  fx_rate numeric(20,8) not null default 1 check (fx_rate > 0),
  reference text,
  place_of_supply text,
  narration text,
  subtotal numeric(20,4) not null default 0,
  tax_total numeric(20,4) not null default 0,
  total numeric(20,4) not null default 0,
  amount_settled numeric(20,4) not null default 0,
  status text not null default 'draft'
    check (status in ('draft','open','partially_paid','paid','cancelled','disputed')),
  journal_id uuid references public.journals(id),
  confidentiality text not null default 'internal',
  responsible_user uuid references public.profiles(id),
  origin text not null default 'human',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz
);
create unique index invoices_doc_no on public.invoices(company_id, doc_type, doc_no) where doc_no is not null;
create index invoices_party_idx on public.invoices(party_id);
create index invoices_company_idx on public.invoices(company_id, doc_type, status);
create index invoices_due_idx on public.invoices(company_id, due_date);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  company_id uuid not null references public.companies(id),
  line_no int not null,
  description text,
  account_id uuid not null references public.accounts(id),
  quantity numeric(20,4) not null default 1,
  rate numeric(20,4) not null default 0,
  amount numeric(20,4) not null default 0,
  tax_code_id uuid references public.tax_codes(id),
  tax_amount numeric(20,4) not null default 0,
  hsn_sac text,
  dims jsonb not null default '{}'::jsonb,
  unique (invoice_id, line_no)
);

create table public.doc_sequences (
  company_id uuid not null references public.companies(id),
  doc_type text not null,
  fy int not null,
  last_no bigint not null default 0,
  primary key (company_id, doc_type, fy)
);

-- ---------- payments / receipts ----------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  direction text not null check (direction in ('in','out')),
  pay_no text,
  party_id uuid not null references public.parties(id),
  bank_ledger_id uuid not null references public.accounts(id),
  party_bank_account_id uuid references public.party_bank_accounts(id),
  pay_date date not null,
  amount numeric(20,4) not null check (amount > 0),
  currency text not null references public.currencies(code),
  fx_rate numeric(20,8) not null default 1 check (fx_rate > 0),
  method text not null default 'bank_transfer',
  reference text,
  narration text,
  status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  journal_id uuid references public.journals(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz
);
create index payments_company_idx on public.payments(company_id, pay_date);
create index payments_party_idx on public.payments(party_id);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  invoice_id uuid not null references public.invoices(id),
  amount numeric(20,4) not null check (amount > 0),
  unique (payment_id, invoice_id)
);

-- ---------- banking ----------
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  ledger_account_id uuid not null references public.accounts(id),
  name text not null,
  bank_name text,
  account_no_masked text,
  ifsc text,
  currency text not null references public.currencies(code),
  kind text not null default 'bank' check (kind in ('bank','credit_card','corporate_card','upi','gateway','wallet','petty_cash','cash')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  bank_account_id uuid not null references public.bank_accounts(id),
  txn_date date not null,
  amount numeric(20,4) not null,
  narration text,
  reference text,
  running_balance numeric(20,4),
  import_batch uuid,
  fingerprint text not null,
  status text not null default 'unmatched'
    check (status in ('unmatched','suggested','matched','partial','duplicate','needs_review')),
  matched_line_id uuid references public.journal_lines(id),
  matched_by uuid, matched_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index bank_txn_idx on public.bank_transactions(bank_account_id, txn_date);
create index bank_txn_fp_idx on public.bank_transactions(bank_account_id, fingerprint);
create unique index bank_txn_one_match on public.bank_transactions(matched_line_id) where matched_line_id is not null;

-- Bank statement lines are evidence: they are never deleted and their facts never change.
create or replace function numero_private.guard_bank_txn() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'NUMERO: bank transactions are evidence and cannot be deleted.' using errcode = 'P0001';
  end if;
  if new.txn_date is distinct from old.txn_date or new.amount is distinct from old.amount
     or new.narration is distinct from old.narration or new.reference is distinct from old.reference
     or new.bank_account_id is distinct from old.bank_account_id or new.company_id is distinct from old.company_id then
    raise exception 'NUMERO: imported bank transaction facts cannot be altered.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger bank_txn_guard before update or delete on public.bank_transactions
  for each row execute function numero_private.guard_bank_txn();

-- ---------- budgets ----------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  fy int not null,
  version int not null default 1,
  kind text not null default 'opex' check (kind in ('opex','capex')),
  status text not null default 'draft' check (status in ('draft','approved','revised')),
  limit_mode text not null default 'soft' check (limit_mode in ('soft','hard')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  unique (company_id, name, fy, version)
);

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets(id),
  company_id uuid not null references public.companies(id),
  account_id uuid not null references public.accounts(id),
  org_unit_id uuid references public.org_units(id),
  period_month date not null,
  amount numeric(20,4) not null default 0
);
create index budget_lines_idx on public.budget_lines(budget_id, account_id, period_month);

create or replace function numero_private.budget_status(bid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select status from public.budgets where id = bid;
$$;

create or replace function numero_private.guard_budget() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'budget_lines' then
    if numero_private.budget_status(coalesce(new.budget_id, old.budget_id)) <> 'draft' then
      raise exception 'NUMERO: approved budgets are never overwritten. Create a revised version.' using errcode = 'P0001';
    end if;
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'NUMERO: approved budgets cannot be deleted.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and not (old.status = 'approved' and new.status = 'revised'
       and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status')) then
    raise exception 'NUMERO: approved budgets are never overwritten. Create a revised version.' using errcode = 'P0001';
  end if;
  if new.status = 'approved' and old.status = 'draft' then
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  end if;
  return new;
end $$;
create trigger budgets_guard before update or delete on public.budgets
  for each row execute function numero_private.guard_budget();
create trigger budget_lines_guard before insert or update or delete on public.budget_lines
  for each row execute function numero_private.guard_budget();

-- ---------- company creation ----------
create or replace function numero_private.create_company(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_gid uuid := numero_private.my_group();
  c jsonb := p->'company';
  v_id uuid; a jsonb; t jsonb; k jsonb; u jsonb; m record; v_acc uuid; v_tax uuid; v_fy date;
begin
  if v_gid is null or not numero_private.is_group_admin(v_gid) then
    raise exception 'NUMERO: only a Group Super Admin can create companies.' using errcode = '42501';
  end if;
  if coalesce(trim(c->>'name'), '') = '' or coalesce(trim(c->>'code'), '') = '' then
    raise exception 'NUMERO: company name and code are required.' using errcode = 'P0001';
  end if;

  insert into public.companies(group_id, code, name, legal_name, business_type, industry, country, state,
      registered_address, operating_locations, tax_jurisdiction, pan, gstin, cin, registration_numbers,
      fy_start_month, base_currency, additional_currencies, accounting_method, modules, template_key, created_by)
  values (v_gid, upper(trim(c->>'code')), trim(c->>'name'), c->>'legal_name', c->>'business_type', c->>'industry',
      coalesce(c->>'country', 'IN'), c->>'state', c->>'registered_address', c->>'operating_locations',
      c->>'tax_jurisdiction', nullif(c->>'pan', ''), nullif(c->>'gstin', ''), nullif(c->>'cin', ''),
      coalesce(c->'registration_numbers', '{}'::jsonb),
      coalesce((c->>'fy_start_month')::int, 4), coalesce(c->>'base_currency', 'INR'),
      coalesce(array(select jsonb_array_elements_text(coalesce(c->'additional_currencies', '[]'::jsonb))), '{}'),
      coalesce(c->>'accounting_method', 'accrual'), coalesce(c->'modules', '{}'::jsonb), c->>'template_key',
      (select auth.uid()))
  returning id into v_id;

  -- chart of accounts: first pass rows, second pass parents
  for a in select * from jsonb_array_elements(coalesce(p->'accounts', '[]'::jsonb)) loop
    insert into public.accounts(company_id, code, name, type, subtype, is_group, control_type, currency, description)
    values (v_id, a->>'code', a->>'name', a->>'type', coalesce(a->>'subtype', 'other'),
            coalesce((a->>'is_group')::boolean, false), nullif(a->>'control_type', ''),
            nullif(a->>'currency', ''), a->>'description');
  end loop;
  for a in select * from jsonb_array_elements(coalesce(p->'accounts', '[]'::jsonb)) loop
    if a->>'parent_code' is not null then
      update public.accounts ch set parent_id = pa.id
        from public.accounts pa
       where ch.company_id = v_id and ch.code = a->>'code'
         and pa.company_id = v_id and pa.code = a->>'parent_code';
    end if;
  end loop;

  for m in select key, value from jsonb_each_text(coalesce(p->'account_map', '{}'::jsonb)) loop
    select id into v_acc from public.accounts where company_id = v_id and code = m.value;
    if v_acc is null then
      raise exception 'NUMERO: account map "%" points to unknown account code %.', m.key, m.value using errcode = 'P0001';
    end if;
    insert into public.company_account_map(company_id, key, account_id) values (v_id, m.key, v_acc);
  end loop;

  for t in select * from jsonb_array_elements(coalesce(p->'tax_codes', '[]'::jsonb)) loop
    insert into public.tax_codes(company_id, code, name, kind, jurisdiction)
    values (v_id, t->>'code', t->>'name', coalesce(t->>'kind', 'gst'), coalesce(t->>'jurisdiction', 'IN'))
    returning id into v_tax;
    for k in select * from jsonb_array_elements(coalesce(t->'components', '[]'::jsonb)) loop
      insert into public.tax_code_components(tax_code_id, component, rate, output_account_id, input_account_id, effective_from)
      values (v_tax, k->>'component', (k->>'rate')::numeric,
              (select id from public.accounts where company_id = v_id and code = k->>'output_code'),
              (select id from public.accounts where company_id = v_id and code = k->>'input_code'),
              coalesce((k->>'effective_from')::date, '2000-01-01'));
    end loop;
  end loop;

  for u in select * from jsonb_array_elements(coalesce(p->'org_units', '[]'::jsonb)) loop
    insert into public.org_units(company_id, type_key, code, name)
    values (v_id, u->>'type_key', u->>'code', u->>'name');
  end loop;
  for u in select * from jsonb_array_elements(coalesce(p->'org_units', '[]'::jsonb)) loop
    if u->>'parent_code' is not null then
      update public.org_units ch set parent_id = pa.id
        from public.org_units pa
       where ch.company_id = v_id and ch.code = u->>'code' and ch.type_key = u->>'type_key'
         and pa.company_id = v_id and pa.code = u->>'parent_code';
    end if;
  end loop;

  perform numero_private.log_event(v_id, 'companies', v_id, 'company_created', null,
    jsonb_build_object('template', c->>'template_key',
                       'accounts', jsonb_array_length(coalesce(p->'accounts', '[]'::jsonb))),
    'Company created with user-confirmed configuration');
  return v_id;
end $$;

create or replace function public.create_company(p jsonb) returns uuid language sql set search_path = '' as $$
  select numero_private.create_company(p); $$;

-- ---------- parties ----------
create or replace function numero_private.norm_name(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(regexp_replace(lower(coalesce(t, '')), '\mprivate\M', 'pvt', 'g'), '\mlimited\M', 'ltd', 'g'),
           '[^a-z0-9]', '', 'g');
$$;

create or replace function numero_private.create_party(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid;
  v_gid uuid; v_type public.party_types; v_no bigint; v_id uuid; v_party_no text;
  v_dups jsonb; v_hidden int;
begin
  if not numero_private.can(v_company, 'party.create') then
    raise exception 'NUMERO: you are not authorised to create parties for this company.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'display_name'), '') = '' then
    raise exception 'NUMERO: party name is required.' using errcode = 'P0001';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  select * into v_type from public.party_types
   where key = coalesce(p->>'type_key', 'other') and (group_id = v_gid or group_id is null)
   order by (group_id is not null) desc limit 1;
  if not found then raise exception 'NUMERO: unknown party type %.', p->>'type_key' using errcode = 'P0001'; end if;

  -- possible duplicates are surfaced for human review, never merged automatically
  if not coalesce((p->>'force')::boolean, false) then
    with cand as (
      select pt.id, pt.party_no, pt.display_name,
             (numero_private.is_group_admin(v_gid) or exists (
                select 1 from public.party_roles pr
                where pr.party_id = pt.id and numero_private.has_company_access(pr.company_id))) as visible
      from public.parties pt
      where pt.group_id = v_gid
        and (numero_private.norm_name(pt.display_name) = numero_private.norm_name(p->>'display_name')
             or (nullif(p->>'pan', '') is not null and upper(pt.pan) = upper(p->>'pan'))
             or (nullif(p->>'gstin', '') is not null and upper(pt.gstin) = upper(p->>'gstin')))
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'party_no', party_no, 'display_name', display_name))
                    filter (where visible), '[]'::jsonb),
           count(*) filter (where not visible)
      into v_dups, v_hidden from cand;
    if jsonb_array_length(v_dups) > 0 or v_hidden > 0 then
      return jsonb_build_object('status', 'possible_duplicate', 'candidates', v_dups, 'restricted_matches', v_hidden);
    end if;
  end if;

  insert into public.party_sequences(group_id, prefix, last_no) values (v_gid, v_type.prefix, 1)
  on conflict (group_id, prefix) do update set last_no = public.party_sequences.last_no + 1
  returning last_no into v_no;
  v_party_no := 'NUM-' || v_type.prefix || '-' || lpad(v_no::text, 6, '0');

  insert into public.parties(group_id, party_no, kind, display_name, legal_name, pan, gstin, email, phone, address, notes, created_by)
  values (v_gid, v_party_no, coalesce(p->>'kind', 'organization'), trim(p->>'display_name'), p->>'legal_name',
          nullif(upper(p->>'pan'), ''), nullif(upper(p->>'gstin'), ''), nullif(p->>'email', ''), nullif(p->>'phone', ''),
          coalesce(p->'address', '{}'::jsonb), p->>'notes', (select auth.uid()))
  returning id into v_id;

  insert into public.party_roles(party_id, company_id, type_key, credit_limit, credit_days, payment_terms, created_by)
  values (v_id, v_company, v_type.key, (p->>'credit_limit')::numeric, (p->>'credit_days')::int, p->>'payment_terms', (select auth.uid()));

  return jsonb_build_object('status', 'created', 'id', v_id, 'party_no', v_party_no);
end $$;

create or replace function numero_private.add_party_role(p_party uuid, p_company uuid, p_type text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_gid uuid;
begin
  if not numero_private.can(p_company, 'party.create') then
    raise exception 'NUMERO: you are not authorised to add party relationships for this company.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = p_company;
  if not exists (select 1 from public.parties where id = p_party and group_id = v_gid) then
    raise exception 'NUMERO: party not found.' using errcode = 'P0001';
  end if;
  if not (numero_private.is_group_admin(v_gid) or exists (
      select 1 from public.party_roles pr where pr.party_id = p_party and numero_private.has_company_access(pr.company_id))) then
    raise exception 'NUMERO: party not found.' using errcode = 'P0001';
  end if;
  insert into public.party_roles(party_id, company_id, type_key, created_by)
  values (p_party, p_company, p_type, (select auth.uid()))
  on conflict (party_id, company_id, type_key) do update set status = 'active'
  returning id into v_id;
  return v_id;
end $$;

create or replace function numero_private.set_party_status(p_party uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare pt public.parties;
begin
  select * into pt from public.parties where id = p_party for update;
  if not found then raise exception 'NUMERO: party not found.' using errcode = 'P0001'; end if;
  if not (numero_private.is_group_admin(pt.group_id) or exists (
      select 1 from public.party_roles pr where pr.party_id = p_party and numero_private.can(pr.company_id, 'party.edit'))) then
    raise exception 'NUMERO: you are not authorised to change this party.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'NUMERO: a reason is required.' using errcode = 'P0001'; end if;
  perform set_config('numero.reason', p_reason, true);
  update public.parties set status = p_status, status_reason = p_reason where id = p_party;
end $$;

create or replace function numero_private.add_party_bank(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_party uuid := (p->>'party_id')::uuid; v_id uuid; v_had boolean; v_name text;
begin
  if not numero_private.can(v_company, 'party.edit') then
    raise exception 'NUMERO: you are not authorised to change party bank details.' using errcode = '42501';
  end if;
  select display_name into v_name from public.parties where id = v_party;
  select exists (select 1 from public.party_bank_accounts
                 where party_id = v_party and company_id = v_company and status = 'verified') into v_had;
  insert into public.party_bank_accounts(party_id, company_id, bank_name, account_no, ifsc, beneficiary_name, created_by)
  values (v_party, v_company, p->>'bank_name', p->>'account_no', p->>'ifsc', p->>'beneficiary_name', (select auth.uid()))
  returning id into v_id;
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  values (v_company, 'bank_detail_change', case when v_had then 'priority' else 'review' end,
          'BANK DETAIL CHANGE ALERT',
          case when v_had
            then 'New bank details were entered for ' || coalesce(v_name, 'a party') || ', which already has verified bank details. Payments cannot use the new details until an independent person verifies them.'
            else 'Bank details were entered for ' || coalesce(v_name, 'a party') || ' and await independent verification before any payment can use them.' end,
          jsonb_build_object('party_id', v_party, 'bank_account_id', v_id, 'entered_by', (select auth.uid())),
          'party_bank_accounts', v_id, 'bankchange:' || v_id::text);
  return v_id;
end $$;

create or replace function numero_private.verify_party_bank(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.party_bank_accounts; v_action text;
begin
  select * into b from public.party_bank_accounts where id = p_id for update;
  if not found then raise exception 'NUMERO: bank detail record not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(b.company_id, 'party.bank.verify') then
    raise exception 'NUMERO: you are not authorised to verify bank details.' using errcode = '42501';
  end if;
  if b.status <> 'pending_verification' then raise exception 'NUMERO: this record is not awaiting verification.' using errcode = 'P0001'; end if;
  if p_decision not in ('verified','rejected') then raise exception 'NUMERO: decision must be verified or rejected.'; end if;
  v_action := numero_private.check_maker_checker(b.company_id, b.created_by, 'bank detail change');
  perform set_config('numero.reason', coalesce(p_note, '') || case when v_action = 'override' then ' [Owner self-verification override]' else '' end, true);
  if p_decision = 'verified' then
    update public.party_bank_accounts set status = 'superseded'
     where party_id = b.party_id and company_id = b.company_id and status = 'verified';
  end if;
  update public.party_bank_accounts
     set status = p_decision, verified_by = (select auth.uid()), verified_at = now()
   where id = p_id;
  update public.alerts set status = 'resolved', reviewed_by = (select auth.uid()), reviewed_at = now(),
         review_note = 'Bank details ' || p_decision
   where entity = 'party_bank_accounts' and entity_id = p_id and status in ('open','reviewing');
end $$;

create or replace function public.create_party(p jsonb) returns jsonb language sql set search_path = '' as $$
  select numero_private.create_party(p); $$;
create or replace function public.add_party_role(p_party uuid, p_company uuid, p_type text) returns uuid language sql set search_path = '' as $$
  select numero_private.add_party_role(p_party, p_company, p_type); $$;
create or replace function public.set_party_status(p_party uuid, p_status text, p_reason text) returns void language sql set search_path = '' as $$
  select numero_private.set_party_status(p_party, p_status, p_reason); $$;
create or replace function public.add_party_bank(p jsonb) returns uuid language sql set search_path = '' as $$
  select numero_private.add_party_bank(p); $$;
create or replace function public.verify_party_bank(p_id uuid, p_decision text, p_note text default null) returns void language sql set search_path = '' as $$
  select numero_private.verify_party_bank(p_id, p_decision, p_note); $$;

-- ---------- invoices: draft + approval (event-driven posting) ----------
create or replace function numero_private.map_account(p_company uuid, p_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select account_id into v from public.company_account_map where company_id = p_company and key = p_key;
  if v is null then
    raise exception 'NUMERO: this company has no "%" account configured. Set it under Chart of Accounts → Account Mapping.', p_key using errcode = 'P0001';
  end if;
  return v;
end $$;

create or replace function numero_private.save_invoice(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid;
  v_type text := p->>'doc_type';
  v_perm text; v_id uuid := (p->>'id')::uuid; inv public.invoices; l jsonb; v_no int := 0;
  v_amount numeric; v_rate numeric; v_tax numeric; v_sub numeric := 0; v_taxtotal numeric := 0;
  v_party public.parties; v_gid uuid; v_acc public.accounts;
begin
  if v_type not in ('sales_invoice','purchase_bill','credit_note','debit_note') then
    raise exception 'NUMERO: unknown document type.' using errcode = 'P0001';
  end if;
  v_perm := case when v_type in ('sales_invoice','credit_note') then 'invoice.create' else 'bill.create' end;
  if not numero_private.can(v_company, v_perm) then
    raise exception 'NUMERO: you are not authorised to create this document.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  select * into v_party from public.parties where id = (p->>'party_id')::uuid and group_id = v_gid;
  if not found then raise exception 'NUMERO: a valid party is required.' using errcode = 'P0001'; end if;
  if v_party.status in ('blocked','terminated') then
    raise exception 'NUMERO: % is % — new documents are not permitted. Reason: %', v_party.display_name, v_party.status, coalesce(v_party.status_reason, 'not recorded') using errcode = 'P0001';
  end if;

  if v_id is not null then
    select * into inv from public.invoices where id = v_id for update;
    if not found or inv.company_id <> v_company then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
    if inv.status <> 'draft' then raise exception 'NUMERO: only drafts can be edited.' using errcode = 'P0001'; end if;
    update public.invoices set party_id = v_party.id, doc_date = (p->>'doc_date')::date, due_date = (p->>'due_date')::date,
      currency = coalesce(p->>'currency', currency), fx_rate = coalesce((p->>'fx_rate')::numeric, 1),
      reference = p->>'reference', place_of_supply = p->>'place_of_supply', narration = p->>'narration',
      confidentiality = coalesce(p->>'confidentiality', confidentiality)
    where id = v_id;
    delete from public.invoice_lines where invoice_id = v_id;
  else
    insert into public.invoices(company_id, doc_type, party_id, doc_date, due_date, currency, fx_rate, reference,
                                place_of_supply, narration, confidentiality, origin, responsible_user, created_by)
    values (v_company, v_type, v_party.id, (p->>'doc_date')::date, (p->>'due_date')::date,
            coalesce(p->>'currency', (select base_currency from public.companies where id = v_company)),
            coalesce((p->>'fx_rate')::numeric, 1), p->>'reference', p->>'place_of_supply', p->>'narration',
            coalesce(p->>'confidentiality', 'internal'), coalesce(p->>'origin', 'human'),
            (select auth.uid()), (select auth.uid()))
    returning id into v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_no := v_no + 1;
    select * into v_acc from public.accounts where id = (l->>'account_id')::uuid;
    if not found or v_acc.company_id <> v_company or v_acc.is_group then
      raise exception 'NUMERO: line % needs a valid posting account of this company.', v_no using errcode = 'P0001';
    end if;
    v_amount := round(coalesce((l->>'amount')::numeric,
                 coalesce((l->>'quantity')::numeric, 1) * coalesce((l->>'rate')::numeric, 0)), 2);
    if v_amount <= 0 then raise exception 'NUMERO: line % amount must be greater than zero.', v_no using errcode = 'P0001'; end if;
    v_tax := 0;
    if l->>'tax_code_id' is not null then
      select coalesce(sum(round(v_amount * k.rate / 100, 2)), 0) into v_tax
      from public.tax_code_components k join public.tax_codes t on t.id = k.tax_code_id
      where t.id = (l->>'tax_code_id')::uuid and t.company_id = v_company
        and k.effective_from <= (p->>'doc_date')::date
        and (k.effective_to is null or k.effective_to >= (p->>'doc_date')::date);
    end if;
    insert into public.invoice_lines(invoice_id, company_id, line_no, description, account_id, quantity, rate, amount,
                                     tax_code_id, tax_amount, hsn_sac, dims)
    values (v_id, v_company, v_no, l->>'description', v_acc.id, coalesce((l->>'quantity')::numeric, 1),
            coalesce((l->>'rate')::numeric, v_amount), v_amount, (l->>'tax_code_id')::uuid, v_tax, l->>'hsn_sac',
            coalesce(l->'dims', '{}'::jsonb));
    v_sub := v_sub + v_amount; v_taxtotal := v_taxtotal + v_tax;
  end loop;
  if v_no = 0 then raise exception 'NUMERO: a document needs at least one line.' using errcode = 'P0001'; end if;
  update public.invoices set subtotal = v_sub, tax_total = v_taxtotal, total = v_sub + v_taxtotal where id = v_id;
  perform numero_private.log_event(v_company, 'invoices', v_id, 'draft_saved', null,
    jsonb_build_object('lines', p->'lines', 'total', v_sub + v_taxtotal), null);
  return v_id;
end $$;

create or replace function numero_private.approve_invoice(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices; v_perm text; v_action text; v_j uuid; v_lines jsonb := '[]'::jsonb;
  v_sales boolean; v_normal boolean; v_control uuid; l record; k record; v_base numeric; v_total_base numeric := 0;
  v_fy int; v_no bigint; v_prefix text; v_doc_no text; v_vtype text; v_voucher text; v_side text; v_ctl_side text;
begin
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
  v_sales := inv.doc_type in ('sales_invoice','credit_note');
  v_normal := inv.doc_type in ('sales_invoice','purchase_bill');
  v_perm := case when v_sales then 'invoice.approve' else 'bill.approve' end;
  if not numero_private.can(inv.company_id, v_perm) then
    raise exception 'NUMERO: you are not authorised to approve this document.' using errcode = '42501';
  end if;
  if inv.status <> 'draft' then
    if inv.journal_id is not null then return inv.doc_no; end if;
    raise exception 'NUMERO: this document is % and cannot be approved.', inv.status using errcode = 'P0001';
  end if;
  v_action := numero_private.check_maker_checker(inv.company_id, inv.created_by, 'document');
  perform numero_private.assert_period_open(inv.company_id, inv.doc_date);

  -- duplicate supplier reference is surfaced, not silently accepted
  if inv.doc_type = 'purchase_bill' and inv.reference is not null and exists (
       select 1 from public.invoices o where o.company_id = inv.company_id and o.party_id = inv.party_id
          and o.doc_type = 'purchase_bill' and o.id <> inv.id and o.status <> 'cancelled'
          and lower(o.reference) = lower(inv.reference)) then
    insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
    values (inv.company_id, 'duplicate_invoice', 'priority', 'ANOMALY DETECTED — possible duplicate bill',
      'Supplier reference "' || inv.reference || '" has already been recorded for this party. This is a factual match for human review, not a conclusion.',
      jsonb_build_object('invoice_id', inv.id, 'reference', inv.reference), 'invoices', inv.id, 'dupbill:' || inv.id::text)
    on conflict (company_id, dedupe_key) do nothing;
  end if;

  v_control := numero_private.map_account(inv.company_id, case when v_sales then 'ar_control' else 'ap_control' end);
  -- which side do the revenue/expense lines sit on?
  v_side := case when (v_sales and v_normal) or (not v_sales and not v_normal) then 'credit' else 'debit' end;
  v_ctl_side := case when v_side = 'credit' then 'debit' else 'credit' end;

  for l in select * from public.invoice_lines where invoice_id = p_id order by line_no loop
    v_base := round(l.amount * inv.fx_rate, 2);
    v_total_base := v_total_base + v_base;
    v_lines := v_lines || jsonb_build_object('account_id', l.account_id, 'description', l.description,
      v_side, v_base, 'txn_currency', inv.currency, 'txn_amount', l.amount, 'fx_rate', inv.fx_rate, 'dims', l.dims);
  end loop;

  for k in
    select case when v_sales then c.output_account_id else c.input_account_id end as account_id,
           c.component, sum(round(il.amount * c.rate / 100, 2)) as tax
    from public.invoice_lines il
    join public.tax_code_components c on c.tax_code_id = il.tax_code_id
    where il.invoice_id = p_id and c.effective_from <= inv.doc_date
      and (c.effective_to is null or c.effective_to >= inv.doc_date)
    group by 1, 2 having sum(round(il.amount * c.rate / 100, 2)) > 0
  loop
    if k.account_id is null then
      raise exception 'NUMERO: tax component % has no ledger account configured.', k.component using errcode = 'P0001';
    end if;
    v_base := round(k.tax * inv.fx_rate, 2);
    v_total_base := v_total_base + v_base;
    v_lines := v_lines || jsonb_build_object('account_id', k.account_id, 'description', k.component,
      v_side, v_base, 'txn_currency', inv.currency, 'txn_amount', k.tax, 'fx_rate', inv.fx_rate);
  end loop;

  v_lines := jsonb_build_array(jsonb_build_object('account_id', v_control, 'party_id', inv.party_id,
      'description', coalesce(inv.narration, inv.doc_type), v_ctl_side, v_total_base,
      'txn_currency', inv.currency, 'txn_amount', inv.total, 'fx_rate', inv.fx_rate)) || v_lines;

  v_fy := numero_private.fiscal_year(inv.company_id, inv.doc_date);
  insert into public.doc_sequences(company_id, doc_type, fy, last_no) values (inv.company_id, inv.doc_type, v_fy, 1)
  on conflict (company_id, doc_type, fy) do update set last_no = public.doc_sequences.last_no + 1
  returning last_no into v_no;
  v_prefix := case inv.doc_type when 'sales_invoice' then 'INV' when 'purchase_bill' then 'BILL'
                                when 'credit_note' then 'CRN' else 'DBN' end;
  v_doc_no := v_prefix || '-' || v_fy::text || '-' || lpad(v_no::text, 6, '0');
  v_vtype := case inv.doc_type when 'sales_invoice' then 'sales' when 'purchase_bill' then 'purchase'
                               when 'credit_note' then 'credit_note' else 'debit_note' end;

  insert into public.journals(company_id, voucher_type, journal_date, narration, source, source_id, origin,
                              idempotency_key, confidentiality, created_by, approved_by, approved_at)
  values (inv.company_id, v_vtype, inv.doc_date,
          v_doc_no || coalesce(' · ' || inv.narration, ''), 'invoice', inv.id, 'system',
          'invoice:' || inv.id::text, inv.confidentiality, inv.created_by, (select auth.uid()), now())
  returning id into v_j;
  perform numero_private.write_journal_lines(v_j, inv.company_id, v_lines);
  v_voucher := numero_private.do_post(v_j);

  update public.invoices set status = 'open', doc_no = v_doc_no, journal_id = v_j,
         approved_by = (select auth.uid()), approved_at = now() where id = p_id;
  perform numero_private.log_event(inv.company_id, 'invoices', p_id, 'approved_and_posted', null,
    jsonb_build_object('doc_no', v_doc_no, 'voucher_no', v_voucher, 'approval', v_action,
                       'rule', 'InvoiceApproved → control account, revenue/expense, tax'), null);
  return v_doc_no;
end $$;

create or replace function public.save_invoice(p jsonb) returns uuid language sql set search_path = '' as $$
  select numero_private.save_invoice(p); $$;
create or replace function public.approve_invoice(p_id uuid) returns text language sql set search_path = '' as $$
  select numero_private.approve_invoice(p_id); $$;

-- ---------- payments / receipts ----------
create or replace function numero_private.save_payment(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_id uuid; v_gid uuid; v_party public.parties;
  v_bank public.accounts; a jsonb; inv public.invoices; v_alloc numeric := 0; v_amt numeric;
  v_dir text := p->>'direction';
begin
  if not numero_private.can(v_company, 'payment.create') then
    raise exception 'NUMERO: you are not authorised to record payments.' using errcode = '42501';
  end if;
  if v_dir not in ('in','out') then raise exception 'NUMERO: direction must be in or out.' using errcode = 'P0001'; end if;
  select group_id into v_gid from public.companies where id = v_company;
  select * into v_party from public.parties where id = (p->>'party_id')::uuid and group_id = v_gid;
  if not found then raise exception 'NUMERO: a valid party is required.' using errcode = 'P0001'; end if;
  if v_dir = 'out' and v_party.status in ('blocked','suspended','terminated') then
    raise exception 'NUMERO: % is % — new payments are not permitted.', v_party.display_name, v_party.status using errcode = 'P0001';
  end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> v_company or v_bank.control_type not in ('bank','cash') then
    raise exception 'NUMERO: choose a bank or cash ledger of this company.' using errcode = 'P0001';
  end if;
  if p->>'party_bank_account_id' is not null and not exists (
       select 1 from public.party_bank_accounts b where b.id = (p->>'party_bank_account_id')::uuid
          and b.party_id = v_party.id and b.status = 'verified') then
    raise exception 'NUMERO: the selected beneficiary bank details are not verified. Payment cannot use them.' using errcode = 'P0001';
  end if;

  insert into public.payments(company_id, direction, party_id, bank_ledger_id, party_bank_account_id, pay_date, amount,
                              currency, fx_rate, method, reference, narration, created_by)
  values (v_company, v_dir, v_party.id, v_bank.id, (p->>'party_bank_account_id')::uuid, (p->>'pay_date')::date,
          round((p->>'amount')::numeric, 2),
          coalesce(p->>'currency', (select base_currency from public.companies where id = v_company)),
          coalesce((p->>'fx_rate')::numeric, 1), coalesce(p->>'method', 'bank_transfer'),
          p->>'reference', p->>'narration', (select auth.uid()))
  returning id into v_id;

  for a in select * from jsonb_array_elements(coalesce(p->'allocations', '[]'::jsonb)) loop
    v_amt := round((a->>'amount')::numeric, 2);
    select * into inv from public.invoices where id = (a->>'invoice_id')::uuid;
    if not found or inv.company_id <> v_company or inv.party_id <> v_party.id then
      raise exception 'NUMERO: an allocation references a document of another party or company.' using errcode = 'P0001';
    end if;
    if inv.status not in ('open','partially_paid') then
      raise exception 'NUMERO: document % is % and cannot be settled.', inv.doc_no, inv.status using errcode = 'P0001';
    end if;
    if (v_dir = 'in') <> (inv.doc_type in ('sales_invoice','debit_note')) then
      raise exception 'NUMERO: document % cannot be settled by this payment direction.', inv.doc_no using errcode = 'P0001';
    end if;
    if v_amt > inv.total - inv.amount_settled then
      raise exception 'NUMERO: allocation of % exceeds the outstanding balance of %.', v_amt, inv.doc_no using errcode = 'P0001';
    end if;
    insert into public.payment_allocations(payment_id, invoice_id, amount) values (v_id, inv.id, v_amt);
    v_alloc := v_alloc + v_amt;
  end loop;
  if v_alloc > round((p->>'amount')::numeric, 2) then
    raise exception 'NUMERO: allocations exceed the payment amount.' using errcode = 'P0001';
  end if;
  return v_id;
end $$;

create or replace function numero_private.approve_payment(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  pay public.payments; v_action text; v_lines jsonb := '[]'::jsonb; v_bank_base numeric; v_ctl_base numeric := 0;
  v_unalloc numeric; v_adv_base numeric := 0; v_diff numeric; a record; v_control uuid; v_adv uuid; v_fx uuid;
  v_j uuid; v_fy int; v_no bigint; v_pay_no text; v_voucher text; v_in boolean; v_alloc numeric := 0;
begin
  select * into pay from public.payments where id = p_id for update;
  if not found then raise exception 'NUMERO: payment not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(pay.company_id, 'payment.approve') then
    raise exception 'NUMERO: you are not authorised to approve payments.' using errcode = '42501';
  end if;
  if pay.status = 'posted' then return pay.pay_no; end if;
  if pay.status <> 'draft' then raise exception 'NUMERO: this payment is %.', pay.status using errcode = 'P0001'; end if;
  v_action := numero_private.check_maker_checker(pay.company_id, pay.created_by, 'payment');
  perform numero_private.assert_period_open(pay.company_id, pay.pay_date);
  v_in := pay.direction = 'in';
  v_control := numero_private.map_account(pay.company_id, case when v_in then 'ar_control' else 'ap_control' end);

  v_bank_base := round(pay.amount * pay.fx_rate, 2);
  for a in select pa.amount, i.fx_rate, i.id, i.total, i.amount_settled, i.doc_no, i.status
             from public.payment_allocations pa join public.invoices i on i.id = pa.invoice_id
            where pa.payment_id = p_id for update of i loop
    if a.status not in ('open','partially_paid') or a.amount > a.total - a.amount_settled then
      raise exception 'NUMERO: document % can no longer absorb this allocation.', a.doc_no using errcode = 'P0001';
    end if;
    v_ctl_base := v_ctl_base + round(a.amount * a.fx_rate, 2);
    v_alloc := v_alloc + a.amount;
    update public.invoices set amount_settled = amount_settled + a.amount,
           status = case when amount_settled + a.amount >= total then 'paid' else 'partially_paid' end
     where id = a.id;
  end loop;
  v_unalloc := pay.amount - v_alloc;
  if v_unalloc > 0 then
    v_adv := numero_private.map_account(pay.company_id, case when v_in then 'customer_advances' else 'vendor_advances' end);
    v_adv_base := round(v_unalloc * pay.fx_rate, 2);
  end if;
  v_diff := v_bank_base - v_ctl_base - v_adv_base;   -- exchange difference on settlement

  v_lines := v_lines || jsonb_build_object('account_id', pay.bank_ledger_id, 'description', coalesce(pay.narration, pay.reference),
     case when v_in then 'debit' else 'credit' end, v_bank_base,
     'txn_currency', pay.currency, 'txn_amount', pay.amount, 'fx_rate', pay.fx_rate);
  if v_ctl_base > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', v_control, 'party_id', pay.party_id,
       'description', 'Settlement', case when v_in then 'credit' else 'debit' end, v_ctl_base);
  end if;
  if v_adv_base > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', v_adv, 'party_id', pay.party_id,
       'description', 'Advance — not yet settled against a document', case when v_in then 'credit' else 'debit' end, v_adv_base);
  end if;
  if v_diff <> 0 then
    v_fx := numero_private.map_account(pay.company_id, 'fx_gain_loss');
    -- receipt: bank debit bigger than receivable relieved => gain (credit). payment: bank credit bigger => loss (debit).
    v_lines := v_lines || jsonb_build_object('account_id', v_fx, 'description', 'Exchange difference on settlement',
       case when (v_in and v_diff > 0) or (not v_in and v_diff < 0) then 'credit' else 'debit' end, abs(v_diff));
  end if;

  v_fy := numero_private.fiscal_year(pay.company_id, pay.pay_date);
  insert into public.doc_sequences(company_id, doc_type, fy, last_no)
  values (pay.company_id, case when v_in then 'receipt' else 'payment' end, v_fy, 1)
  on conflict (company_id, doc_type, fy) do update set last_no = public.doc_sequences.last_no + 1
  returning last_no into v_no;
  v_pay_no := case when v_in then 'RCT' else 'PAY' end || '-' || v_fy::text || '-' || lpad(v_no::text, 6, '0');

  insert into public.journals(company_id, voucher_type, journal_date, narration, source, source_id, origin,
                              idempotency_key, created_by, approved_by, approved_at)
  values (pay.company_id, case when v_in then 'receipt' else 'payment' end, pay.pay_date,
          v_pay_no || coalesce(' · ' || pay.narration, ''), case when v_in then 'receipt' else 'payment' end,
          pay.id, 'system', 'payment:' || pay.id::text, pay.created_by, (select auth.uid()), now())
  returning id into v_j;
  perform numero_private.write_journal_lines(v_j, pay.company_id, v_lines);
  v_voucher := numero_private.do_post(v_j);
  update public.payments set status = 'posted', pay_no = v_pay_no, journal_id = v_j,
         approved_by = (select auth.uid()), approved_at = now() where id = p_id;
  perform numero_private.log_event(pay.company_id, 'payments', p_id, 'approved_and_posted', null,
    jsonb_build_object('pay_no', v_pay_no, 'voucher_no', v_voucher, 'approval', v_action,
                       'rule', case when v_in then 'PaymentReceived → Debit Bank, Credit Receivable' else 'PaymentMade → Debit Payable, Credit Bank' end), null);
  return v_pay_no;
end $$;

create or replace function public.save_payment(p jsonb) returns uuid language sql set search_path = '' as $$
  select numero_private.save_payment(p); $$;
create or replace function public.approve_payment(p_id uuid) returns text language sql set search_path = '' as $$
  select numero_private.approve_payment(p_id); $$;

-- ---------- bank import & reconciliation ----------
create or replace function numero_private.import_bank_transactions(p_bank uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bank_accounts; r jsonb; v_batch uuid := gen_random_uuid(); v_fp text; v_new int := 0; v_dup int := 0; v_status text;
begin
  select * into b from public.bank_accounts where id = p_bank;
  if not found then raise exception 'NUMERO: bank account not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(b.company_id, 'bank.import') then
    raise exception 'NUMERO: you are not authorised to import bank statements.' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if (r->>'txn_date') is null or (r->>'amount') is null then
      raise exception 'NUMERO: every statement row needs a date and an amount. Nothing was imported.' using errcode = 'P0001';
    end if;
    v_fp := md5(concat_ws('|', r->>'txn_date', round((r->>'amount')::numeric, 2)::text,
                          lower(coalesce(r->>'reference', '')), lower(coalesce(r->>'narration', ''))));
    if exists (select 1 from public.bank_transactions t where t.bank_account_id = p_bank and t.fingerprint = v_fp) then
      v_status := 'duplicate'; v_dup := v_dup + 1;
    else
      v_status := 'unmatched'; v_new := v_new + 1;
    end if;
    insert into public.bank_transactions(company_id, bank_account_id, txn_date, amount, narration, reference,
                                         running_balance, import_batch, fingerprint, status, created_by)
    values (b.company_id, p_bank, (r->>'txn_date')::date, round((r->>'amount')::numeric, 2), r->>'narration',
            r->>'reference', (r->>'running_balance')::numeric, v_batch, v_fp, v_status, (select auth.uid()));
  end loop;
  perform numero_private.log_event(b.company_id, 'bank_transactions', p_bank, 'statement_imported', null,
    jsonb_build_object('batch', v_batch, 'new', v_new, 'possible_duplicates', v_dup), null);
  return jsonb_build_object('batch', v_batch, 'imported', v_new, 'possible_duplicates', v_dup);
end $$;

create or replace function numero_private.suggest_bank_matches(p_bank uuid)
returns table (txn_id uuid, line_id uuid, journal_id uuid, voucher_no text, journal_date date, narration text,
               amount numeric, score int, reasons text[])
language plpgsql stable security definer set search_path = '' as $$
declare b public.bank_accounts;
begin
  select * into b from public.bank_accounts where id = p_bank;
  if not found or not numero_private.can(b.company_id, 'bank.view') then
    raise exception 'NUMERO: bank account not found.' using errcode = 'P0001';
  end if;
  return query
  select t.id, l.id, j.id, j.voucher_no, j.journal_date, j.narration, (l.debit - l.credit),
         (50 + case when j.journal_date = t.txn_date then 30 else greatest(0, 20 - abs(j.journal_date - t.txn_date) * 4) end
             + case when t.reference is not null and t.reference <> '' and position(lower(t.reference) in lower(coalesce(j.narration, '') || ' ' || coalesce(l.description, ''))) > 0 then 20 else 0 end)::int,
         array_remove(array['amount matches exactly',
           case when j.journal_date = t.txn_date then 'same date' else 'date within ' || abs(j.journal_date - t.txn_date) || ' day(s)' end,
           case when t.reference is not null and t.reference <> '' and position(lower(t.reference) in lower(coalesce(j.narration, '') || ' ' || coalesce(l.description, ''))) > 0 then 'reference appears in book narration' end], null)
  from public.bank_transactions t
  join public.journal_lines l on l.company_id = b.company_id and l.account_id = b.ledger_account_id
       and (l.debit - l.credit) = t.amount
  join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
       and numero_private.can_view_level(j.company_id, j.confidentiality)
  where t.bank_account_id = p_bank and t.status in ('unmatched','suggested','needs_review')
    and abs(j.journal_date - t.txn_date) <= 7
    and not exists (select 1 from public.bank_transactions m where m.matched_line_id = l.id)
  order by t.txn_date, 8 desc;
end $$;

create or replace function numero_private.set_bank_match(p_txn uuid, p_line uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.bank_transactions; l public.journal_lines; b public.bank_accounts;
begin
  select * into t from public.bank_transactions where id = p_txn for update;
  if not found then raise exception 'NUMERO: bank transaction not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(t.company_id, 'bank.reconcile') then
    raise exception 'NUMERO: you are not authorised to reconcile.' using errcode = '42501';
  end if;
  if p_status not in ('matched','unmatched','needs_review','duplicate','partial') then
    raise exception 'NUMERO: invalid reconciliation status.' using errcode = 'P0001';
  end if;
  if p_status = 'matched' then
    select * into b from public.bank_accounts where id = t.bank_account_id;
    select * into l from public.journal_lines where id = p_line;
    if not found or l.company_id <> t.company_id or l.account_id <> b.ledger_account_id then
      raise exception 'NUMERO: the book entry does not belong to this bank ledger.' using errcode = 'P0001';
    end if;
    if (l.debit - l.credit) <> t.amount then
      raise exception 'NUMERO: amounts differ (bank %, books %). Questionable matches are never forced.', t.amount, (l.debit - l.credit) using errcode = 'P0001';
    end if;
    update public.bank_transactions set status = 'matched', matched_line_id = p_line,
           matched_by = (select auth.uid()), matched_at = now(), note = p_note where id = p_txn;
  else
    update public.bank_transactions set status = p_status, matched_line_id = null,
           matched_by = (select auth.uid()), matched_at = now(), note = p_note where id = p_txn;
  end if;
  perform numero_private.log_event(t.company_id, 'bank_transactions', p_txn, 'reconciliation_' || p_status,
    jsonb_build_object('status', t.status, 'matched_line_id', t.matched_line_id),
    jsonb_build_object('status', p_status, 'matched_line_id', p_line), p_note);
end $$;

create or replace function public.import_bank_transactions(p_bank uuid, p_rows jsonb) returns jsonb language sql set search_path = '' as $$
  select numero_private.import_bank_transactions(p_bank, p_rows); $$;
create or replace function public.suggest_bank_matches(p_bank uuid)
returns table (txn_id uuid, line_id uuid, journal_id uuid, voucher_no text, journal_date date, narration text,
               amount numeric, score int, reasons text[])
language sql stable set search_path = '' as $$
  select * from numero_private.suggest_bank_matches(p_bank); $$;
create or replace function public.set_bank_match(p_txn uuid, p_line uuid, p_status text, p_note text default null) returns void language sql set search_path = '' as $$
  select numero_private.set_bank_match(p_txn, p_line, p_status, p_note); $$;

-- ---------- audit triggers ----------
create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function numero_private.audit_row();
create trigger audit_payments after insert or update or delete on public.payments
  for each row execute function numero_private.audit_row();
create trigger audit_bank_accounts after insert or update or delete on public.bank_accounts
  for each row execute function numero_private.audit_row();
create trigger audit_budgets after insert or update or delete on public.budgets
  for each row execute function numero_private.audit_row();
create trigger audit_tax_codes after insert or update or delete on public.tax_codes
  for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.tax_codes enable row level security;
alter table public.tax_code_components enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.doc_sequences enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.budget_lines enable row level security;

create policy tax_codes_select on public.tax_codes for select to authenticated
  using ((select numero_private.has_company_access(company_id)));
create policy tax_codes_write on public.tax_codes for all to authenticated
  using ((select numero_private.can(company_id, 'tax.configure')))
  with check ((select numero_private.can(company_id, 'tax.configure')));
create policy tax_components_select on public.tax_code_components for select to authenticated
  using (exists (select 1 from public.tax_codes t where t.id = tax_code_id));
create policy tax_components_write on public.tax_code_components for all to authenticated
  using (exists (select 1 from public.tax_codes t where t.id = tax_code_id and numero_private.can(t.company_id, 'tax.configure')))
  with check (exists (select 1 from public.tax_codes t where t.id = tax_code_id and numero_private.can(t.company_id, 'tax.configure')));

create policy invoices_select on public.invoices for select to authenticated
  using ((select numero_private.can(company_id, case when doc_type in ('sales_invoice','credit_note') then 'invoice.view' else 'bill.view' end))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));

create policy payments_select on public.payments for select to authenticated
  using ((select numero_private.can(company_id, 'payment.view')));
create policy payment_alloc_select on public.payment_allocations for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id));

create policy bank_accounts_select on public.bank_accounts for select to authenticated
  using ((select numero_private.can(company_id, 'bank.view')));
create policy bank_accounts_insert on public.bank_accounts for insert to authenticated
  with check ((select numero_private.can(company_id, 'account.configure')));
create policy bank_accounts_update on public.bank_accounts for update to authenticated
  using ((select numero_private.can(company_id, 'account.configure')))
  with check ((select numero_private.can(company_id, 'account.configure')));

create policy bank_txn_select on public.bank_transactions for select to authenticated
  using ((select numero_private.can(company_id, 'bank.view')));

create policy budgets_select on public.budgets for select to authenticated
  using ((select numero_private.can(company_id, 'budget.view')));
create policy budgets_insert on public.budgets for insert to authenticated
  with check ((select numero_private.can(company_id, 'budget.edit')) and status = 'draft');
create policy budgets_update on public.budgets for update to authenticated
  using ((select numero_private.can(company_id, 'budget.edit')))
  with check ((select numero_private.can(company_id, 'budget.edit'))
              and (status <> 'approved' or (select numero_private.can(company_id, 'budget.approve'))));
create policy budget_lines_select on public.budget_lines for select to authenticated
  using ((select numero_private.can(company_id, 'budget.view')));
create policy budget_lines_write on public.budget_lines for all to authenticated
  using ((select numero_private.can(company_id, 'budget.edit')))
  with check ((select numero_private.can(company_id, 'budget.edit')));

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
