-- >>> applied as migration 20260927073711 · p2_15_loans
-- =====================================================================
-- GHL NUMERO · 0009 · TREASURY (LOANS, FIXED DEPOSITS) AND PAYROLL
-- Spec: 22, 32-33, 452-453, 543-550, 552-555, 682, 1197-1205, 1227-1228
--
-- Salary data is highly restricted: every payroll table requires the
-- payroll.view permission, and executive records can carry a higher
-- confidentiality level. Payroll journals are aggregated by department —
-- no individual salary ever appears in the general ledger.
-- Statutory amounts are configured by the company; NUMERO does not decide
-- what is legally due. Professional review remains required.
-- =====================================================================

-- =====================================================================
-- 1. LOANS
-- =====================================================================
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  loan_no text not null,
  name text not null,
  direction text not null default 'borrowed' check (direction in ('borrowed','lent')),
  kind text not null default 'term_loan'
    check (kind in ('term_loan','working_capital','vehicle_loan','equipment_loan','director_loan','shareholder_loan',
                    'employee_loan','intercompany_loan','other')),
  party_id uuid not null references public.parties(id),
  principal numeric(20,4) not null check (principal > 0),
  currency text not null references public.currencies(code),
  rate_pct numeric(9,4) not null default 0 check (rate_pct >= 0),
  rate_type text not null default 'fixed' check (rate_type in ('fixed','floating')),
  rate_reset_date date,
  start_date date not null,
  first_due_date date not null,
  tenure_months int not null check (tenure_months > 0 and tenure_months <= 600),
  repayment text not null default 'emi' check (repayment in ('emi','equal_principal','bullet')),
  loan_account_id uuid not null references public.accounts(id),
  interest_account_id uuid not null references public.accounts(id),
  disbursed_amount numeric(20,4) not null default 0,
  principal_repaid numeric(20,4) not null default 0,
  interest_paid numeric(20,4) not null default 0,
  sanction_ref text,
  security text,
  covenants text,
  status text not null default 'draft' check (status in ('draft','active','closed','cancelled')),
  confidentiality text not null default 'internal',
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, loan_no)
);
create index loans_company_idx on public.loans(company_id, status);

create table public.loan_schedule (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id),
  company_id uuid not null references public.companies(id),
  instalment_no int not null,
  due_date date not null,
  opening_principal numeric(20,4) not null,
  principal numeric(20,4) not null,
  interest numeric(20,4) not null,
  total numeric(20,4) not null,
  closing_principal numeric(20,4) not null,
  status text not null default 'due' check (status in ('due','proposed','paid')),
  journal_id uuid references public.journals(id),
  paid_on date,
  unique (loan_id, instalment_no)
);
create index loan_schedule_due_idx on public.loan_schedule(company_id, due_date, status);

create or replace function numero_private.build_loan_schedule(p_loan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.loans; r numeric; n int; bal numeric; emi numeric; i int; v_int numeric; v_pri numeric;
begin
  select * into l from public.loans where id = p_loan;
  delete from public.loan_schedule where loan_id = p_loan;
  r := l.rate_pct / 1200; n := l.tenure_months; bal := l.principal;
  if l.repayment = 'emi' then
    emi := case when r = 0 then round(l.principal / n, 2)
                else round(l.principal * r * power(1 + r, n) / (power(1 + r, n) - 1), 2) end;
  end if;
  for i in 1..n loop
    v_int := round(bal * r, 2);
    v_pri := case l.repayment
               when 'emi' then case when i = n then bal else least(emi - v_int, bal) end
               when 'equal_principal' then case when i = n then bal else round(l.principal / n, 2) end
               else case when i = n then bal else 0 end end;
    insert into public.loan_schedule(loan_id, company_id, instalment_no, due_date, opening_principal, principal, interest, total, closing_principal)
    values (p_loan, l.company_id, i, (l.first_due_date + make_interval(months => i - 1))::date, bal, v_pri, v_int, v_pri + v_int, bal - v_pri);
    bal := bal - v_pri;
  end loop;
end $$;

create or replace function numero_private.save_loan(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_gid uuid; l public.loans;
        la public.accounts; ia public.accounts; v_dir text := coalesce(p->>'direction', 'borrowed'); v_locked boolean;
begin
  if not numero_private.can(v_company, 'treasury.manage') then
    raise exception 'NUMERO: you are not authorised to maintain loans.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NUMERO: the loan needs a name.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: choose the lender or borrower.' using errcode = 'P0001';
  end if;
  select * into la from public.accounts where id = (p->>'loan_account_id')::uuid;
  select * into ia from public.accounts where id = (p->>'interest_account_id')::uuid;
  if la.id is null or la.company_id <> v_company or la.is_group or ia.id is null or ia.company_id <> v_company or ia.is_group then
    raise exception 'NUMERO: choose posting accounts of this company for the loan and its interest.' using errcode = 'P0001';
  end if;
  if (v_dir = 'borrowed' and la.type <> 'liability') or (v_dir = 'lent' and la.type <> 'asset') then
    raise exception 'NUMERO: a loan taken sits in a liability ledger; a loan given sits in an asset ledger.' using errcode = 'P0001';
  end if;
  if (p->>'start_date') is null or (p->>'first_due_date') is null or (p->>'first_due_date')::date < (p->>'start_date')::date then
    raise exception 'NUMERO: the start date and first due date are required, and the first instalment cannot fall before the start.' using errcode = 'P0001';
  end if;
  if coalesce((p->>'principal')::numeric, 0) <= 0 or coalesce((p->>'tenure_months')::int, 0) <= 0 then
    raise exception 'NUMERO: the principal and the tenure must be greater than zero.' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.loans(company_id, loan_no, name, direction, kind, party_id, principal, currency, rate_pct, rate_type, rate_reset_date,
      start_date, first_due_date, tenure_months, repayment, loan_account_id, interest_account_id, sanction_ref, security, covenants,
      confidentiality, notes, created_by)
    values (v_company, numero_private.next_doc_no(v_company, 'loan', 'LN', (p->>'start_date')::date), trim(p->>'name'), v_dir,
      coalesce(p->>'kind', 'term_loan'), (p->>'party_id')::uuid, round((p->>'principal')::numeric, 2),
      coalesce(p->>'currency', (select base_currency from public.companies where id = v_company)),
      coalesce((p->>'rate_pct')::numeric, 0), coalesce(p->>'rate_type', 'fixed'), (p->>'rate_reset_date')::date,
      (p->>'start_date')::date, (p->>'first_due_date')::date, (p->>'tenure_months')::int, coalesce(p->>'repayment', 'emi'),
      la.id, ia.id, p->>'sanction_ref', p->>'security', p->>'covenants', coalesce(p->>'confidentiality', 'internal'), p->>'notes',
      (select auth.uid()))
    returning id into v_id;
    perform numero_private.build_loan_schedule(v_id);
    return v_id;
  end if;

  select * into l from public.loans where id = v_id and company_id = v_company for update;
  if not found then raise exception 'NUMERO: loan not found.' using errcode = 'P0001'; end if;
  if l.status in ('closed','cancelled') then raise exception 'NUMERO: this loan is %.', l.status using errcode = 'P0001'; end if;
  v_locked := l.disbursed_amount > 0 or exists (select 1 from public.loan_schedule s where s.loan_id = v_id and s.status <> 'due')
              or exists (select 1 from public.workflow_postings w where w.source = 'loan_disbursement' and w.source_id = v_id and w.status = 'pending');
  if v_locked and (round((p->>'principal')::numeric, 2) <> l.principal or coalesce((p->>'rate_pct')::numeric, 0) <> l.rate_pct
       or (p->>'tenure_months')::int <> l.tenure_months or (p->>'first_due_date')::date <> l.first_due_date
       or coalesce(p->>'repayment', 'emi') <> l.repayment or v_dir <> l.direction or la.id <> l.loan_account_id) then
    raise exception 'NUMERO: money has already moved on this loan. Its amount, rate, tenure and accounts can no longer be changed here.' using errcode = 'P0001';
  end if;
  update public.loans set name = trim(p->>'name'), kind = coalesce(p->>'kind', kind), party_id = (p->>'party_id')::uuid,
    principal = round((p->>'principal')::numeric, 2), rate_pct = coalesce((p->>'rate_pct')::numeric, 0),
    rate_type = coalesce(p->>'rate_type', rate_type), rate_reset_date = (p->>'rate_reset_date')::date,
    start_date = (p->>'start_date')::date, first_due_date = (p->>'first_due_date')::date,
    tenure_months = (p->>'tenure_months')::int, repayment = coalesce(p->>'repayment', 'emi'), direction = v_dir,
    loan_account_id = la.id, interest_account_id = ia.id, sanction_ref = p->>'sanction_ref', security = p->>'security',
    covenants = p->>'covenants', confidentiality = coalesce(p->>'confidentiality', confidentiality), notes = p->>'notes'
  where id = v_id;
  if not v_locked then perform numero_private.build_loan_schedule(v_id); end if;
  return v_id;
end $$;

create or replace function numero_private.disburse_loan(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.loans; v_bank public.accounts; v_amt numeric := round((p->>'amount')::numeric, 2); v_date date := (p->>'date')::date;
        v_name text; v_lines jsonb;
begin
  select * into l from public.loans where id = (p->>'loan_id')::uuid for update;
  if not found then raise exception 'NUMERO: loan not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(l.company_id, 'treasury.manage') then
    raise exception 'NUMERO: you are not authorised to record loan movements.' using errcode = '42501';
  end if;
  if l.status not in ('draft','active') then raise exception 'NUMERO: this loan is %.', l.status using errcode = 'P0001'; end if;
  if v_date is null then raise exception 'NUMERO: the date is required.' using errcode = 'P0001'; end if;
  if v_amt is null or v_amt <= 0 or v_amt > l.principal - l.disbursed_amount then
    raise exception 'NUMERO: the amount must be greater than zero and cannot exceed the undisbursed %.', l.principal - l.disbursed_amount using errcode = 'P0001';
  end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> l.company_id or v_bank.control_type not in ('bank','cash') then
    raise exception 'NUMERO: choose a bank or cash ledger of this company.' using errcode = 'P0001';
  end if;
  select display_name into v_name from public.parties where id = l.party_id;
  if l.direction = 'borrowed' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_bank.id, 'debit', v_amt, 'description', 'Loan received — ' || l.loan_no),
      jsonb_build_object('account_id', l.loan_account_id, 'party_id', l.party_id, 'credit', v_amt, 'description', 'Principal owed to ' || v_name));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', l.loan_account_id, 'party_id', l.party_id, 'debit', v_amt, 'description', 'Principal due from ' || v_name),
      jsonb_build_object('account_id', v_bank.id, 'credit', v_amt, 'description', 'Loan given — ' || l.loan_no));
  end if;
  return numero_private.propose_posting(l.company_id, case when l.direction = 'borrowed' then 'receipt' else 'payment' end, v_date,
    'Loan ' || l.loan_no || ' · ' || l.name || ' — disbursement', 'loan_disbursement', l.id, v_lines,
    jsonb_build_object('amount', v_amt, 'date', v_date), l.confidentiality);
