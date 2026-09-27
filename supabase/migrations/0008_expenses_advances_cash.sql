-- >>> applied as migration 20260927073242 · p2_11_expense_policy_advances
-- =====================================================================
-- GHL NUMERO · 0008 · NUMERO FLOW — ADVANCES, EXPENSE CLAIMS, POLICY,
--                     PETTY CASH, CASH COUNTS, FUND TRANSFERS,
--                     PROMISE-TO-PAY
-- Spec: 132-133, 154, 207, 209-215, 256, 314, 534, 678, 1388, 1556-1570
--
-- APPROVAL ≠ FUND TRANSFER ≠ EXPENSE ≠ ACCOUNTING CLASSIFICATION ≠ SETTLEMENT.
-- An advance is money held by a person, not an expense. It becomes an
-- expense only through an approved settlement supported by evidence.
-- Policy flags inform the approver. They never reject on their own.
-- =====================================================================

-- ---------- expense categories & policy ----------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  account_id uuid not null references public.accounts(id),
  limit_per_item numeric(20,4),
  limit_per_day numeric(20,4),
  receipt_required_above numeric(20,4),
  max_age_days int,
  guidance text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (company_id, name)
);

create or replace function numero_private.save_expense_category(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; a public.accounts;
begin
  if not numero_private.can(v_company, 'expense.approve') then
    raise exception 'NUMERO: you are not authorised to configure expense policy.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: the category needs a name.' using errcode = 'P0001'; end if;
  select * into a from public.accounts where id = (p->>'account_id')::uuid;
  if not found or a.company_id <> v_company or a.is_group or not a.is_active then
    raise exception 'NUMERO: choose an active posting account of this company.' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.expense_categories(company_id, name, account_id, limit_per_item, limit_per_day, receipt_required_above, max_age_days, guidance)
    values (v_company, trim(p->>'name'), a.id, (p->>'limit_per_item')::numeric, (p->>'limit_per_day')::numeric,
            (p->>'receipt_required_above')::numeric, (p->>'max_age_days')::int, p->>'guidance')
    returning id into v_id;
  else
    perform set_config('numero.reason', coalesce(p->>'reason', ''), true);
    update public.expense_categories set name = trim(p->>'name'), account_id = a.id,
      limit_per_item = (p->>'limit_per_item')::numeric, limit_per_day = (p->>'limit_per_day')::numeric,
      receipt_required_above = (p->>'receipt_required_above')::numeric, max_age_days = (p->>'max_age_days')::int,
      guidance = p->>'guidance', is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id and company_id = v_company;
    if not found then raise exception 'NUMERO: category not found.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

-- =====================================================================
-- 1. ADVANCES
-- =====================================================================
create table public.advances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  advance_no text not null,
  recipient_party_id uuid not null references public.parties(id),
  recipient_type text not null default 'employee'
    check (recipient_type in ('employee','department','project','site','travel','procurement','vendor','petty_cash','emergency','other')),
  purpose text not null,
  register_item_id uuid references public.register_items(id),
  dims jsonb not null default '{}'::jsonb,
  currency text not null references public.currencies(code),
  requested_amount numeric(20,4) not null check (requested_amount > 0),
  approved_amount numeric(20,4) not null default 0,
  released_amount numeric(20,4) not null default 0,
  settled_amount numeric(20,4) not null default 0,
  returned_amount numeric(20,4) not null default 0,
  expected_settlement_date date,
  released_on date,
  payment_method text,
  settlement_closed boolean not null default false,
  review_flag text check (review_flag in ('disputed','under_review')),
  status text not null default 'draft'
    check (status in ('draft','requested','approved','rejected','partially_released','released','partially_settled',
                      'settled','return_due','returned','disputed','under_review','cancelled')),
  last_follow_up date,
  notes text,
  confidentiality text not null default 'internal',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  unique (company_id, advance_no),
  check (released_amount >= 0 and settled_amount >= 0 and returned_amount >= 0)
);
create index advances_company_idx on public.advances(company_id, status);
create index advances_recipient_idx on public.advances(recipient_party_id);

create or replace function numero_private.refresh_advance_status(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.advances; v_out numeric; v_new text;
begin
  select * into a from public.advances where id = p_id for update;
  if a.status in ('draft','requested','rejected','cancelled') then return a.status; end if;
  v_out := a.released_amount - a.settled_amount - a.returned_amount;
  v_new := case
    when a.review_flag is not null and v_out > 0 then a.review_flag
    when a.released_amount = 0 then 'approved'
    when v_out <= 0 and a.settled_amount = 0 then 'returned'
    when v_out <= 0 then 'settled'
    when a.settlement_closed then 'return_due'
    when a.settled_amount > 0 or a.returned_amount > 0 then 'partially_settled'
    when a.released_amount < a.approved_amount then 'partially_released'
    else 'released' end;
  update public.advances set status = v_new where id = p_id;
  return v_new;
end $$;

create or replace function numero_private.save_advance(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_gid uuid; a public.advances;
        v_amt numeric := round((p->>'requested_amount')::numeric, 2); d record; pt public.parties;
begin
  if not numero_private.can(v_company, 'expense.create') then
    raise exception 'NUMERO: you are not authorised to request advances.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  select * into pt from public.parties where id = (p->>'recipient_party_id')::uuid and group_id = v_gid;
  if not found then raise exception 'NUMERO: choose who receives the advance.' using errcode = 'P0001'; end if;
  if pt.status in ('blocked','suspended','terminated') then
    raise exception 'NUMERO: % is % — a new advance is not permitted.', pt.display_name, pt.status using errcode = 'P0001';
  end if;
  if coalesce(trim(p->>'purpose'), '') = '' then raise exception 'NUMERO: the purpose of the advance is required.' using errcode = 'P0001'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'NUMERO: the amount must be greater than zero.' using errcode = 'P0001'; end if;
  for d in select key, value from jsonb_each_text(coalesce(p->'dims', '{}'::jsonb)) loop
    if d.value is not null and d.value <> '' and not exists (
         select 1 from public.org_units u where u.id = d.value::uuid and u.company_id = v_company) then
      raise exception 'NUMERO: a selected dimension belongs to another company.' using errcode = 'P0001';
    end if;
  end loop;
  if p->>'register_item_id' is not null and not exists (
       select 1 from public.register_items r where r.id = (p->>'register_item_id')::uuid and r.company_id = v_company) then
    raise exception 'NUMERO: the linked trip or path belongs to another company.' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.advances(company_id, advance_no, recipient_party_id, recipient_type, purpose, register_item_id, dims, currency,
      requested_amount, expected_settlement_date, payment_method, notes, confidentiality, created_by)
    values (v_company, numero_private.next_doc_no(v_company, 'advance', 'ADV', current_date), pt.id,
      coalesce(p->>'recipient_type', 'employee'), trim(p->>'purpose'), (p->>'register_item_id')::uuid,
      coalesce(p->'dims', '{}'::jsonb), coalesce(p->>'currency', (select base_currency from public.companies where id = v_company)),
      v_amt, (p->>'expected_settlement_date')::date, p->>'payment_method', p->>'notes',
      coalesce(p->>'confidentiality', 'internal'), (select auth.uid()))
    returning id into v_id;
    return v_id;
  end if;
  select * into a from public.advances where id = v_id and company_id = v_company for update;
  if not found then raise exception 'NUMERO: advance not found.' using errcode = 'P0001'; end if;
  if a.status not in ('draft','rejected') then
    raise exception 'NUMERO: only a draft request can be edited. This advance is %.', a.status using errcode = 'P0001';
  end if;
  if a.created_by <> (select auth.uid()) and not numero_private.can(v_company, 'expense.approve') then
    raise exception 'NUMERO: you are not authorised to edit this request.' using errcode = '42501';
  end if;
  update public.advances set status = 'draft', recipient_party_id = pt.id, recipient_type = coalesce(p->>'recipient_type', recipient_type),
    purpose = trim(p->>'purpose'), register_item_id = (p->>'register_item_id')::uuid, dims = coalesce(p->'dims', '{}'::jsonb),
    requested_amount = v_amt, expected_settlement_date = (p->>'expected_settlement_date')::date,
    payment_method = p->>'payment_method', notes = p->>'notes'
  where id = v_id;
  return v_id;
end $$;

create or replace function numero_private.submit_advance(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.advances; v_name text;
begin
  select * into a from public.advances where id = p_id for update;
  if not found then raise exception 'NUMERO: advance not found.' using errcode = 'P0001'; end if;
  if a.created_by <> (select auth.uid()) and not numero_private.can(a.company_id, 'expense.approve') then
    raise exception 'NUMERO: you are not authorised to submit this request.' using errcode = '42501';
  end if;
  if a.status <> 'draft' then raise exception 'NUMERO: this advance is %.', a.status using errcode = 'P0001'; end if;
  select display_name into v_name from public.parties where id = a.recipient_party_id;
  perform numero_private.open_request(a.company_id, 'advance', a.id, a.requested_amount,
    a.advance_no || ' · ' || v_name || ' · ' || a.purpose);
  update public.advances set status = 'requested' where id = p_id;
  perform numero_private.log_event(a.company_id, 'advances', p_id, 'requested', null,
    jsonb_build_object('advance_no', a.advance_no, 'amount', a.requested_amount), null);
end $$;

create or replace function numero_private.approve_advance(p_id uuid, p_amount numeric, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.advances; v_res text; v_amt numeric; v_open int; v_open_amt numeric;
begin
  select * into a from public.advances where id = p_id for update;
  if not found then raise exception 'NUMERO: advance not found.' using errcode = 'P0001'; end if;
  if a.status <> 'requested' then raise exception 'NUMERO: this advance is % and is not awaiting approval.', a.status using errcode = 'P0001'; end if;
  v_amt := round(coalesce(p_amount, a.requested_amount), 2);
  if v_amt <= 0 or v_amt > a.requested_amount then
    raise exception 'NUMERO: the approved amount must be greater than zero and cannot exceed the requested %.', a.requested_amount using errcode = 'P0001';
  end if;
  -- the approver must have seen the recipient's unsettled history (spec 1562): it is recorded with the decision
  select count(*), coalesce(sum(x.released_amount - x.settled_amount - x.returned_amount), 0) into v_open, v_open_amt
    from public.advances x
   where x.recipient_party_id = a.recipient_party_id and x.company_id = a.company_id and x.id <> a.id
     and x.released_amount - x.settled_amount - x.returned_amount > 0;
  v_res := numero_private.decide_request(a.company_id, 'advance', a.id, a.created_by, 'expense.approve', 'advance', p_comment);
  if v_res = 'approved' then
    update public.advances set status = 'approved', approved_amount = v_amt,
           approved_by = (select auth.uid()), approved_at = now() where id = p_id;
  end if;
  perform numero_private.log_event(a.company_id, 'advances', p_id, case when v_res = 'approved' then 'approved' else 'approval_step' end, null,
    jsonb_build_object('approved_amount', v_amt, 'requested_amount', a.requested_amount,
                       'recipient_open_advances', v_open, 'recipient_unsettled_amount', v_open_amt,
                       'note', 'Approval authorises the advance. It does not release money.'), p_comment);
  return v_res;
end $$;

create or replace function numero_private.reject_advance(p_id uuid, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.advances;
begin
  select * into a from public.advances where id = p_id for update;
  if not found then raise exception 'NUMERO: advance not found.' using errcode = 'P0001'; end if;
  if a.status <> 'requested' then raise exception 'NUMERO: this advance is not awaiting approval.' using errcode = 'P0001'; end if;
  perform numero_private.refuse_request(a.company_id, 'advance', a.id, 'expense.approve', 'advance', p_comment);
  update public.advances set status = 'rejected' where id = p_id;
  perform numero_private.log_event(a.company_id, 'advances', p_id, 'rejected', null, null, p_comment);
end $$;

-- Records that money was handed over. Proposes: Dr Advances (recipient) / Cr Bank or Cash.
create or replace function numero_private.release_advance(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.advances; v_amt numeric := round((p->>'amount')::numeric, 2); v_date date := (p->>'date')::date;
        v_bank public.accounts; v_adv uuid; v_name text; v_pending numeric; v_j uuid;
begin
  select * into a from public.advances where id = (p->>'advance_id')::uuid for update;
  if not found then raise exception 'NUMERO: advance not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(a.company_id, 'payment.create') then
    raise exception 'NUMERO: you are not authorised to record the release of money.' using errcode = '42501';
  end if;
  if a.status not in ('approved','partially_released') then
    raise exception 'NUMERO: this advance is % and cannot be released.', a.status using errcode = 'P0001';
  end if;
  if v_date is null then raise exception 'NUMERO: the release date is required.' using errcode = 'P0001'; end if;
  select coalesce(sum((w.payload->>'amount')::numeric), 0) into v_pending from public.workflow_postings w
   where w.source = 'advance_release' and w.source_id = a.id and w.status = 'pending';
  if v_amt is null or v_amt <= 0 or v_amt > a.approved_amount - a.released_amount - v_pending then
    raise exception 'NUMERO: the release must be greater than zero and cannot exceed the unreleased approved amount of %.', a.approved_amount - a.released_amount - v_pending using errcode = 'P0001';
  end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> a.company_id or v_bank.control_type not in ('bank','cash') then
    raise exception 'NUMERO: choose the bank or cash ledger the money was paid from.' using errcode = 'P0001';
  end if;
  v_adv := numero_private.map_account(a.company_id, 'employee_advances');
  select display_name into v_name from public.parties where id = a.recipient_party_id;
  v_j := numero_private.propose_posting(a.company_id, 'payment', v_date,
    'Advance ' || a.advance_no || ' released to ' || v_name || ' — ' || a.purpose, 'advance_release', a.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_adv, 'party_id', a.recipient_party_id, 'debit', v_amt,
                         'description', 'Advance held by ' || v_name || ' — not yet an expense', 'dims', a.dims),
      jsonb_build_object('account_id', v_bank.id, 'credit', v_amt, 'description', coalesce(p->>'reference', a.advance_no))),
    jsonb_build_object('amount', v_amt, 'date', v_date, 'method', p->>'method', 'reference', p->>'reference'),
    a.confidentiality);
  update public.advances set payment_method = coalesce(p->>'method', payment_method) where id = a.id;
  return v_j;
end $$;

create or replace function numero_private.wf_advance_release(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.advances; v_amt numeric := (w.payload->>'amount')::numeric;
begin
  select * into a from public.advances where id = w.source_id for update;
  if p_event = 'posted' then
    update public.advances set released_amount = released_amount + v_amt,
           released_on = coalesce(released_on, (w.payload->>'date')::date) where id = a.id;
    perform numero_private.refresh_advance_status(a.id);
  elsif p_event = 'reversed' then
    if a.released_amount - v_amt < a.settled_amount + a.returned_amount then
      raise exception 'NUMERO: settlements or returns have been recorded against this release. Reverse those first.' using errcode = 'P0001';
    end if;
    update public.advances set released_amount = released_amount - v_amt where id = a.id;
    perform numero_private.refresh_advance_status(a.id);
  end if;
end $$;

-- Unused money handed back. Proposes: Dr Bank or Cash / Cr Advances (recipient).
create or replace function numero_private.return_advance(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.advances; v_amt numeric := round((p->>'amount')::numeric, 2); v_date date := (p->>'date')::date;
        v_bank public.accounts; v_adv uuid; v_name text; v_pending numeric; v_j uuid;
begin
  select * into a from public.advances where id = (p->>'advance_id')::uuid for update;
  if not found then raise exception 'NUMERO: advance not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(a.company_id, 'payment.create') then
    raise exception 'NUMERO: you are not authorised to record the return of money.' using errcode = '42501';
  end if;
  if v_date is null then raise exception 'NUMERO: the date of return is required.' using errcode = 'P0001'; end if;
  select coalesce(sum((w.payload->>'amount')::numeric), 0) into v_pending from public.workflow_postings w
   where w.source in ('advance_return') and w.source_id = a.id and w.status = 'pending';
  if v_amt is null or v_amt <= 0 or v_amt > a.released_amount - a.settled_amount - a.returned_amount - v_pending then
    raise exception 'NUMERO: the return must be greater than zero and cannot exceed the unsettled balance of %.', a.released_amount - a.settled_amount - a.returned_amount - v_pending using errcode = 'P0001';
  end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> a.company_id or v_bank.control_type not in ('bank','cash') then
    raise exception 'NUMERO: choose the bank or cash ledger that received the money.' using errcode = 'P0001';
  end if;
  v_adv := numero_private.map_account(a.company_id, 'employee_advances');
  select display_name into v_name from public.parties where id = a.recipient_party_id;
  v_j := numero_private.propose_posting(a.company_id, 'receipt', v_date,
    'Unused advance ' || a.advance_no || ' returned by ' || v_name, 'advance_return', a.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_bank.id, 'debit', v_amt, 'description', coalesce(p->>'reference', a.advance_no)),
      jsonb_build_object('account_id', v_adv, 'party_id', a.recipient_party_id, 'credit', v_amt,
                         'description', 'Advance returned', 'dims', a.dims)),
    jsonb_build_object('amount', v_amt, 'date', v_date, 'method', p->>'method'), a.confidentiality);
  return v_j;
end $$;

create or replace function numero_private.wf_advance_return(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_amt numeric := (w.payload->>'amount')::numeric;
begin
  if p_event = 'posted' then
    update public.advances set returned_amount = returned_amount + v_amt where id = w.source_id;
    perform numero_private.refresh_advance_status(w.source_id);
  elsif p_event = 'reversed' then
    update public.advances set returned_amount = greatest(returned_amount - v_amt, 0) where id = w.source_id;
    perform numero_private.refresh_advance_status(w.source_id);
  end if;
end $$;

create or replace function numero_private.flag_advance(p_id uuid, p_flag text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.advances;
begin
  select * into a from public.advances where id = p_id for update;
  if not found then raise exception 'NUMERO: advance not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(a.company_id, 'expense.approve') then
    raise exception 'NUMERO: you are not authorised to change the review status of an advance.' using errcode = '42501';
  end if;
  if p_flag is not null and p_flag not in ('disputed','under_review','follow_up','cancelled') then
    raise exception 'NUMERO: unknown status.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'NUMERO: a note is required.' using errcode = 'P0001'; end if;
  if p_flag = 'follow_up' then
    update public.advances set last_follow_up = current_date where id = p_id;
  elsif p_flag = 'cancelled' then
    if a.released_amount > 0 or exists (select 1 from public.workflow_postings w where w.source = 'advance_release' and w.source_id = a.id and w.status = 'pending') then
      raise exception 'NUMERO: money has been released against this advance. It cannot be cancelled; record its settlement or return.' using errcode = 'P0001';
    end if;
    update public.approval_requests set status = 'cancelled', completed_at = now()
     where entity = 'advance' and entity_id = a.id and status = 'pending';
    update public.advances set status = 'cancelled' where id = p_id;
  else
    update public.advances set review_flag = p_flag where id = p_id;
    perform numero_private.refresh_advance_status(p_id);
  end if;
  perform numero_private.log_event(a.company_id, 'advances', p_id, coalesce(p_flag, 'review_cleared'), null, null, p_note);
end $$;

-- >>> applied as migration 20260927073416 · p2_12_expense_claims
-- =====================================================================
-- 2. EXPENSE CLAIMS
-- =====================================================================
create table public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  claim_no text not null,
  claimant_party_id uuid not null references public.parties(id),
  title text not null,
  purpose text,
  advance_id uuid references public.advances(id),
  final_settlement boolean not null default false,
  register_item_id uuid references public.register_items(id),
  currency text not null references public.currencies(code),
  total numeric(20,4) not null default 0,
  approved_total numeric(20,4) not null default 0,
  advance_applied numeric(20,4) not null default 0,
  payable numeric(20,4) not null default 0,
  flagged_lines int not null default 0,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','rejected','posted','paid','cancelled')),
  journal_id uuid references public.journals(id),
  payment_journal_id uuid references public.journals(id),
  paid_on date,
  notes text,
  decision_note text,
  confidentiality text not null default 'internal',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  unique (company_id, claim_no)
);
create index expense_claims_company_idx on public.expense_claims(company_id, status);
create index expense_claims_claimant_idx on public.expense_claims(claimant_party_id);
create index expense_claims_advance_idx on public.expense_claims(advance_id) where advance_id is not null;

create table public.expense_claim_lines (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.expense_claims(id),
  company_id uuid not null references public.companies(id),
  line_no int not null,
  expense_date date not null,
  category_id uuid references public.expense_categories(id),
  account_id uuid not null references public.accounts(id),
  description text not null,
  merchant text,
  amount numeric(20,4) not null check (amount > 0),
  approved_amount numeric(20,4) not null default 0 check (approved_amount >= 0),
  paid_by text not null default 'claimant' check (paid_by in ('claimant','company')),
  paid_from_ledger_id uuid references public.accounts(id),
  has_receipt boolean not null default false,
  document_id uuid references public.documents(id),
  flags text[] not null default '{}',
  approver_note text,
  dims jsonb not null default '{}'::jsonb,
  unique (claim_id, line_no)
);
create index expense_claim_lines_dup_idx on public.expense_claim_lines(company_id, expense_date, amount);

create or replace function numero_private.save_claim(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_gid uuid; c public.expense_claims;
  pt public.parties; adv public.advances; l jsonb; v_no int := 0; cat public.expense_categories; acc public.accounts;
  led public.accounts; v_amt numeric; v_flags text[]; v_total numeric := 0; v_flagged int := 0; v_date date; v_day numeric; d record;
  v_receipt boolean;
begin
  if not numero_private.can(v_company, 'expense.create') then
    raise exception 'NUMERO: you are not authorised to prepare expense claims.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  select * into pt from public.parties where id = (p->>'claimant_party_id')::uuid and group_id = v_gid;
  if not found then raise exception 'NUMERO: choose the person who incurred the expense.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'NUMERO: the claim needs a title.' using errcode = 'P0001'; end if;
  if p->>'advance_id' is not null then
    select * into adv from public.advances where id = (p->>'advance_id')::uuid;
    if not found or adv.company_id <> v_company or adv.recipient_party_id <> pt.id then
      raise exception 'NUMERO: the advance being settled belongs to a different person or company.' using errcode = 'P0001';
    end if;
    if adv.released_amount - adv.settled_amount - adv.returned_amount <= 0 then
      raise exception 'NUMERO: advance % has no unsettled balance.', adv.advance_no using errcode = 'P0001';
    end if;
  end if;

  if v_id is not null then
    select * into c from public.expense_claims where id = v_id and company_id = v_company for update;
    if not found then raise exception 'NUMERO: claim not found.' using errcode = 'P0001'; end if;
    if c.status not in ('draft','rejected') then
      raise exception 'NUMERO: only a draft claim can be edited. This claim is %.', c.status using errcode = 'P0001';
    end if;
    if c.created_by <> (select auth.uid()) and not numero_private.can(v_company, 'expense.approve') then
      raise exception 'NUMERO: you are not authorised to edit this claim.' using errcode = '42501';
    end if;
    update public.expense_claims set status = 'draft', claimant_party_id = pt.id, title = trim(p->>'title'), purpose = p->>'purpose',
      advance_id = (p->>'advance_id')::uuid, final_settlement = coalesce((p->>'final_settlement')::boolean, false),
      register_item_id = (p->>'register_item_id')::uuid, notes = p->>'notes'
    where id = v_id;
    delete from public.expense_claim_lines where claim_id = v_id;
  else
    insert into public.expense_claims(company_id, claim_no, claimant_party_id, title, purpose, advance_id, final_settlement,
      register_item_id, currency, notes, confidentiality, created_by)
    values (v_company, numero_private.next_doc_no(v_company, 'expense_claim', 'EXP', current_date), pt.id, trim(p->>'title'),
      p->>'purpose', (p->>'advance_id')::uuid, coalesce((p->>'final_settlement')::boolean, false),
      (p->>'register_item_id')::uuid, coalesce(p->>'currency', (select base_currency from public.companies where id = v_company)),
      p->>'notes', coalesce(p->>'confidentiality', 'internal'), (select auth.uid()))
    returning id into v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_no := v_no + 1;
    v_date := (l->>'expense_date')::date;
    if v_date is null then raise exception 'NUMERO: line % needs the date of the expense.', v_no using errcode = 'P0001'; end if;
    if v_date > current_date then raise exception 'NUMERO: line % is dated in the future.', v_no using errcode = 'P0001'; end if;
    if coalesce(trim(l->>'description'), '') = '' then raise exception 'NUMERO: line % needs a description.', v_no using errcode = 'P0001'; end if;
    v_amt := round((l->>'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'NUMERO: line % amount must be greater than zero.', v_no using errcode = 'P0001'; end if;
    cat := null;
    if l->>'category_id' is not null then
      select * into cat from public.expense_categories where id = (l->>'category_id')::uuid and company_id = v_company;
      if not found then raise exception 'NUMERO: line % uses an unknown expense category.', v_no using errcode = 'P0001'; end if;
    end if;
    select * into acc from public.accounts where id = coalesce((l->>'account_id')::uuid, cat.account_id);
    if not found or acc.company_id <> v_company or acc.is_group or not acc.is_active then
      raise exception 'NUMERO: line % needs a category or an active posting account of this company.', v_no using errcode = 'P0001';
    end if;
    led := null;
    if coalesce(l->>'paid_by', 'claimant') = 'company' then
      select * into led from public.accounts where id = (l->>'paid_from_ledger_id')::uuid;
      if not found or led.company_id <> v_company or led.is_group then
        raise exception 'NUMERO: line % was paid by the company — choose the card, cash or bank ledger it was paid from.', v_no using errcode = 'P0001';
      end if;
    end if;
    for d in select key, value from jsonb_each_text(coalesce(l->'dims', '{}'::jsonb)) loop
      if d.value is not null and d.value <> '' and not exists (
           select 1 from public.org_units u where u.id = d.value::uuid and u.company_id = v_company) then
        raise exception 'NUMERO: line % references a dimension outside this company.', v_no using errcode = 'P0001';
      end if;
    end loop;
    if l->>'document_id' is not null and not exists (
         select 1 from public.documents x where x.id = (l->>'document_id')::uuid and x.company_id = v_company) then
      raise exception 'NUMERO: line % references a document of another company.', v_no using errcode = 'P0001';
    end if;
    v_receipt := coalesce((l->>'has_receipt')::boolean, false) or l->>'document_id' is not null;

    -- policy flags: facts for the approver, never an automatic rejection
    v_flags := '{}';
    if cat.limit_per_item is not null and v_amt > cat.limit_per_item then
      v_flags := v_flags || ('OUTSIDE POLICY — above the limit of ' || cat.limit_per_item || ' per item');
    end if;
    if cat.limit_per_day is not null then
      select coalesce(sum((x->>'amount')::numeric), 0) into v_day
        from jsonb_array_elements(p->'lines') x
       where x->>'category_id' = l->>'category_id' and (x->>'expense_date')::date = v_date;
      if v_day > cat.limit_per_day then
        v_flags := v_flags || ('OUTSIDE POLICY — ' || v_day || ' claimed for the day against a daily limit of ' || cat.limit_per_day);
      end if;
    end if;
    if not v_receipt and (cat.receipt_required_above is null or v_amt > cat.receipt_required_above) then
      v_flags := v_flags || 'EVIDENCE MISSING — no receipt attached'::text;
    end if;
    if cat.max_age_days is not null and current_date - v_date > cat.max_age_days then
      v_flags := v_flags || ('LATE CLAIM — expense is ' || (current_date - v_date) || ' days old (policy ' || cat.max_age_days || ')');
    end if;
    if exists (select 1 from public.expense_claim_lines o join public.expense_claims oc on oc.id = o.claim_id
                where oc.company_id = v_company and oc.claimant_party_id = pt.id and oc.id <> v_id
                  and oc.status not in ('rejected','cancelled')
                  and o.expense_date = v_date and o.amount = v_amt
                  and lower(coalesce(o.merchant, '')) = lower(coalesce(l->>'merchant', ''))) then
      v_flags := v_flags || 'POSSIBLE DUPLICATE — same person, date, amount and merchant on another claim'::text;
    end if;
    if extract(isodow from v_date) in (6, 7) then
      v_flags := v_flags || 'WEEKEND — expense dated on a Saturday or Sunday'::text;
    end if;

    insert into public.expense_claim_lines(claim_id, company_id, line_no, expense_date, category_id, account_id, description, merchant,
      amount, approved_amount, paid_by, paid_from_ledger_id, has_receipt, document_id, flags, dims)
    values (v_id, v_company, v_no, v_date, cat.id, acc.id, trim(l->>'description'), nullif(trim(l->>'merchant'), ''),
      v_amt, v_amt, coalesce(l->>'paid_by', 'claimant'), led.id, v_receipt, (l->>'document_id')::uuid, v_flags,
      coalesce(l->'dims', '{}'::jsonb));
    v_total := v_total + v_amt;
    if array_length(v_flags, 1) > 0 then v_flagged := v_flagged + 1; end if;
  end loop;
  if v_no = 0 then raise exception 'NUMERO: the claim needs at least one expense line.' using errcode = 'P0001'; end if;
  update public.expense_claims set total = v_total, approved_total = v_total, flagged_lines = v_flagged where id = v_id;
  return v_id;
end $$;

create or replace function numero_private.submit_claim(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.expense_claims; v_name text;
begin
  select * into c from public.expense_claims where id = p_id for update;
  if not found then raise exception 'NUMERO: claim not found.' using errcode = 'P0001'; end if;
  if c.created_by <> (select auth.uid()) and not numero_private.can(c.company_id, 'expense.approve') then
    raise exception 'NUMERO: you are not authorised to submit this claim.' using errcode = '42501';
  end if;
  if c.status <> 'draft' then raise exception 'NUMERO: this claim is %.', c.status using errcode = 'P0001'; end if;
  select display_name into v_name from public.parties where id = c.claimant_party_id;
  perform numero_private.open_request(c.company_id, 'expense_claim', c.id, c.total,
    c.claim_no || ' · ' || v_name || ' · ' || c.title || case when c.flagged_lines > 0 then ' · ' || c.flagged_lines || ' line(s) flagged' else '' end);
  update public.expense_claims set status = 'submitted' where id = p_id;
  perform numero_private.log_event(c.company_id, 'expense_claims', p_id, 'submitted', null,
    jsonb_build_object('claim_no', c.claim_no, 'total', c.total, 'flagged_lines', c.flagged_lines), null);
end $$;

-- Builds and proposes the accounting entry of an approved claim.
create or replace function numero_private.propose_claim_posting(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.expense_claims; adv public.advances; l record; v_lines jsonb := '[]'::jsonb; v_name text;
  v_claimant numeric := 0; v_company_paid jsonb := '{}'::jsonb; v_apply numeric := 0; v_payable numeric; v_date date; k record; v_j uuid;
begin
  select * into c from public.expense_claims where id = p_id for update;
  if c.status <> 'approved' then raise exception 'NUMERO: only an approved claim can be posted.' using errcode = 'P0001'; end if;
  select display_name into v_name from public.parties where id = c.claimant_party_id;
  select max(expense_date) into v_date from public.expense_claim_lines where claim_id = p_id and approved_amount > 0;
  for l in select * from public.expense_claim_lines where claim_id = p_id and approved_amount > 0 order by line_no loop
    v_lines := v_lines || jsonb_build_object('account_id', l.account_id, 'party_id', c.claimant_party_id, 'debit', l.approved_amount,
      'description', l.description || coalesce(' · ' || l.merchant, '') || ' · ' || l.expense_date, 'dims', l.dims);
    if l.paid_by = 'company' then
      v_company_paid := v_company_paid || jsonb_build_object(l.paid_from_ledger_id::text,
        coalesce((v_company_paid->>(l.paid_from_ledger_id::text))::numeric, 0) + l.approved_amount);
    else
      v_claimant := v_claimant + l.approved_amount;
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'NUMERO: nothing was approved on this claim.' using errcode = 'P0001'; end if;

  for k in select key, value from jsonb_each_text(v_company_paid) loop
    v_lines := v_lines || jsonb_build_object('account_id', k.key, 'credit', k.value::numeric,
      'description', 'Paid by the company — ' || c.claim_no);
  end loop;
  if c.advance_id is not null and v_claimant > 0 then
    select * into adv from public.advances where id = c.advance_id for update;
    v_apply := least(v_claimant, greatest(adv.released_amount - adv.settled_amount - adv.returned_amount, 0));
    if v_apply > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', numero_private.map_account(c.company_id, 'employee_advances'),
        'party_id', c.claimant_party_id, 'credit', v_apply,
        'description', 'Settled against advance ' || adv.advance_no, 'dims', adv.dims);
    end if;
  end if;
  v_payable := v_claimant - v_apply;
  if v_payable > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', numero_private.map_account(c.company_id, 'employee_payable'),
      'party_id', c.claimant_party_id, 'credit', v_payable, 'description', 'Reimbursement due to ' || v_name);
  end if;

  v_j := numero_private.propose_posting(c.company_id, 'expense', v_date,
    'Expense claim ' || c.claim_no || ' · ' || v_name || ' · ' || c.title, 'expense_claim', c.id, v_lines,
    jsonb_build_object('advance_id', c.advance_id, 'advance_applied', v_apply, 'payable', v_payable,
                       'final_settlement', c.final_settlement), c.confidentiality);
  update public.expense_claims set journal_id = v_j, advance_applied = v_apply, payable = v_payable where id = p_id;
  return v_j;
end $$;

create or replace function numero_private.approve_claim(p_id uuid, p_comment text, p_lines jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.expense_claims; v_res text; x jsonb; v_amt numeric; ln public.expense_claim_lines; v_total numeric;
begin
  select * into c from public.expense_claims where id = p_id for update;
  if not found then raise exception 'NUMERO: claim not found.' using errcode = 'P0001'; end if;
  if c.status = 'approved' and c.journal_id is null then
    -- the accounting entry was rejected earlier; an authorised person issues it again
    if not numero_private.can(c.company_id, 'expense.approve') then
      raise exception 'NUMERO: you are not authorised to approve expense claims.' using errcode = '42501';
    end if;
    perform numero_private.propose_claim_posting(p_id);
    return 'approved';
  end if;
  if c.status <> 'submitted' then raise exception 'NUMERO: this claim is % and is not awaiting approval.', c.status using errcode = 'P0001'; end if;
  if not numero_private.can(c.company_id, 'expense.approve') then
    raise exception 'NUMERO: you are not authorised to approve expense claims.' using errcode = '42501';
  end if;

  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into ln from public.expense_claim_lines where id = (x->>'line_id')::uuid and claim_id = p_id;
    if not found then raise exception 'NUMERO: a line decision refers to a line that is not on this claim.' using errcode = 'P0001'; end if;
    v_amt := round((x->>'approved_amount')::numeric, 2);
    if v_amt is null or v_amt < 0 or v_amt > ln.amount then
      raise exception 'NUMERO: line % — the approved amount must be between zero and the claimed %.', ln.line_no, ln.amount using errcode = 'P0001';
    end if;
    if v_amt < ln.amount and coalesce(trim(x->>'note'), '') = '' then
      raise exception 'NUMERO: line % — give the reason for approving less than was claimed.', ln.line_no using errcode = 'P0001';
    end if;
    update public.expense_claim_lines set approved_amount = v_amt, approver_note = x->>'note' where id = ln.id;
  end loop;
  if exists (select 1 from public.expense_claim_lines where claim_id = p_id and array_length(flags, 1) > 0 and approved_amount > 0)
     and coalesce(trim(p_comment), '') = '' then
    raise exception 'NUMERO: this claim has flagged lines. Record your reason for approving them.' using errcode = 'P0001';
  end if;

  v_res := numero_private.decide_request(c.company_id, 'expense_claim', c.id, c.created_by, 'expense.approve', 'expense claim', p_comment);
  select coalesce(sum(approved_amount), 0) into v_total from public.expense_claim_lines where claim_id = p_id;
  update public.expense_claims set approved_total = v_total where id = p_id;
  if v_res = 'approved' then
    if v_total <= 0 then raise exception 'NUMERO: nothing is approved on this claim. Reject it instead.' using errcode = 'P0001'; end if;
    update public.expense_claims set status = 'approved', decision_note = p_comment,
           approved_by = (select auth.uid()), approved_at = now() where id = p_id;
    perform numero_private.propose_claim_posting(p_id);
  end if;
  perform numero_private.log_event(c.company_id, 'expense_claims', p_id, case when v_res = 'approved' then 'approved' else 'approval_step' end, null,
    jsonb_build_object('claimed', c.total, 'approved', v_total, 'flagged_lines', c.flagged_lines,
                       'note', 'Approval accepts the expense. The accounting entry is approved separately; payment is a further step.'), p_comment);
  return v_res;
end $$;

create or replace function numero_private.reject_claim(p_id uuid, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.expense_claims;
begin
  select * into c from public.expense_claims where id = p_id for update;
  if not found then raise exception 'NUMERO: claim not found.' using errcode = 'P0001'; end if;
  if c.status <> 'submitted' then raise exception 'NUMERO: this claim is not awaiting approval.' using errcode = 'P0001'; end if;
  perform numero_private.refuse_request(c.company_id, 'expense_claim', c.id, 'expense.approve', 'expense claim', p_comment);
  update public.expense_claims set status = 'rejected', decision_note = p_comment where id = p_id;
  perform numero_private.log_event(c.company_id, 'expense_claims', p_id, 'rejected', null, null, p_comment);
end $$;

create or replace function numero_private.cancel_claim(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.expense_claims;
begin
  select * into c from public.expense_claims where id = p_id for update;
  if not found then raise exception 'NUMERO: claim not found.' using errcode = 'P0001'; end if;
  if c.created_by <> (select auth.uid()) and not numero_private.can(c.company_id, 'expense.approve') then
    raise exception 'NUMERO: you are not authorised to cancel this claim.' using errcode = '42501';
  end if;
  if c.status not in ('draft','submitted','rejected') and not (c.status = 'approved' and c.journal_id is null) then
    raise exception 'NUMERO: this claim is % and can no longer be cancelled. Reverse its journal instead.', c.status using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'NUMERO: a reason is required.' using errcode = 'P0001'; end if;
  update public.approval_requests set status = 'cancelled', completed_at = now()
   where entity = 'expense_claim' and entity_id = c.id and status = 'pending';
  update public.expense_claims set status = 'cancelled', decision_note = p_reason where id = p_id;
  perform numero_private.log_event(c.company_id, 'expense_claims', p_id, 'cancelled', null, null, p_reason);
end $$;

create or replace function numero_private.wf_expense_claim(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.expense_claims; v_apply numeric := coalesce((w.payload->>'advance_applied')::numeric, 0);
        v_payable numeric := coalesce((w.payload->>'payable')::numeric, 0); v_adv uuid := (w.payload->>'advance_id')::uuid;
begin
  select * into c from public.expense_claims where id = w.source_id for update;
  if p_event = 'posted' then
    update public.expense_claims set status = case when v_payable > 0 then 'posted' else 'paid' end,
           paid_on = case when v_payable > 0 then null else current_date end where id = c.id;
    if v_adv is not null then
      update public.advances set settled_amount = settled_amount + v_apply,
             settlement_closed = settlement_closed or coalesce((w.payload->>'final_settlement')::boolean, false)
       where id = v_adv;
      perform numero_private.refresh_advance_status(v_adv);
    end if;
  elsif p_event = 'voided' then
    update public.expense_claims set journal_id = null, advance_applied = 0, payable = 0 where id = c.id;
  elsif p_event = 'reversed' then
    if c.status = 'paid' and c.payment_journal_id is not null then
      raise exception 'NUMERO: this claim has been reimbursed. Reverse the reimbursement first.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.workflow_postings x where x.source = 'claim_payment' and x.source_id = c.id and x.status = 'pending') then
      raise exception 'NUMERO: a reimbursement for this claim is awaiting approval. Reject it first.' using errcode = 'P0001';
    end if;
    update public.expense_claims set status = 'cancelled', decision_note = 'Accounting entry reversed: ' || coalesce(current_setting('numero.reason', true), '') where id = c.id;
    if v_adv is not null then
      update public.advances set settled_amount = greatest(settled_amount - v_apply, 0), settlement_closed = false where id = v_adv;
      perform numero_private.refresh_advance_status(v_adv);
    end if;
  end if;
end $$;

-- Reimbursement. Proposes: Dr Reimbursements payable (claimant) / Cr Bank or Cash.
create or replace function numero_private.pay_claim(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.expense_claims; v_bank public.accounts; v_date date := (p->>'date')::date; v_name text; v_j uuid;
begin
  select * into c from public.expense_claims where id = (p->>'claim_id')::uuid for update;
  if not found then raise exception 'NUMERO: claim not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(c.company_id, 'payment.create') then
    raise exception 'NUMERO: you are not authorised to record reimbursements.' using errcode = '42501';
  end if;
  if c.status <> 'posted' or c.payable <= 0 then
    raise exception 'NUMERO: this claim is % and has nothing awaiting reimbursement.', c.status using errcode = 'P0001';
  end if;
  if v_date is null then raise exception 'NUMERO: the payment date is required.' using errcode = 'P0001'; end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> c.company_id or v_bank.control_type not in ('bank','cash') then
    raise exception 'NUMERO: choose the bank or cash ledger the reimbursement was paid from.' using errcode = 'P0001';
  end if;
  select display_name into v_name from public.parties where id = c.claimant_party_id;
  v_j := numero_private.propose_posting(c.company_id, 'payment', v_date,
    'Reimbursement of ' || c.claim_no || ' to ' || v_name, 'claim_payment', c.id,
    jsonb_build_array(
      jsonb_build_object('account_id', numero_private.map_account(c.company_id, 'employee_payable'),
                         'party_id', c.claimant_party_id, 'debit', c.payable, 'description', 'Reimbursement — ' || c.claim_no),
      jsonb_build_object('account_id', v_bank.id, 'credit', c.payable, 'description', coalesce(p->>'reference', c.claim_no))),
    jsonb_build_object('amount', c.payable, 'date', v_date, 'reference', p->>'reference'), c.confidentiality);
  return v_j;
end $$;

create or replace function numero_private.wf_claim_payment(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event = 'posted' then
    update public.expense_claims set status = 'paid', payment_journal_id = w.journal_id, paid_on = (w.payload->>'date')::date
     where id = w.source_id;
  elsif p_event = 'reversed' then
    update public.expense_claims set status = 'posted', payment_journal_id = null, paid_on = null where id = w.source_id;
  end if;
end $$;

-- >>> applied as migration 20260927073523 · p2_13_cash_and_fund_transfers
-- =====================================================================
-- 3. PETTY CASH BOXES & CASH COUNTS
-- =====================================================================
create table public.cash_boxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  ledger_account_id uuid not null references public.accounts(id),
  custodian_party_id uuid references public.parties(id),
  custodian_name text,
  org_unit_id uuid references public.org_units(id),
  float_amount numeric(20,4) not null default 0 check (float_amount >= 0),
  min_balance numeric(20,4) not null default 0 check (min_balance >= 0),
  max_single_payment numeric(20,4),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (company_id, name)
);

create table public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references public.cash_boxes(id),
  company_id uuid not null references public.companies(id),
  count_date date not null,
  denominations jsonb not null default '{}'::jsonb,
  counted_total numeric(20,4) not null check (counted_total >= 0),
  book_balance numeric(20,4) not null,
  difference numeric(20,4) not null,
  note text,
  witness_name text,
  counted_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index cash_counts_box_idx on public.cash_counts(box_id, count_date desc);

-- A cash count is a record of what was found. It is never edited and never removed.
create or replace function numero_private.guard_cash_count() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'NUMERO: a cash count is a record of what was found. It cannot be changed or removed; record a new count instead.' using errcode = 'P0001';
end $$;
create trigger cash_counts_append_only before update or delete on public.cash_counts
  for each row execute function numero_private.guard_cash_count();

create or replace function numero_private.save_cash_box(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; a public.accounts; v_gid uuid;
begin
  if not numero_private.can(v_company, 'treasury.manage') then
    raise exception 'NUMERO: you are not authorised to configure cash boxes.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: the cash box needs a name.' using errcode = 'P0001'; end if;
  select * into a from public.accounts where id = (p->>'ledger_account_id')::uuid;
  if not found or a.company_id <> v_company or a.control_type is distinct from 'cash' or a.is_group then
    raise exception 'NUMERO: choose a cash ledger of this company.' using errcode = 'P0001';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  if p->>'custodian_party_id' is not null and not exists (
       select 1 from public.parties x where x.id = (p->>'custodian_party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: unknown custodian.' using errcode = 'P0001';
  end if;
  if p->>'org_unit_id' is not null and not exists (
       select 1 from public.org_units u where u.id = (p->>'org_unit_id')::uuid and u.company_id = v_company) then
    raise exception 'NUMERO: the selected dimension belongs to another company.' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.cash_boxes(company_id, name, ledger_account_id, custodian_party_id, custodian_name, org_unit_id,
                                  float_amount, min_balance, max_single_payment)
    values (v_company, trim(p->>'name'), a.id, (p->>'custodian_party_id')::uuid, p->>'custodian_name', (p->>'org_unit_id')::uuid,
            coalesce((p->>'float_amount')::numeric, 0), coalesce((p->>'min_balance')::numeric, 0), (p->>'max_single_payment')::numeric)
    returning id into v_id;
  else
    update public.cash_boxes set name = trim(p->>'name'), ledger_account_id = a.id,
      custodian_party_id = (p->>'custodian_party_id')::uuid, custodian_name = p->>'custodian_name',
      org_unit_id = (p->>'org_unit_id')::uuid, float_amount = coalesce((p->>'float_amount')::numeric, 0),
      min_balance = coalesce((p->>'min_balance')::numeric, 0), max_single_payment = (p->>'max_single_payment')::numeric,
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id and company_id = v_company;
    if not found then raise exception 'NUMERO: cash box not found.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function numero_private.record_cash_count(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.cash_boxes; v_date date := (p->>'count_date')::date; v_counted numeric; v_book numeric; v_id uuid; v_diff numeric;
begin
  select * into b from public.cash_boxes where id = (p->>'box_id')::uuid;
  if not found then raise exception 'NUMERO: cash box not found.' using errcode = 'P0001'; end if;
  if not (numero_private.can(b.company_id, 'treasury.manage') or numero_private.can(b.company_id, 'expense.approve')) then
    raise exception 'NUMERO: you are not authorised to record a cash count.' using errcode = '42501';
  end if;
  if v_date is null or v_date > current_date then raise exception 'NUMERO: the count date is missing or in the future.' using errcode = 'P0001'; end if;
  if p->'denominations' is not null and jsonb_typeof(p->'denominations') = 'object' and p->'denominations' <> '{}'::jsonb then
    select coalesce(sum(key::numeric * value::numeric), 0) into v_counted from jsonb_each_text(p->'denominations');
  else
    v_counted := (p->>'counted_total')::numeric;
  end if;
  if v_counted is null or v_counted < 0 then raise exception 'NUMERO: enter the cash counted.' using errcode = 'P0001'; end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_book
    from public.journal_lines l join public.journals j on j.id = l.journal_id
   where l.company_id = b.company_id and l.account_id = b.ledger_account_id
     and j.status in ('posted','reversed') and j.journal_date <= v_date;
  v_diff := round(v_counted - v_book, 2);
  insert into public.cash_counts(box_id, company_id, count_date, denominations, counted_total, book_balance, difference, note, witness_name)
  values (b.id, b.company_id, v_date, coalesce(p->'denominations', '{}'::jsonb), round(v_counted, 2), round(v_book, 2), v_diff,
          p->>'note', p->>'witness_name')
  returning id into v_id;
  if v_diff <> 0 then
    insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
    values (b.company_id, 'cash_count_difference', case when abs(v_diff) >= 1000 then 'priority' else 'review' end,
      'CASH COUNT — counted cash differs from the books',
      'Cash box "' || b.name || '" was counted at ' || round(v_counted, 2) || ' on ' || v_date || '. The books show ' || round(v_book, 2)
        || '. Difference ' || v_diff || case when v_diff < 0 then ' (cash short).' else ' (cash over).' end
        || ' The books have not been changed; any adjustment needs an approved journal.',
      jsonb_build_object('cash_count_id', v_id, 'box_id', b.id, 'counted', round(v_counted, 2), 'book', round(v_book, 2), 'difference', v_diff,
                         'rule', 'counted cash ≠ ledger balance on the count date'),
      'cash_counts', v_id, 'cashcount:' || v_id::text)
    on conflict (company_id, dedupe_key) do nothing;
  end if;
  perform numero_private.log_event(b.company_id, 'cash_counts', v_id, 'cash_counted', null,
    jsonb_build_object('box', b.name, 'counted', round(v_counted, 2), 'book', round(v_book, 2), 'difference', v_diff), p->>'note');
  return jsonb_build_object('id', v_id, 'counted_total', round(v_counted, 2), 'book_balance', round(v_book, 2), 'difference', v_diff);
end $$;

-- =====================================================================
-- 4. FUND TRANSFERS (money moves between the company's own pockets)
-- =====================================================================
create table public.fund_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  transfer_no text not null,
  kind text not null default 'bank_transfer'
    check (kind in ('bank_transfer','cash_withdrawal','cash_deposit','petty_cash_topup','card_payment','intercompany','other')),
  from_ledger_id uuid not null references public.accounts(id),
  to_company_id uuid not null references public.companies(id),
  to_ledger_id uuid not null references public.accounts(id),
  amount numeric(20,4) not null check (amount > 0),
  transfer_date date not null,
  purpose text not null,
  reference text,
  status text not null default 'proposed' check (status in ('proposed','part_posted','posted','rejected','reversed')),
  journal_id uuid references public.journals(id),
  to_journal_id uuid references public.journals(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, transfer_no)
);
create index fund_transfers_company_idx on public.fund_transfers(company_id, transfer_date desc);
create index fund_transfers_to_idx on public.fund_transfers(to_company_id);

create or replace function numero_private.ic_account(p_company uuid, p_counterparty uuid, p_side text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select a.id into v from public.accounts a
   where a.company_id = p_company and a.control_type = 'intercompany' and a.counterparty_company_id = p_counterparty
     and a.type = case when p_side = 'receivable' then 'asset' else 'liability' end
     and not a.is_group and a.is_active
   order by a.code limit 1;
  if v is null then
    v := numero_private.map_account(p_company, 'intercompany_' || p_side);
  end if;
  return v;
end $$;

create or replace function numero_private.propose_fund_transfer(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_to_company uuid := coalesce((p->>'to_company_id')::uuid, (p->>'company_id')::uuid);
  f public.accounts; t public.accounts; v_amt numeric := round((p->>'amount')::numeric, 2); v_date date := (p->>'transfer_date')::date;
  v_id uuid; v_no text; v_j uuid; v_j2 uuid; v_kind text; v_from_name text; v_to_name text;
begin
  if not numero_private.can(v_company, 'payment.create') then
    raise exception 'NUMERO: you are not authorised to record fund transfers.' using errcode = '42501';
  end if;
  if v_to_company <> v_company then
    if not numero_private.can(v_to_company, 'payment.create') then
      raise exception 'NUMERO: you are not authorised to record receipts in the receiving company.' using errcode = '42501';
    end if;
    if numero_private.company_group(v_to_company) <> numero_private.company_group(v_company) then
      raise exception 'NUMERO: the two companies belong to different groups.' using errcode = '42501';
    end if;
  end if;
  if v_amt is null or v_amt <= 0 then raise exception 'NUMERO: the amount must be greater than zero.' using errcode = 'P0001'; end if;
  if v_date is null then raise exception 'NUMERO: the transfer date is required.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'purpose'), '') = '' then raise exception 'NUMERO: the purpose of the transfer is required.' using errcode = 'P0001'; end if;
  select * into f from public.accounts where id = (p->>'from_ledger_id')::uuid;
  select * into t from public.accounts where id = (p->>'to_ledger_id')::uuid;
  if f.id is null or f.company_id <> v_company or f.control_type is null or f.control_type not in ('bank','cash') or f.is_group then
    raise exception 'NUMERO: choose the bank or cash ledger the money leaves from.' using errcode = 'P0001';
  end if;
  if t.id is null or t.company_id <> v_to_company or t.control_type is null or t.control_type not in ('bank','cash') or t.is_group then
    raise exception 'NUMERO: choose the bank or cash ledger the money arrives in.' using errcode = 'P0001';
  end if;
  if f.id = t.id then raise exception 'NUMERO: the source and the destination are the same ledger.' using errcode = 'P0001'; end if;
  v_kind := case when v_to_company <> v_company then 'intercompany' else coalesce(p->>'kind',
              case when f.control_type = 'bank' and t.control_type = 'cash' then 'cash_withdrawal'
                   when f.control_type = 'cash' and t.control_type = 'bank' then 'cash_deposit' else 'bank_transfer' end) end;

  v_no := numero_private.next_doc_no(v_company, 'fund_transfer', 'FT', v_date);
  insert into public.fund_transfers(company_id, transfer_no, kind, from_ledger_id, to_company_id, to_ledger_id, amount,
                                    transfer_date, purpose, reference, created_by)
  values (v_company, v_no, v_kind, f.id, v_to_company, t.id, v_amt, v_date, trim(p->>'purpose'), p->>'reference', (select auth.uid()))
  returning id into v_id;

  if v_to_company = v_company then
    v_j := numero_private.propose_posting(v_company, 'contra', v_date,
      'Transfer ' || v_no || ' · ' || f.name || ' → ' || t.name || ' — ' || trim(p->>'purpose'), 'fund_transfer', v_id,
      jsonb_build_array(
        jsonb_build_object('account_id', t.id, 'debit', v_amt, 'description', coalesce(p->>'reference', v_no)),
        jsonb_build_object('account_id', f.id, 'credit', v_amt, 'description', coalesce(p->>'reference', v_no))),
      jsonb_build_object('amount', v_amt, 'side', 'both'));
  else
    select name into v_from_name from public.companies where id = v_company;
    select name into v_to_name from public.companies where id = v_to_company;
    v_j := numero_private.propose_posting(v_company, 'intercompany', v_date,
      'Transfer ' || v_no || ' to ' || v_to_name || ' — ' || trim(p->>'purpose'), 'fund_transfer', v_id,
      jsonb_build_array(
        jsonb_build_object('account_id', numero_private.ic_account(v_company, v_to_company, 'receivable'), 'debit', v_amt,
                           'description', 'Due from ' || v_to_name),
        jsonb_build_object('account_id', f.id, 'credit', v_amt, 'description', coalesce(p->>'reference', v_no))),
      jsonb_build_object('amount', v_amt, 'side', 'out'));
    v_j2 := numero_private.propose_posting(v_to_company, 'intercompany', v_date,
      'Transfer ' || v_no || ' from ' || v_from_name || ' — ' || trim(p->>'purpose'), 'fund_transfer_in', v_id,
      jsonb_build_array(
        jsonb_build_object('account_id', t.id, 'debit', v_amt, 'description', coalesce(p->>'reference', v_no)),
        jsonb_build_object('account_id', numero_private.ic_account(v_to_company, v_company, 'payable'), 'credit', v_amt,
                           'description', 'Due to ' || v_from_name)),
      jsonb_build_object('amount', v_amt, 'side', 'in'));
  end if;
  update public.fund_transfers set journal_id = v_j, to_journal_id = v_j2 where id = v_id;
  return v_id;
end $$;

create or replace function numero_private.refresh_transfer_status(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_states text[];
begin
  select array_agg(w.status) into v_states from public.workflow_postings w
   where w.source in ('fund_transfer','fund_transfer_in') and w.source_id = p_id;
  update public.fund_transfers set status = case
      when 'reversed' = any(v_states) then 'reversed'
      when 'voided' = any(v_states) then 'rejected'
      when 'pending' = any(v_states) and 'posted' = any(v_states) then 'part_posted'
      when 'pending' = any(v_states) then 'proposed'
      else 'posted' end
   where id = p_id;
end $$;

create or replace function numero_private.wf_fund_transfer(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.fund_transfers; v_other text;
begin
  select * into t from public.fund_transfers where id = w.source_id for update;
  -- wf_dispatch updates the posting row after this handler returns, so the new state is applied here first
  update public.workflow_postings set status = p_event where id = w.id;
  perform numero_private.refresh_transfer_status(t.id);
  if t.to_company_id <> t.company_id and p_event in ('voided','reversed') then
    select x.status into v_other from public.workflow_postings x
     where x.source in ('fund_transfer','fund_transfer_in') and x.source_id = t.id and x.id <> w.id;
    if v_other in ('pending','posted') then
      insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
      values (w.company_id, 'intercompany_one_sided', 'priority', 'INTERCOMPANY — one side of a transfer was ' || p_event,
        'Transfer ' || t.transfer_no || ' of ' || t.amount || ' has two entries, one in each company. This entry was ' || p_event
          || ' while the entry in the other company is ' || v_other || '. Until both agree, intercompany balances will not match.',
        jsonb_build_object('transfer_id', t.id, 'this_journal', w.journal_id, 'other_state', v_other, 'rule', 'both legs of an intercompany transfer must share the same outcome'),
        'fund_transfers', t.id, 'ictransfer:' || w.id::text || ':' || p_event)
      on conflict (company_id, dedupe_key) do nothing;
    end if;
  end if;
end $$;

create or replace function numero_private.wf_fund_transfer_in(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform numero_private.wf_fund_transfer(w, p_event);
end $$;

-- >>> applied as migration 20260927073601 · p2_14_promises_flow_privileges
-- =====================================================================
-- 5. PROMISE-TO-PAY (collections)
-- =====================================================================
create table public.collection_promises (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  party_id uuid not null references public.parties(id),
  invoice_id uuid references public.invoices(id),
  promised_amount numeric(20,4) not null check (promised_amount > 0),
  promised_date date not null,
  contact_person text,
  channel text,
  notes text,
  status text not null default 'open' check (status in ('open','kept','partly_kept','broken','cancelled')),
  outcome_note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  closed_by uuid, closed_at timestamptz
);
create index collection_promises_idx on public.collection_promises(company_id, status, promised_date);

create or replace function numero_private.save_promise(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; inv public.invoices; v_gid uuid; pr public.collection_promises;
begin
  if not numero_private.can(v_company, 'invoice.create') then
    raise exception 'NUMERO: you are not authorised to record collection follow-ups.' using errcode = '42501';
  end if;
  if v_id is not null then
    select * into pr from public.collection_promises where id = v_id and company_id = v_company for update;
    if not found then raise exception 'NUMERO: promise not found.' using errcode = 'P0001'; end if;
    if pr.status <> 'open' then raise exception 'NUMERO: this promise is already %.', pr.status using errcode = 'P0001'; end if;
    if p->>'status' is null or p->>'status' not in ('kept','partly_kept','broken','cancelled') then
      raise exception 'NUMERO: record whether the promise was kept, partly kept, broken or cancelled.' using errcode = 'P0001';
    end if;
    update public.collection_promises set status = p->>'status', outcome_note = p->>'outcome_note',
           closed_by = (select auth.uid()), closed_at = now() where id = v_id;
    return v_id;
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  if not exists (select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: choose the customer.' using errcode = 'P0001';
  end if;
  if p->>'invoice_id' is not null then
    select * into inv from public.invoices where id = (p->>'invoice_id')::uuid;
    if not found or inv.company_id <> v_company or inv.party_id <> (p->>'party_id')::uuid then
      raise exception 'NUMERO: the invoice belongs to another customer or company.' using errcode = 'P0001';
    end if;
  end if;
  if coalesce((p->>'promised_amount')::numeric, 0) <= 0 or (p->>'promised_date') is null then
    raise exception 'NUMERO: the promised amount and date are required.' using errcode = 'P0001';
  end if;
  insert into public.collection_promises(company_id, party_id, invoice_id, promised_amount, promised_date, contact_person, channel, notes)
  values (v_company, (p->>'party_id')::uuid, (p->>'invoice_id')::uuid, round((p->>'promised_amount')::numeric, 2),
          (p->>'promised_date')::date, p->>'contact_person', p->>'channel', p->>'notes')
  returning id into v_id;
  return v_id;
end $$;

-- ---------- public wrappers ----------
create or replace function public.save_expense_category(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_expense_category(p); $$;
create or replace function public.save_advance(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_advance(p); $$;
create or replace function public.submit_advance(p_id uuid) returns void language sql set search_path = '' as $$ select numero_private.submit_advance(p_id); $$;
create or replace function public.approve_advance(p_id uuid, p_amount numeric default null, p_comment text default null) returns text language sql set search_path = '' as $$ select numero_private.approve_advance(p_id, p_amount, p_comment); $$;
create or replace function public.reject_advance(p_id uuid, p_comment text) returns void language sql set search_path = '' as $$ select numero_private.reject_advance(p_id, p_comment); $$;
create or replace function public.release_advance(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.release_advance(p); $$;
create or replace function public.return_advance(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.return_advance(p); $$;
create or replace function public.flag_advance(p_id uuid, p_flag text, p_note text) returns void language sql set search_path = '' as $$ select numero_private.flag_advance(p_id, p_flag, p_note); $$;
create or replace function public.save_claim(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_claim(p); $$;
create or replace function public.submit_claim(p_id uuid) returns void language sql set search_path = '' as $$ select numero_private.submit_claim(p_id); $$;
create or replace function public.approve_claim(p_id uuid, p_comment text default null, p_lines jsonb default null) returns text language sql set search_path = '' as $$ select numero_private.approve_claim(p_id, p_comment, p_lines); $$;
create or replace function public.reject_claim(p_id uuid, p_comment text) returns void language sql set search_path = '' as $$ select numero_private.reject_claim(p_id, p_comment); $$;
create or replace function public.cancel_claim(p_id uuid, p_reason text) returns void language sql set search_path = '' as $$ select numero_private.cancel_claim(p_id, p_reason); $$;
create or replace function public.pay_claim(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.pay_claim(p); $$;
create or replace function public.save_cash_box(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_cash_box(p); $$;
create or replace function public.record_cash_count(p jsonb) returns jsonb language sql set search_path = '' as $$ select numero_private.record_cash_count(p); $$;
create or replace function public.propose_fund_transfer(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.propose_fund_transfer(p); $$;
create or replace function public.save_promise(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_promise(p); $$;

-- ---------- audit ----------
create trigger audit_expense_categories after insert or update or delete on public.expense_categories for each row execute function numero_private.audit_row();
create trigger audit_advances after insert or update or delete on public.advances for each row execute function numero_private.audit_row();
create trigger audit_expense_claims after insert or update or delete on public.expense_claims for each row execute function numero_private.audit_row();
create trigger audit_cash_boxes after insert or update or delete on public.cash_boxes for each row execute function numero_private.audit_row();
create trigger audit_fund_transfers after insert or update or delete on public.fund_transfers for each row execute function numero_private.audit_row();
create trigger audit_collection_promises after insert or update or delete on public.collection_promises for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.expense_categories enable row level security;
alter table public.advances enable row level security;
alter table public.expense_claims enable row level security;
alter table public.expense_claim_lines enable row level security;
alter table public.cash_boxes enable row level security;
alter table public.cash_counts enable row level security;
alter table public.fund_transfers enable row level security;
alter table public.collection_promises enable row level security;

create policy expense_categories_select on public.expense_categories for select to authenticated
  using ((select numero_private.has_company_access(company_id)));
-- a person sees their own requests; reviewers see the company's
create policy advances_select on public.advances for select to authenticated
  using (((select numero_private.can(company_id, 'expense.view')) or (select numero_private.can(company_id, 'expense.approve'))
          or created_by = (select auth.uid()))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy expense_claims_select on public.expense_claims for select to authenticated
  using (((select numero_private.can(company_id, 'expense.view')) or (select numero_private.can(company_id, 'expense.approve'))
          or created_by = (select auth.uid()))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy expense_claim_lines_select on public.expense_claim_lines for select to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id));
create policy cash_boxes_select on public.cash_boxes for select to authenticated
  using ((select numero_private.can(company_id, 'treasury.view')) or (select numero_private.can(company_id, 'expense.approve')));
create policy cash_counts_select on public.cash_counts for select to authenticated
  using (exists (select 1 from public.cash_boxes b where b.id = box_id));
create policy fund_transfers_select on public.fund_transfers for select to authenticated
  using ((select numero_private.can(company_id, 'treasury.view')) or (select numero_private.can(to_company_id, 'treasury.view')));
create policy collection_promises_select on public.collection_promises for select to authenticated
  using ((select numero_private.can(company_id, 'invoice.view')));

insert into numero_private.internal_functions(name) values
  ('refresh_advance_status'), ('propose_claim_posting'), ('refresh_transfer_status'), ('ic_account')
on conflict do nothing;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();