end $$;

create or replace function numero_private.wf_loan_disbursement(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_amt numeric := (w.payload->>'amount')::numeric; l public.loans;
begin
  select * into l from public.loans where id = w.source_id for update;
  if p_event = 'posted' then
    update public.loans set disbursed_amount = disbursed_amount + v_amt, status = 'active' where id = l.id;
  elsif p_event = 'reversed' then
    if l.principal_repaid > l.disbursed_amount - v_amt then
      raise exception 'NUMERO: repayments have been recorded against this disbursement. Reverse those first.' using errcode = 'P0001';
    end if;
    update public.loans set disbursed_amount = disbursed_amount - v_amt,
           status = case when disbursed_amount - v_amt <= 0 then 'draft' else status end where id = l.id;
  end if;
end $$;

create or replace function numero_private.pay_loan_instalment(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.loan_schedule; l public.loans; v_bank public.accounts; v_date date := (p->>'date')::date; v_name text;
        v_int numeric; v_lines jsonb := '[]'::jsonb; v_j uuid;
begin
  select * into s from public.loan_schedule where id = (p->>'schedule_id')::uuid for update;
  if not found then raise exception 'NUMERO: instalment not found.' using errcode = 'P0001'; end if;
  select * into l from public.loans where id = s.loan_id for update;
  if not numero_private.can(l.company_id, 'treasury.manage') then
    raise exception 'NUMERO: you are not authorised to record loan movements.' using errcode = '42501';
  end if;
  if l.status <> 'active' then raise exception 'NUMERO: this loan is % — record its disbursement first.', l.status using errcode = 'P0001'; end if;
  if s.status <> 'due' then raise exception 'NUMERO: this instalment is already %.', s.status using errcode = 'P0001'; end if;
  if exists (select 1 from public.loan_schedule x where x.loan_id = l.id and x.instalment_no < s.instalment_no and x.status = 'due') then
    raise exception 'NUMERO: an earlier instalment is still unpaid. Instalments are recorded in order.' using errcode = 'P0001';
  end if;
  if v_date is null then raise exception 'NUMERO: the payment date is required.' using errcode = 'P0001'; end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> l.company_id or v_bank.control_type not in ('bank','cash') then
    raise exception 'NUMERO: choose a bank or cash ledger of this company.' using errcode = 'P0001';
  end if;
  -- the lender's statement is the authority for interest: the scheduled figure can be replaced by the charged figure
  v_int := round(coalesce((p->>'interest')::numeric, s.interest), 2);
  if v_int < 0 then raise exception 'NUMERO: interest cannot be negative.' using errcode = 'P0001'; end if;
  if s.principal + v_int <= 0 then raise exception 'NUMERO: this instalment has no amount.' using errcode = 'P0001'; end if;
  select display_name into v_name from public.parties where id = l.party_id;

  if l.direction = 'borrowed' then
    if s.principal > 0 then v_lines := v_lines || jsonb_build_object('account_id', l.loan_account_id, 'party_id', l.party_id, 'debit', s.principal, 'description', 'Principal — instalment ' || s.instalment_no); end if;
    if v_int > 0 then v_lines := v_lines || jsonb_build_object('account_id', l.interest_account_id, 'debit', v_int, 'description', 'Interest — instalment ' || s.instalment_no); end if;
    v_lines := v_lines || jsonb_build_object('account_id', v_bank.id, 'credit', s.principal + v_int, 'description', coalesce(p->>'reference', l.loan_no));
  else
    v_lines := v_lines || jsonb_build_object('account_id', v_bank.id, 'debit', s.principal + v_int, 'description', coalesce(p->>'reference', l.loan_no));
    if s.principal > 0 then v_lines := v_lines || jsonb_build_object('account_id', l.loan_account_id, 'party_id', l.party_id, 'credit', s.principal, 'description', 'Principal — instalment ' || s.instalment_no); end if;
    if v_int > 0 then v_lines := v_lines || jsonb_build_object('account_id', l.interest_account_id, 'credit', v_int, 'description', 'Interest — instalment ' || s.instalment_no); end if;
  end if;
  v_j := numero_private.propose_posting(l.company_id, case when l.direction = 'borrowed' then 'payment' else 'receipt' end, v_date,
    'Loan ' || l.loan_no || ' · instalment ' || s.instalment_no || ' of ' || l.tenure_months || ' · ' || v_name,
    'loan_instalment', s.id, v_lines,
    jsonb_build_object('loan_id', l.id, 'principal', s.principal, 'interest', v_int, 'scheduled_interest', s.interest, 'date', v_date),
    l.confidentiality);
  update public.loan_schedule set status = 'proposed', journal_id = v_j where id = s.id;
  return v_j;
end $$;

create or replace function numero_private.wf_loan_instalment(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_loan uuid := (w.payload->>'loan_id')::uuid; v_pri numeric := (w.payload->>'principal')::numeric; v_int numeric := (w.payload->>'interest')::numeric;
begin
  if p_event = 'posted' then
    update public.loan_schedule set status = 'paid', paid_on = (w.payload->>'date')::date where id = w.source_id;
    update public.loans set principal_repaid = principal_repaid + v_pri, interest_paid = interest_paid + v_int where id = v_loan;
    update public.loans set status = 'closed'
     where id = v_loan and not exists (select 1 from public.loan_schedule s where s.loan_id = v_loan and s.status <> 'paid');
  elsif p_event = 'voided' then
    update public.loan_schedule set status = 'due', journal_id = null where id = w.source_id;
  elsif p_event = 'reversed' then
    if exists (select 1 from public.loan_schedule s join public.loan_schedule me on me.id = w.source_id
                where s.loan_id = me.loan_id and s.instalment_no > me.instalment_no and s.status <> 'due') then
      raise exception 'NUMERO: later instalments have been recorded. Reverse the most recent instalment first.' using errcode = 'P0001';
    end if;
    update public.loan_schedule set status = 'due', journal_id = null, paid_on = null where id = w.source_id;
    update public.loans set principal_repaid = greatest(principal_repaid - v_pri, 0), interest_paid = greatest(interest_paid - v_int, 0),
           status = 'active' where id = v_loan;
  end if;
end $$;

-- >>> applied as migration 20260927073801 · p2_16_fixed_deposits
-- =====================================================================
-- 2. FIXED DEPOSITS
-- =====================================================================
create table public.fixed_deposits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  fd_no text not null,
  bank_party_id uuid references public.parties(id),
  bank_name text not null,
  reference text,
  principal numeric(20,4) not null check (principal > 0),
  currency text not null references public.currencies(code),
  rate_pct numeric(9,4) not null default 0 check (rate_pct >= 0),
  compounding text not null default 'quarterly' check (compounding in ('simple','monthly','quarterly','half_yearly','yearly')),
  start_date date not null,
  maturity_date date not null,
  maturity_amount numeric(20,4) not null,
  fd_account_id uuid not null references public.accounts(id),
  interest_account_id uuid not null references public.accounts(id),
  lien_marked boolean not null default false,
  lien_note text,
  auto_renew boolean not null default false,
  status text not null default 'draft' check (status in ('draft','active','closed','cancelled')),
  placement_journal_id uuid references public.journals(id),
  closure_journal_id uuid references public.journals(id),
  closed_on date,
  proceeds numeric(20,4),
  tax_deducted numeric(20,4),
  confidentiality text not null default 'internal',
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, fd_no),
  check (maturity_date > start_date)
);
create index fixed_deposits_company_idx on public.fixed_deposits(company_id, status, maturity_date);

create or replace function numero_private.save_fixed_deposit(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; fa public.accounts; ia public.accounts; d public.fixed_deposits;
        v_p numeric := round((p->>'principal')::numeric, 2); v_r numeric := coalesce((p->>'rate_pct')::numeric, 0);
        v_s date := (p->>'start_date')::date; v_m date := (p->>'maturity_date')::date; v_comp text := coalesce(p->>'compounding', 'quarterly');
        v_years numeric; v_n numeric; v_mat numeric;
begin
  if not numero_private.can(v_company, 'treasury.manage') then
    raise exception 'NUMERO: you are not authorised to maintain fixed deposits.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'bank_name'), '') = '' then raise exception 'NUMERO: the bank is required.' using errcode = 'P0001'; end if;
  if v_p is null or v_p <= 0 then raise exception 'NUMERO: the principal must be greater than zero.' using errcode = 'P0001'; end if;
  if v_s is null or v_m is null or v_m <= v_s then raise exception 'NUMERO: the maturity date must be after the start date.' using errcode = 'P0001'; end if;
  select * into fa from public.accounts where id = (p->>'fd_account_id')::uuid;
  select * into ia from public.accounts where id = (p->>'interest_account_id')::uuid;
  if fa.id is null or fa.company_id <> v_company or fa.is_group or fa.type <> 'asset'
     or ia.id is null or ia.company_id <> v_company or ia.is_group then
    raise exception 'NUMERO: choose an asset ledger for the deposit and a posting ledger for its interest.' using errcode = 'P0001';
  end if;
  v_years := (v_m - v_s)::numeric / 365;
  v_n := case v_comp when 'monthly' then 12 when 'quarterly' then 4 when 'half_yearly' then 2 when 'yearly' then 1 else 0 end;
  v_mat := round(coalesce((p->>'maturity_amount')::numeric,
             case when v_n = 0 then v_p * (1 + v_r / 100 * v_years)
                  else v_p * power(1 + v_r / 100 / v_n, v_n * v_years) end), 2);

  if v_id is null then
    insert into public.fixed_deposits(company_id, fd_no, bank_party_id, bank_name, reference, principal, currency, rate_pct, compounding,
      start_date, maturity_date, maturity_amount, fd_account_id, interest_account_id, lien_marked, lien_note, auto_renew,
      confidentiality, notes, created_by)
    values (v_company, numero_private.next_doc_no(v_company, 'fixed_deposit', 'FD', v_s), (p->>'bank_party_id')::uuid, trim(p->>'bank_name'),
      p->>'reference', v_p, coalesce(p->>'currency', (select base_currency from public.companies where id = v_company)),
      v_r, v_comp, v_s, v_m, v_mat, fa.id, ia.id, coalesce((p->>'lien_marked')::boolean, false), p->>'lien_note',
      coalesce((p->>'auto_renew')::boolean, false), coalesce(p->>'confidentiality', 'internal'), p->>'notes', (select auth.uid()))
    returning id into v_id;
    return v_id;
  end if;
  select * into d from public.fixed_deposits where id = v_id and company_id = v_company for update;
  if not found then raise exception 'NUMERO: deposit not found.' using errcode = 'P0001'; end if;
  if d.status in ('closed','cancelled') then raise exception 'NUMERO: this deposit is %.', d.status using errcode = 'P0001'; end if;
  if d.status = 'active' and (v_p <> d.principal or fa.id <> d.fd_account_id or v_s <> d.start_date) then
    raise exception 'NUMERO: this deposit has been placed. Its principal, start date and ledger can no longer be changed.' using errcode = 'P0001';
  end if;
  update public.fixed_deposits set bank_party_id = (p->>'bank_party_id')::uuid, bank_name = trim(p->>'bank_name'), reference = p->>'reference',
    principal = v_p, rate_pct = v_r, compounding = v_comp, start_date = v_s, maturity_date = v_m, maturity_amount = v_mat,
    fd_account_id = fa.id, interest_account_id = ia.id, lien_marked = coalesce((p->>'lien_marked')::boolean, false),
    lien_note = p->>'lien_note', auto_renew = coalesce((p->>'auto_renew')::boolean, false),
    confidentiality = coalesce(p->>'confidentiality', confidentiality), notes = p->>'notes'
  where id = v_id;
  return v_id;
end $$;

create or replace function numero_private.place_fixed_deposit(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.fixed_deposits; v_bank public.accounts; v_date date := (p->>'date')::date;
begin
  select * into d from public.fixed_deposits where id = (p->>'fd_id')::uuid for update;
  if not found then raise exception 'NUMERO: deposit not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'treasury.manage') then
    raise exception 'NUMERO: you are not authorised to record deposit movements.' using errcode = '42501';
  end if;
  if d.status <> 'draft' then raise exception 'NUMERO: this deposit is already %.', d.status using errcode = 'P0001'; end if;
  v_date := coalesce(v_date, d.start_date);
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> d.company_id or v_bank.control_type is distinct from 'bank' then
    raise exception 'NUMERO: choose the bank ledger the deposit was funded from.' using errcode = 'P0001';
  end if;
  return numero_private.propose_posting(d.company_id, 'contra', v_date,
    'Fixed deposit ' || d.fd_no || ' placed with ' || d.bank_name, 'fd_placement', d.id,
    jsonb_build_array(
      jsonb_build_object('account_id', d.fd_account_id, 'debit', d.principal, 'description', 'Deposit ' || coalesce(d.reference, d.fd_no)),
      jsonb_build_object('account_id', v_bank.id, 'credit', d.principal, 'description', 'Deposit ' || coalesce(d.reference, d.fd_no))),
    jsonb_build_object('date', v_date), d.confidentiality);
end $$;

create or replace function numero_private.wf_fd_placement(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event = 'posted' then
    update public.fixed_deposits set status = 'active', placement_journal_id = w.journal_id where id = w.source_id;
  elsif p_event = 'reversed' then
    if exists (select 1 from public.fixed_deposits d where d.id = w.source_id and d.status = 'closed') then
      raise exception 'NUMERO: this deposit has been closed. Reverse its closure first.' using errcode = 'P0001';
    end if;
    update public.fixed_deposits set status = 'draft', placement_journal_id = null where id = w.source_id;
  end if;
end $$;

-- Maturity or premature closure. Interest is what the bank actually paid, not what was expected.
create or replace function numero_private.close_fixed_deposit(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.fixed_deposits; v_bank public.accounts; v_date date := (p->>'date')::date;
        v_proceeds numeric := round((p->>'proceeds')::numeric, 2); v_tds numeric := round(coalesce((p->>'tax_deducted')::numeric, 0), 2);
        v_interest numeric; v_lines jsonb := '[]'::jsonb;
begin
  select * into d from public.fixed_deposits where id = (p->>'fd_id')::uuid for update;
  if not found then raise exception 'NUMERO: deposit not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'treasury.manage') then
    raise exception 'NUMERO: you are not authorised to record deposit movements.' using errcode = '42501';
  end if;
  if d.status <> 'active' then raise exception 'NUMERO: this deposit is % and cannot be closed.', d.status using errcode = 'P0001'; end if;
  if d.lien_marked and coalesce((p->>'lien_released')::boolean, false) is not true then
    raise exception 'NUMERO: this deposit is under lien (%). Confirm that the lien has been released before closing it.', coalesce(d.lien_note, 'no note') using errcode = 'P0001';
  end if;
  if v_date is null or v_date < d.start_date then raise exception 'NUMERO: the closure date is missing or before the start date.' using errcode = 'P0001'; end if;
  if v_proceeds is null or v_proceeds <= 0 or v_tds < 0 then raise exception 'NUMERO: enter the amount received and any tax deducted.' using errcode = 'P0001'; end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> d.company_id or v_bank.control_type is distinct from 'bank' then
    raise exception 'NUMERO: choose the bank ledger that received the proceeds.' using errcode = 'P0001';
  end if;
  v_interest := v_proceeds + v_tds - d.principal;
  v_lines := v_lines || jsonb_build_object('account_id', v_bank.id, 'debit', v_proceeds, 'description', 'Proceeds of ' || d.fd_no);
  if v_tds > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', numero_private.map_account(d.company_id, 'tds_receivable'), 'debit', v_tds,
       'party_id', d.bank_party_id, 'description', 'Tax deducted at source on interest — ' || d.fd_no);
  end if;
  if v_interest < 0 then
    v_lines := v_lines || jsonb_build_object('account_id', d.interest_account_id, 'debit', -v_interest, 'description', 'Shortfall on premature closure — ' || d.fd_no);
  end if;
  v_lines := v_lines || jsonb_build_object('account_id', d.fd_account_id, 'credit', d.principal, 'description', 'Deposit closed — ' || d.fd_no);
  if v_interest > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', d.interest_account_id, 'credit', v_interest, 'description', 'Interest earned — ' || d.fd_no);
  end if;
  return numero_private.propose_posting(d.company_id, 'receipt', v_date,
    'Fixed deposit ' || d.fd_no || case when v_date < d.maturity_date then ' closed before maturity' else ' matured' end || ' · ' || d.bank_name,
    'fd_closure', d.id, v_lines,
    jsonb_build_object('date', v_date, 'proceeds', v_proceeds, 'tax_deducted', v_tds, 'interest', v_interest), d.confidentiality);
end $$;

create or replace function numero_private.wf_fd_closure(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event = 'posted' then
    update public.fixed_deposits set status = 'closed', closure_journal_id = w.journal_id, closed_on = (w.payload->>'date')::date,
           proceeds = (w.payload->>'proceeds')::numeric, tax_deducted = (w.payload->>'tax_deducted')::numeric
     where id = w.source_id;
  elsif p_event = 'reversed' then
    update public.fixed_deposits set status = 'active', closure_journal_id = null, closed_on = null, proceeds = null, tax_deducted = null
     where id = w.source_id;
  end if;
end $$;

-- >>> applied as migration 20260927073857 · p2_17_payroll_masters
-- =====================================================================
-- 3. PAYROLL
-- =====================================================================
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  party_id uuid not null references public.parties(id),
  emp_no text not null,
  designation text,
  department_id uuid references public.org_units(id),
  office_id uuid references public.org_units(id),
  employment_type text not null default 'permanent'
    check (employment_type in ('permanent','contract','consultant','freelancer','agency','temporary','intern','advisor')),
  join_date date not null,
  exit_date date,
  status text not null default 'active' check (status in ('planned','active','notice','exited')),
  payment_method text,
  confidentiality text not null default 'internal'
    check (confidentiality in ('internal','confidential','highly_confidential','restricted','super_admin_only')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, party_id),
  unique (company_id, emp_no)
);
create index employees_company_idx on public.employees(company_id, status);

create table public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  company_id uuid not null references public.companies(id),
  effective_from date not null,
  components jsonb not null,
  monthly_gross numeric(20,4) not null default 0,
  monthly_deductions numeric(20,4) not null default 0,
  monthly_employer numeric(20,4) not null default 0,
  monthly_net numeric(20,4) not null default 0,
  annual_ctc numeric(20,4) not null default 0,
  reason text not null,
  status text not null default 'draft' check (status in ('draft','approved','rejected')),
  decision_note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz
);
create index salary_structures_employee_idx on public.salary_structures(employee_id, effective_from desc);
create unique index salary_structures_one_per_date on public.salary_structures(employee_id, effective_from) where status = 'approved';

-- A salary that has been approved is history. It is never overwritten (spec 1203).
create or replace function numero_private.guard_salary_structure() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'NUMERO: salary history is never deleted.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'approved' then
    raise exception 'NUMERO: an approved salary is never overwritten. Record a revision with a new effective date.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger salary_structures_guard before update or delete on public.salary_structures
  for each row execute function numero_private.guard_salary_structure();

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  run_no text not null,
  period_month date not null,
  run_type text not null default 'regular' check (run_type in ('regular','supplementary','full_and_final')),
  status text not null default 'draft' check (status in ('draft','proposed','posted','paid','reversed','cancelled')),
  headcount int not null default 0,
  gross numeric(20,4) not null default 0,
  deductions numeric(20,4) not null default 0,
  employer_cost numeric(20,4) not null default 0,
  net numeric(20,4) not null default 0,
  exceptions jsonb not null default '[]'::jsonb,
  journal_id uuid references public.journals(id),
  payment_journal_id uuid references public.journals(id),
  paid_on date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, run_no)
);
create unique index payroll_runs_one_regular on public.payroll_runs(company_id, period_month)
  where run_type = 'regular' and status in ('draft','proposed','posted','paid');

create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.employees(id),
  party_id uuid not null references public.parties(id),
  department_id uuid references public.org_units(id),
  structure_id uuid references public.salary_structures(id),
  days_in_month int not null,
  days_paid numeric(6,2) not null,
  gross numeric(20,4) not null default 0,
  deductions numeric(20,4) not null default 0,
  employer_cost numeric(20,4) not null default 0,
  net numeric(20,4) not null default 0,
  components jsonb not null default '[]'::jsonb,
  unique (run_id, employee_id)
);
create index payroll_lines_employee_idx on public.payroll_lines(employee_id);

create or replace function numero_private.save_employee(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_gid uuid; k text; v_no text;
begin
  if not numero_private.can(v_company, 'payroll.manage') then
    raise exception 'NUMERO: you are not authorised to maintain employee payroll records.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  if not exists (select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: choose the person from the party register.' using errcode = 'P0001';
  end if;
  if (p->>'join_date') is null then raise exception 'NUMERO: the joining date is required.' using errcode = 'P0001'; end if;
  if (p->>'exit_date') is not null and (p->>'exit_date')::date < (p->>'join_date')::date then
    raise exception 'NUMERO: the exit date is before the joining date.' using errcode = 'P0001';
  end if;
  foreach k in array array['department_id','office_id'] loop
    if p->>k is not null and not exists (select 1 from public.org_units u where u.id = (p->>k)::uuid and u.company_id = v_company) then
      raise exception 'NUMERO: the selected department or office belongs to another company.' using errcode = 'P0001';
    end if;
  end loop;
  if coalesce(p->>'confidentiality', 'internal') <> 'internal'
     and not numero_private.can_view_level(v_company, p->>'confidentiality') then
    raise exception 'NUMERO: you cannot create records at a confidentiality level you are not cleared for.' using errcode = '42501';
  end if;
  insert into public.party_roles(party_id, company_id, type_key) values ((p->>'party_id')::uuid, v_company, 'employee')
  on conflict (party_id, company_id, type_key) do nothing;

  if v_id is null then
    v_no := nullif(trim(p->>'emp_no'), '');
    if v_no is null then
      insert into public.register_sequences(company_id, prefix, last_no) values (v_company, 'EMP', 1)
      on conflict (company_id, prefix) do update set last_no = public.register_sequences.last_no + 1
      returning 'EMP-' || lpad(last_no::text, 5, '0') into v_no;
    end if;
    insert into public.employees(company_id, party_id, emp_no, designation, department_id, office_id, employment_type, join_date,
                                 exit_date, status, payment_method, confidentiality, notes, created_by)
    values (v_company, (p->>'party_id')::uuid, v_no, p->>'designation', (p->>'department_id')::uuid, (p->>'office_id')::uuid,
            coalesce(p->>'employment_type', 'permanent'), (p->>'join_date')::date, (p->>'exit_date')::date,
            coalesce(p->>'status', 'active'), p->>'payment_method', coalesce(p->>'confidentiality', 'internal'), p->>'notes',
            (select auth.uid()))
    returning id into v_id;
  else
    update public.employees set designation = p->>'designation', department_id = (p->>'department_id')::uuid,
      office_id = (p->>'office_id')::uuid, employment_type = coalesce(p->>'employment_type', employment_type),
      join_date = (p->>'join_date')::date, exit_date = (p->>'exit_date')::date, status = coalesce(p->>'status', status),
      payment_method = p->>'payment_method', confidentiality = coalesce(p->>'confidentiality', confidentiality), notes = p->>'notes'
    where id = v_id and company_id = v_company
      and numero_private.can_view_level(company_id, confidentiality);
    if not found then raise exception 'NUMERO: employee record not found, or you are not cleared to change it.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function numero_private.save_salary_structure(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.employees; v_id uuid := (p->>'id')::uuid; c jsonb; v_g numeric := 0; v_d numeric := 0; v_e numeric := 0; v_amt numeric;
        v_clean jsonb := '[]'::jsonb; s public.salary_structures; a public.accounts;
begin
  select * into e from public.employees where id = (p->>'employee_id')::uuid;
  if not found then raise exception 'NUMERO: employee not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(e.company_id, 'payroll.manage') or not numero_private.can_view_level(e.company_id, e.confidentiality) then
    raise exception 'NUMERO: you are not authorised to maintain this salary.' using errcode = '42501';
  end if;
  if (p->>'effective_from') is null then raise exception 'NUMERO: the effective date is required.' using errcode = 'P0001'; end if;
  if coalesce(trim(p->>'reason'), '') = '' then raise exception 'NUMERO: record the reason for this salary or revision.' using errcode = 'P0001'; end if;
  for c in select * from jsonb_array_elements(coalesce(p->'components', '[]'::jsonb)) loop
    v_amt := round((c->>'amount')::numeric, 2);
    if coalesce(trim(c->>'name'), '') = '' or v_amt is null or v_amt < 0 then
      raise exception 'NUMERO: every salary component needs a name and an amount that is not negative.' using errcode = 'P0001';
    end if;
    if c->>'kind' is null or c->>'kind' not in ('earning','deduction','employer') then
      raise exception 'NUMERO: component "%" must be an earning, a deduction or an employer cost.', c->>'name' using errcode = 'P0001';
    end if;
    if c->>'account_id' is not null then
      select * into a from public.accounts where id = (c->>'account_id')::uuid;
      if not found or a.company_id <> e.company_id or a.is_group then
        raise exception 'NUMERO: component "%" points to a ledger outside this company.', c->>'name' using errcode = 'P0001';
      end if;
    end if;
    if v_amt = 0 then continue; end if;
    v_clean := v_clean || jsonb_build_object('key', coalesce(nullif(c->>'key', ''), lower(regexp_replace(trim(c->>'name'), '[^a-zA-Z0-9]+', '_', 'g'))),
      'name', trim(c->>'name'), 'kind', c->>'kind', 'type', coalesce(c->>'type', case c->>'kind' when 'earning' then 'fixed' else 'statutory' end),
      'amount', v_amt, 'account_id', c->>'account_id');
    if c->>'kind' = 'earning' then v_g := v_g + v_amt; elsif c->>'kind' = 'deduction' then v_d := v_d + v_amt; else v_e := v_e + v_amt; end if;
  end loop;
  if v_g <= 0 then raise exception 'NUMERO: the salary needs at least one earning.' using errcode = 'P0001'; end if;
  if v_d > v_g then raise exception 'NUMERO: deductions exceed earnings.' using errcode = 'P0001'; end if;

  if v_id is null then
    insert into public.salary_structures(employee_id, company_id, effective_from, components, monthly_gross, monthly_deductions,
      monthly_employer, monthly_net, annual_ctc, reason, created_by)
    values (e.id, e.company_id, (p->>'effective_from')::date, v_clean, v_g, v_d, v_e, v_g - v_d, (v_g + v_e) * 12, trim(p->>'reason'),
            (select auth.uid()))
    returning id into v_id;
  else
    select * into s from public.salary_structures where id = v_id and employee_id = e.id for update;
    if not found then raise exception 'NUMERO: salary record not found.' using errcode = 'P0001'; end if;
    update public.salary_structures set status = 'draft', effective_from = (p->>'effective_from')::date, components = v_clean,
      monthly_gross = v_g, monthly_deductions = v_d, monthly_employer = v_e, monthly_net = v_g - v_d,
      annual_ctc = (v_g + v_e) * 12, reason = trim(p->>'reason')
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function numero_private.decide_salary_structure(p_id uuid, p_decision text, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.salary_structures; e public.employees; v_action text; prev public.salary_structures;
begin
  select * into s from public.salary_structures where id = p_id for update;
  if not found then raise exception 'NUMERO: salary record not found.' using errcode = 'P0001'; end if;
  select * into e from public.employees where id = s.employee_id;
  if not numero_private.can(s.company_id, 'payroll.approve') or not numero_private.can_view_level(s.company_id, e.confidentiality) then
    raise exception 'NUMERO: you are not authorised to approve this salary.' using errcode = '42501';
  end if;
  if s.status <> 'draft' then raise exception 'NUMERO: this salary record is already %.', s.status using errcode = 'P0001'; end if;
  if p_decision = 'rejected' then
    if coalesce(trim(p_comment), '') = '' then raise exception 'NUMERO: a reason is required to reject.' using errcode = 'P0001'; end if;
    update public.salary_structures set status = 'rejected', decision_note = p_comment where id = p_id;
    perform numero_private.log_event(s.company_id, 'salary_structures', p_id, 'rejected', null, null, p_comment);
    return;
  end if;
  if p_decision is distinct from 'approved' then raise exception 'NUMERO: the decision must be approved or rejected.' using errcode = 'P0001'; end if;
  v_action := numero_private.check_maker_checker(s.company_id, s.created_by, 'salary');
  if exists (select 1 from public.salary_structures x where x.employee_id = s.employee_id and x.status = 'approved' and x.effective_from = s.effective_from) then
    raise exception 'NUMERO: an approved salary already exists with this effective date. Choose a different effective date.' using errcode = 'P0001';
  end if;
  select * into prev from public.salary_structures x
   where x.employee_id = s.employee_id and x.status = 'approved' and x.effective_from < s.effective_from
   order by x.effective_from desc limit 1;
  update public.salary_structures set status = 'approved', decision_note = p_comment,
         approved_by = (select auth.uid()), approved_at = now() where id = p_id;
  perform numero_private.log_event(s.company_id, 'salary_structures', p_id, 'approved',
    case when prev.id is not null then jsonb_build_object('previous_structure', prev.id, 'previous_effective_from', prev.effective_from) end,
    jsonb_build_object('effective_from', s.effective_from, 'approval', v_action), coalesce(p_comment, s.reason));
end $$;

-- >>> applied as migration 20260927074020 · p2_18_payroll_runs_privileges
-- Calculates a payroll run from approved salaries. Nothing is posted here.
-- Anyone who could not be included is listed in `exceptions`; nobody is dropped silently.
create or replace function numero_private.create_payroll_run(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_type text := coalesce(p->>'run_type', 'regular');
  v_start date := date_trunc('month', (p->>'month')::date)::date; v_end date; v_dim int; v_run uuid;
  e record; s public.salary_structures; v_from date; v_to date; v_days numeric; v_factor numeric; v_unpaid numeric;
  c jsonb; adj jsonb; v_comp jsonb; v_amt numeric; v_g numeric; v_d numeric; v_e numeric;
  t_g numeric := 0; t_d numeric := 0; t_e numeric := 0; n int := 0; v_exc jsonb := '[]'::jsonb; adv public.advances; ln public.loans;
begin
  if not numero_private.can(v_company, 'payroll.manage') then
    raise exception 'NUMERO: you are not authorised to run payroll.' using errcode = '42501';
  end if;
  if v_start is null then raise exception 'NUMERO: choose the payroll month.' using errcode = 'P0001'; end if;
  if v_type not in ('regular','supplementary','full_and_final') then raise exception 'NUMERO: unknown run type.' using errcode = 'P0001'; end if;
  v_end := (v_start + interval '1 month - 1 day')::date;
  v_dim := v_end - v_start + 1;
  perform numero_private.assert_period_open(v_company, v_end);
  if v_type = 'regular' and exists (select 1 from public.payroll_runs r where r.company_id = v_company and r.period_month = v_start
        and r.run_type = 'regular' and r.status in ('draft','proposed','posted','paid')) then
    raise exception 'NUMERO: the regular payroll for % already exists.', to_char(v_start, 'Mon YYYY') using errcode = 'P0001';
  end if;

  insert into public.payroll_runs(company_id, run_no, period_month, run_type, notes, created_by)
  values (v_company, numero_private.next_doc_no(v_company, 'payroll_run', 'PAY', v_end), v_start, v_type, p->>'notes', (select auth.uid()))
  returning id into v_run;

  for e in
    select emp.*, pt.display_name from public.employees emp join public.parties pt on pt.id = emp.party_id
     where emp.company_id = v_company and emp.status <> 'planned'
       and emp.join_date <= v_end and (emp.exit_date is null or emp.exit_date >= v_start)
       and (v_type = 'regular' or exists (select 1 from jsonb_array_elements(coalesce(p->'adjustments', '[]'::jsonb)) x
                                           where x->>'employee_id' = emp.id::text))
     order by emp.emp_no
  loop
    v_comp := '[]'::jsonb; v_g := 0; v_d := 0; v_e := 0; s := null; v_days := 0;
    if v_type = 'regular' then
      select * into s from public.salary_structures x
       where x.employee_id = e.id and x.status = 'approved' and x.effective_from <= v_end
       order by x.effective_from desc limit 1;
      if not found then
        v_exc := v_exc || jsonb_build_object('employee_id', e.id, 'emp_no', e.emp_no, 'name', e.display_name,
                                             'reason', 'NOT INCLUDED — no approved salary is effective in this month');
        continue;
      end if;
      v_from := greatest(e.join_date, v_start);
      v_to := least(coalesce(e.exit_date, v_end), v_end);
      v_unpaid := coalesce((p->'unpaid_days'->>(e.id::text))::numeric, 0);
      v_days := greatest((v_to - v_from + 1) - v_unpaid, 0);
      v_factor := v_days / v_dim;
      if v_days <= 0 then
        v_exc := v_exc || jsonb_build_object('employee_id', e.id, 'emp_no', e.emp_no, 'name', e.display_name,
                                             'reason', 'NOT INCLUDED — no paid days in this month');
        continue;
      end if;
      for c in select * from jsonb_array_elements(s.components) loop
        v_amt := round((c->>'amount')::numeric * v_factor, 2);
        if v_amt = 0 then continue; end if;
        v_comp := v_comp || jsonb_build_array(c || jsonb_build_object('amount', v_amt, 'source', 'structure'));
        if c->>'kind' = 'earning' then v_g := v_g + v_amt; elsif c->>'kind' = 'deduction' then v_d := v_d + v_amt; else v_e := v_e + v_amt; end if;
      end loop;
    end if;

    for adj in select * from jsonb_array_elements(coalesce(p->'adjustments', '[]'::jsonb)) x where x->>'employee_id' = e.id::text loop
      v_amt := round((adj->>'amount')::numeric, 2);
      if v_amt is null or v_amt <= 0 or coalesce(trim(adj->>'name'), '') = '' or adj->>'kind' is null
         or adj->>'kind' not in ('earning','deduction','employer') then
        raise exception 'NUMERO: every adjustment for % needs a name, a kind and an amount greater than zero.', e.display_name using errcode = 'P0001';
      end if;
      if adj->>'type' = 'advance_recovery' then
        select * into adv from public.advances where id = (adj->>'advance_id')::uuid;
        if not found or adv.company_id <> v_company or adv.recipient_party_id <> e.party_id then
          raise exception 'NUMERO: the advance being recovered from % belongs to someone else.', e.display_name using errcode = 'P0001';
        end if;
        if v_amt > adv.released_amount - adv.settled_amount - adv.returned_amount then
          raise exception 'NUMERO: the recovery from % exceeds the unsettled balance of advance %.', e.display_name, adv.advance_no using errcode = 'P0001';
        end if;
      elsif adj->>'type' = 'loan_recovery' then
        select * into ln from public.loans where id = (adj->>'loan_id')::uuid;
        if not found or ln.company_id <> v_company or ln.party_id <> e.party_id or ln.direction <> 'lent' then
          raise exception 'NUMERO: the loan being recovered from % is not a loan given to that person.', e.display_name using errcode = 'P0001';
        end if;
        if v_amt > ln.disbursed_amount - ln.principal_repaid then
          raise exception 'NUMERO: the recovery from % exceeds the outstanding principal of loan %.', e.display_name, ln.loan_no using errcode = 'P0001';
        end if;
      end if;
      v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', coalesce(adj->>'type', 'adjustment'), 'name', trim(adj->>'name'), 'kind', adj->>'kind',
        'type', coalesce(adj->>'type', 'other'), 'amount', v_amt, 'source', 'adjustment',
        'advance_id', adj->>'advance_id', 'loan_id', adj->>'loan_id', 'note', adj->>'note'));
      if adj->>'kind' = 'earning' then v_g := v_g + v_amt; elsif adj->>'kind' = 'deduction' then v_d := v_d + v_amt; else v_e := v_e + v_amt; end if;
    end loop;

    if v_g = 0 and v_d = 0 and v_e = 0 then continue; end if;
    if v_d > v_g then
      raise exception 'NUMERO: deductions for % (%) exceed earnings (%). Reduce the recoveries for this month.', e.display_name, v_d, v_g using errcode = 'P0001';
    end if;
    insert into public.payroll_lines(run_id, company_id, employee_id, party_id, department_id, structure_id, days_in_month, days_paid,
                                     gross, deductions, employer_cost, net, components)
    values (v_run, v_company, e.id, e.party_id, e.department_id, s.id, v_dim, v_days, v_g, v_d, v_e, v_g - v_d, v_comp);
    t_g := t_g + v_g; t_d := t_d + v_d; t_e := t_e + v_e; n := n + 1;
  end loop;

  update public.payroll_runs set headcount = n, gross = t_g, deductions = t_d, employer_cost = t_e, net = t_g - t_d, exceptions = v_exc
   where id = v_run;
  perform numero_private.log_event(v_company, 'payroll_runs', v_run, 'calculated', null,
    jsonb_build_object('month', v_start, 'headcount', n, 'gross', t_g, 'net', t_g - t_d, 'not_included', jsonb_array_length(v_exc)), null);
  return v_run;
end $$;

create or replace function numero_private.propose_payroll_run(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; v_lines jsonb := '[]'::jsonb; g record; v_end date; v_j uuid; v_acc uuid; v_label text;
begin
  select * into r from public.payroll_runs where id = p_id for update;
  if not found then raise exception 'NUMERO: payroll run not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(r.company_id, 'payroll.manage') then
    raise exception 'NUMERO: you are not authorised to run payroll.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then raise exception 'NUMERO: this payroll run is %.', r.status using errcode = 'P0001'; end if;
  if r.headcount = 0 then raise exception 'NUMERO: this payroll run has nobody in it.' using errcode = 'P0001'; end if;
  v_end := (r.period_month + interval '1 month - 1 day')::date;

  -- debits: cost by department, never by person
  for g in
    select l.department_id, u.type_key, c->>'kind' as kind,
           case when c->>'kind' = 'employer' then 'employer'
                when c->>'type' in ('bonus','incentive','commission') then 'bonus' else 'salary' end as bucket,
           nullif(c->>'account_id', '')::uuid as account_id, sum((c->>'amount')::numeric) as amount
      from public.payroll_lines l
      cross join lateral jsonb_array_elements(l.components) c
      left join public.org_units u on u.id = l.department_id
     where l.run_id = p_id and c->>'kind' in ('earning','employer')
     group by 1, 2, 3, 4, 5 order by 4, 1
  loop
    v_acc := coalesce(g.account_id, numero_private.map_account(r.company_id,
               case g.bucket when 'employer' then 'employer_contribution_expense' when 'bonus' then 'bonus_expense' else 'salary_expense' end));
    v_label := case g.bucket when 'employer' then 'Employer contributions' when 'bonus' then 'Bonus and incentives' else 'Salaries' end;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_acc, 'debit', g.amount,
      'description', v_label || ' — ' || to_char(r.period_month, 'Mon YYYY'),
      'dims', case when g.department_id is null then '{}'::jsonb else jsonb_build_object(g.type_key, g.department_id) end));
  end loop;

  -- credits: net pay in one line; dues to authorities by type; recoveries against the person's own balance
  if r.net > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', numero_private.map_account(r.company_id, 'salaries_payable'),
      'credit', r.net, 'description', 'Net salaries payable — ' || to_char(r.period_month, 'Mon YYYY') || ' · ' || r.headcount || ' people'));
  end if;
  for g in
    select case when c->>'kind' = 'employer' then 'statutory' else coalesce(c->>'type', 'statutory') end as type,
           case when c->>'type' in ('advance_recovery','loan_recovery') then l.party_id end as party_id,
           nullif(c->>'advance_id', '')::uuid as advance_id, nullif(c->>'loan_id', '')::uuid as loan_id,
           sum((c->>'amount')::numeric) as amount
      from public.payroll_lines l cross join lateral jsonb_array_elements(l.components) c
     where l.run_id = p_id and c->>'kind' in ('deduction','employer')
     group by 1, 2, 3, 4 order by 1
  loop
    if g.type = 'advance_recovery' then
      v_acc := numero_private.map_account(r.company_id, 'employee_advances'); v_label := 'Advance recovered from salary';
    elsif g.type = 'loan_recovery' then
      select loan_account_id into v_acc from public.loans where id = g.loan_id; v_label := 'Loan recovered from salary';
    elsif g.type = 'tax' then
      v_acc := numero_private.map_account(r.company_id, 'tds_payable'); v_label := 'Tax deducted from salaries';
    else
      v_acc := numero_private.map_account(r.company_id, 'statutory_payable'); v_label := 'Statutory and other dues — payroll';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_acc, 'party_id', g.party_id, 'credit', g.amount,
      'description', v_label || ' — ' || to_char(r.period_month, 'Mon YYYY')));
  end loop;

  v_j := numero_private.propose_posting(r.company_id, 'journal', v_end,
    'Payroll ' || r.run_no || ' — ' || to_char(r.period_month, 'Mon YYYY')
      || case r.run_type when 'regular' then '' else ' (' || replace(r.run_type, '_', ' ') || ')' end,
    'payroll', r.id, v_lines,
    jsonb_build_object('month', r.period_month, 'net', r.net, 'gross', r.gross), 'confidential');
  update public.payroll_runs set status = 'proposed', journal_id = v_j where id = p_id;
  return v_j;
end $$;

create or replace function numero_private.cancel_payroll_run(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_id for update;
  if not found then raise exception 'NUMERO: payroll run not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(r.company_id, 'payroll.manage') then
    raise exception 'NUMERO: you are not authorised to run payroll.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'NUMERO: only a draft run can be cancelled. Reject or reverse its journal instead.' using errcode = 'P0001';
  end if;
  update public.payroll_runs set status = 'cancelled', notes = concat_ws(' · ', notes, 'Cancelled: ' || coalesce(p_reason, 'no reason given')) where id = p_id;
end $$;

create or replace function numero_private.wf_payroll(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; g record; v_sign int;
begin
  select * into r from public.payroll_runs where id = w.source_id for update;
  if p_event = 'voided' then
    update public.payroll_runs set status = 'draft', journal_id = null where id = r.id;
    return;
  end if;
  if p_event = 'reversed' and (r.status = 'paid' or exists (
       select 1 from public.workflow_postings x where x.source = 'payroll_payment' and x.source_id = r.id and x.status = 'pending')) then
    raise exception 'NUMERO: salaries for this run have been paid or a payment is awaiting approval. Reverse or reject that first.' using errcode = 'P0001';
  end if;
  v_sign := case when p_event = 'posted' then 1 else -1 end;
  for g in
    select nullif(c->>'advance_id', '')::uuid as advance_id, nullif(c->>'loan_id', '')::uuid as loan_id, c->>'type' as type,
           sum((c->>'amount')::numeric) as amount
      from public.payroll_lines l cross join lateral jsonb_array_elements(l.components) c
     where l.run_id = r.id and c->>'type' in ('advance_recovery','loan_recovery')
     group by 1, 2, 3
  loop
    if g.type = 'advance_recovery' then
      update public.advances set returned_amount = greatest(returned_amount + v_sign * g.amount, 0) where id = g.advance_id;
      perform numero_private.refresh_advance_status(g.advance_id);
    else
      update public.loans set principal_repaid = greatest(principal_repaid + v_sign * g.amount, 0) where id = g.loan_id;
    end if;
  end loop;
  update public.payroll_runs set status = case when p_event = 'posted' then case when r.net > 0 then 'posted' else 'paid' end else 'reversed' end
   where id = r.id;
end $$;

-- Payment of net salaries. Proposes: Dr Salaries payable / Cr Bank.
create or replace function numero_private.pay_payroll_run(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; v_bank public.accounts; v_date date := (p->>'date')::date;
begin
  select * into r from public.payroll_runs where id = (p->>'run_id')::uuid for update;
  if not found then raise exception 'NUMERO: payroll run not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(r.company_id, 'payroll.manage') or not numero_private.can(r.company_id, 'payment.create') then
    raise exception 'NUMERO: recording salary payments needs both payroll and payment permissions.' using errcode = '42501';
  end if;
  if r.status <> 'posted' then raise exception 'NUMERO: this payroll run is % and has no salaries awaiting payment.', r.status using errcode = 'P0001'; end if;
  if v_date is null then raise exception 'NUMERO: the payment date is required.' using errcode = 'P0001'; end if;
  select * into v_bank from public.accounts where id = (p->>'bank_ledger_id')::uuid;
  if not found or v_bank.company_id <> r.company_id or v_bank.control_type not in ('bank','cash') then
    raise exception 'NUMERO: choose the bank or cash ledger salaries were paid from.' using errcode = 'P0001';
  end if;
  return numero_private.propose_posting(r.company_id, 'payment', v_date,
    'Salaries paid — ' || r.run_no || ' · ' || to_char(r.period_month, 'Mon YYYY'), 'payroll_payment', r.id,
    jsonb_build_array(
      jsonb_build_object('account_id', numero_private.map_account(r.company_id, 'salaries_payable'), 'debit', r.net,
                         'description', 'Net salaries — ' || to_char(r.period_month, 'Mon YYYY')),
      jsonb_build_object('account_id', v_bank.id, 'credit', r.net, 'description', coalesce(p->>'reference', r.run_no))),
    jsonb_build_object('date', v_date, 'amount', r.net), 'confidential');
end $$;

create or replace function numero_private.wf_payroll_payment(w public.workflow_postings, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event = 'posted' then
    update public.payroll_runs set status = 'paid', payment_journal_id = w.journal_id, paid_on = (w.payload->>'date')::date where id = w.source_id;
  elsif p_event = 'reversed' then
    update public.payroll_runs set status = 'posted', payment_journal_id = null, paid_on = null where id = w.source_id;
  end if;
end $$;

-- ---------- public wrappers ----------
create or replace function public.save_loan(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_loan(p); $$;
create or replace function public.disburse_loan(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.disburse_loan(p); $$;
create or replace function public.pay_loan_instalment(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.pay_loan_instalment(p); $$;
create or replace function public.save_fixed_deposit(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_fixed_deposit(p); $$;
create or replace function public.place_fixed_deposit(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.place_fixed_deposit(p); $$;
create or replace function public.close_fixed_deposit(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.close_fixed_deposit(p); $$;
create or replace function public.save_employee(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_employee(p); $$;
create or replace function public.save_salary_structure(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.save_salary_structure(p); $$;
create or replace function public.decide_salary_structure(p_id uuid, p_decision text, p_comment text default null) returns void language sql set search_path = '' as $$ select numero_private.decide_salary_structure(p_id, p_decision, p_comment); $$;
create or replace function public.create_payroll_run(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.create_payroll_run(p); $$;
create or replace function public.propose_payroll_run(p_id uuid) returns uuid language sql set search_path = '' as $$ select numero_private.propose_payroll_run(p_id); $$;
create or replace function public.cancel_payroll_run(p_id uuid, p_reason text default null) returns void language sql set search_path = '' as $$ select numero_private.cancel_payroll_run(p_id, p_reason); $$;
create or replace function public.pay_payroll_run(p jsonb) returns uuid language sql set search_path = '' as $$ select numero_private.pay_payroll_run(p); $$;

-- ---------- audit ----------
create trigger audit_loans after insert or update or delete on public.loans for each row execute function numero_private.audit_row();
create trigger audit_fixed_deposits after insert or update or delete on public.fixed_deposits for each row execute function numero_private.audit_row();
create trigger audit_employees after insert or update or delete on public.employees for each row execute function numero_private.audit_row();
create trigger audit_salary_structures after insert or update or delete on public.salary_structures for each row execute function numero_private.audit_row();
create trigger audit_payroll_runs after insert or update or delete on public.payroll_runs for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.loans enable row level security;
alter table public.loan_schedule enable row level security;
alter table public.fixed_deposits enable row level security;
alter table public.employees enable row level security;
alter table public.salary_structures enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;

create policy loans_select on public.loans for select to authenticated
  using ((select numero_private.can(company_id, 'treasury.view'))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy loan_schedule_select on public.loan_schedule for select to authenticated
  using (exists (select 1 from public.loans l where l.id = loan_id));
create policy fixed_deposits_select on public.fixed_deposits for select to authenticated
  using ((select numero_private.can(company_id, 'treasury.view'))
         and (select numero_private.can_view_level(company_id, confidentiality)));

create policy employees_select on public.employees for select to authenticated
  using ((select numero_private.can(company_id, 'payroll.view'))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy salary_structures_select on public.salary_structures for select to authenticated
  using ((select numero_private.can(company_id, 'payroll.view'))
         and exists (select 1 from public.employees e where e.id = employee_id));
create policy payroll_runs_select on public.payroll_runs for select to authenticated
  using ((select numero_private.can(company_id, 'payroll.view')));
create policy payroll_lines_select on public.payroll_lines for select to authenticated
  using ((select numero_private.can(company_id, 'payroll.view'))
         and exists (select 1 from public.employees e where e.id = employee_id));

-- The audit trail of payroll tables carries salaries. It is readable only by people who may see payroll.
alter policy audit_select on public.audit_log using (
  (group_id is not null and (select numero_private.is_group_admin(group_id)))
  or (company_id is not null and (select numero_private.can(company_id, 'audit.view'))
      and (entity not in ('employees','salary_structures','payroll_runs','payroll_lines')
           or (select numero_private.can(company_id, 'payroll.view'))))
);

insert into numero_private.internal_functions(name) values ('build_loan_schedule') on conflict do nothing;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();
