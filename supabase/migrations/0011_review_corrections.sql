-- >>> applied as migration p2_20_review_corrections
-- =====================================================================
-- GHL NUMERO · 0011 · CORRECTIONS FOUND IN THE REQUIREMENT REVIEW
--
-- Each requirement of phase 2 was assessed against the code. The review
-- found six places where the database did less than it should. They are
-- corrected here. Non-destructive: one column and policies are added;
-- existing functions are corrected in place so that every earlier
-- correction to them is kept.
--
--  1. A loan recovered through payroll reaches its instalment schedule.
--     Before: loans.principal_repaid rose, the instalment stayed due, and
--     recording it later counted its principal twice.
--  2. An advance to a vendor sits in the vendor advances ledger, not in
--     the employee advances ledger.
--  3. A claim or an advance linked to a trip, event, vehicle or path
--     carries that item's dimension into its accounting entry, so the
--     item's page can show what it cost.
--  4. The "maximum single payment" of a cash box is checked. A payment
--     above it is recorded and raised for review; it is not blocked.
--  5. In a multi-step approval of an advance, a later approver cannot
--     raise the amount an earlier approver authorised.
--  6. A person who may upload documents can open the files they uploaded,
--     and can remove a stored file that never became a document.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. LOAN RECOVERY THROUGH PAYROLL
--   * loan_schedule.recovered holds the principal recovered through payroll
--   * an instalment whose principal is fully recovered and that carries no
--     interest is paid by the recovery
--   * recording an instalment takes only the principal still unrecovered
--   * reversing the payroll takes the recovery back, latest instalment
--     first, and refuses if an instalment was recorded after it
-- ---------------------------------------------------------------------
alter table public.loan_schedule add column if not exists recovered numeric(20,4) not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'loan_schedule_recovered_chk') then
    alter table public.loan_schedule add constraint loan_schedule_recovered_chk check (recovered >= 0 and recovered <= principal);
  end if;
end $$;
comment on column public.loan_schedule.recovered is 'Principal of this instalment recovered through payroll. What remains to be recorded is principal - recovered, plus interest.';

create or replace function numero_private.apply_loan_recovery(p_loan uuid, p_amount numeric, p_date date, p_journal uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.loans; s public.loan_schedule; v_left numeric := abs(coalesce(p_amount, 0)); v_take numeric;
begin
  if v_left = 0 then return; end if;
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'NUMERO: the loan being recovered was not found.' using errcode = 'P0001'; end if;

  if p_amount > 0 then
    if exists (select 1 from public.loan_schedule x where x.loan_id = p_loan and x.status = 'proposed') then
      raise exception 'NUMERO: an instalment of loan % is awaiting approval. Approve or reject it before a recovery through payroll is posted.', l.loan_no using errcode = 'P0001';
    end if;
    if p_amount > l.disbursed_amount - l.principal_repaid then
      raise exception 'NUMERO: the recovery of % exceeds the outstanding principal of loan % (%).', p_amount, l.loan_no, l.disbursed_amount - l.principal_repaid using errcode = 'P0001';
    end if;
    for s in select * from public.loan_schedule where loan_id = p_loan and status = 'due' and principal > recovered order by instalment_no for update loop
      exit when v_left <= 0;
      v_take := least(v_left, s.principal - s.recovered);
      if s.recovered + v_take >= s.principal and s.interest = 0 then
        update public.loan_schedule set recovered = recovered + v_take, status = 'paid', paid_on = p_date, journal_id = p_journal where id = s.id;
      else
        update public.loan_schedule set recovered = recovered + v_take where id = s.id;
      end if;
      v_left := v_left - v_take;
    end loop;
    update public.loans set principal_repaid = principal_repaid + p_amount where id = p_loan;
    update public.loans set status = 'closed'
     where id = p_loan and status = 'active' and disbursed_amount - principal_repaid <= 0
       and not exists (select 1 from public.loan_schedule x where x.loan_id = p_loan and x.status <> 'paid');
  else
    for s in select * from public.loan_schedule where loan_id = p_loan and recovered > 0 order by instalment_no desc for update loop
      exit when v_left <= 0;
      if s.status = 'proposed' or (s.status = 'paid' and exists (
           select 1 from public.workflow_postings x where x.journal_id = s.journal_id and x.source = 'loan_instalment')) then
        raise exception 'NUMERO: instalment % of loan % was recorded after this recovery. Reverse that instalment first.', s.instalment_no, l.loan_no using errcode = 'P0001';
      end if;
      v_take := least(v_left, s.recovered);
      update public.loan_schedule set recovered = recovered - v_take, status = 'due', paid_on = null, journal_id = null where id = s.id;
      v_left := v_left - v_take;
    end loop;
    update public.loans set principal_repaid = greatest(principal_repaid + p_amount, 0),
           status = case when status = 'closed' then 'active' else status end
     where id = p_loan;
  end if;
end $$;

do $$
declare v_def text; v_new text;
  v_old_line text := 'update public.loans set principal_repaid = greatest(principal_repaid + v_sign * g.amount, 0) where id = g.loan_id;';
  v_new_line text := 'perform numero_private.apply_loan_recovery(g.loan_id, v_sign * g.amount, (date_trunc(''month'', r.period_month) + interval ''1 month - 1 day'')::date, w.journal_id);';
begin
  -- payroll: posting applies the recovery to the schedule, reversal takes it back
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'wf_payroll';
  if position('apply_loan_recovery' in v_def) = 0 then
    v_new := replace(v_def, v_old_line, v_new_line);
    if v_new = v_def then raise exception 'NUMERO: wf_payroll could not be corrected: the expected statement was not found.'; end if;
    execute v_new;
  end if;

  -- an instalment takes only the principal that has not already been recovered
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'pay_loan_instalment';
  if position('s.recovered' in v_def) = 0 then
    v_new := replace(v_def, 's.principal', '(s.principal - s.recovered)');
    if v_new = v_def then raise exception 'NUMERO: pay_loan_instalment could not be corrected.'; end if;
    execute v_new;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. THE LEDGER OF AN ADVANCE FOLLOWS ITS RECIPIENT
-- 3. THE DIMENSION OF A LINKED REGISTER ITEM REACHES THE ENTRY
-- ---------------------------------------------------------------------
create or replace function numero_private.advance_account(p_company uuid, p_recipient_type text) returns uuid
language sql stable security definer set search_path = '' as $$
  select numero_private.map_account(p_company, case when p_recipient_type = 'vendor' then 'vendor_advances' else 'employee_advances' end);
$$;

-- the dimension of a register item (a trip, an event, a vehicle, a path), as line tags; empty when the item has none
create or replace function numero_private.item_dims(p_item uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(u.type_key, u.id)
                     from public.register_items ri join public.org_units u on u.id = ri.org_unit_id
                    where ri.id = p_item and u.status = 'active'), '{}'::jsonb);
$$;

do $$
declare v_def text; v_new text; f text;
begin
  foreach f in array array['release_advance', 'return_advance'] loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'numero_private' and p.proname = f;
    if position('advance_account' in v_def) = 0 then
      v_new := replace(v_def, 'numero_private.map_account(a.company_id, ''employee_advances'')', 'numero_private.advance_account(a.company_id, a.recipient_type)');
      v_new := replace(v_new, '''dims'', a.dims)', '''dims'', numero_private.item_dims(a.register_item_id) || coalesce(a.dims, ''{}''::jsonb))');
      if position('item_dims' in v_new) = 0 or position('advance_account' in v_new) = 0 then
        raise exception 'NUMERO: % could not be corrected.', f;
      end if;
      execute v_new;
    end if;
  end loop;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'propose_claim_posting';
  if position('advance_account' in v_def) = 0 then
    v_new := replace(v_def, 'numero_private.map_account(c.company_id, ''employee_advances'')', 'numero_private.advance_account(c.company_id, adv.recipient_type)');
    -- the line's own tags win over the item's
    v_new := replace(v_new, '''dims'', l.dims)', '''dims'', numero_private.item_dims(c.register_item_id) || coalesce(l.dims, ''{}''::jsonb))');
    v_new := replace(v_new, '''dims'', adv.dims)', '''dims'', numero_private.item_dims(adv.register_item_id) || coalesce(adv.dims, ''{}''::jsonb))');
    if position('advance_account' in v_new) = 0 or position('item_dims(c.register_item_id)' in v_new) = 0 or position('item_dims(adv.register_item_id)' in v_new) = 0 then
      raise exception 'NUMERO: propose_claim_posting could not be corrected.';
    end if;
    execute v_new;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. CASH BOX: MAXIMUM SINGLE PAYMENT
-- Checked when an operation proposes an entry that pays out of the ledger
-- of a cash box. Factual, for review. It never blocks the payment.
-- ---------------------------------------------------------------------
create or replace function numero_private.check_cash_box_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare x record;
begin
  for x in
    select b.id as box_id, b.name, b.max_single_payment, l.credit, j.narration
      from public.journal_lines l
      join public.journals j on j.id = l.journal_id
      join public.cash_boxes b on b.ledger_account_id = l.account_id and b.company_id = j.company_id and b.is_active
     where l.journal_id = new.journal_id and b.max_single_payment is not null and b.max_single_payment > 0
       and l.credit > b.max_single_payment
  loop
    insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
    values (new.company_id, 'cash_box_limit_exceeded', 'review', 'CASH BOX — payment above the limit for a single payment',
      'A payment of ' || round(x.credit, 2) || ' from cash box "' || x.name || '" is above its limit of ' || round(x.max_single_payment, 2)
        || ' for a single payment. Entry: ' || coalesce(x.narration, 'no narration') || '. The payment is recorded; whether it is in order is for a person to decide.',
      jsonb_build_object('box_id', x.box_id, 'journal_id', new.journal_id, 'amount', round(x.credit, 2), 'limit', round(x.max_single_payment, 2),
                         'source', new.source, 'rule', 'a single payment from a cash box above its configured limit is raised for review'),
      'journals', new.journal_id, 'cashboxlimit:' || new.journal_id::text || ':' || x.box_id::text)
    on conflict (company_id, dedupe_key) do nothing;
  end loop;
  return new;
end $$;
drop trigger if exists workflow_postings_cash_box_limit on public.workflow_postings;
create trigger workflow_postings_cash_box_limit after insert on public.workflow_postings
  for each row execute function numero_private.check_cash_box_limit();

-- ---------------------------------------------------------------------
-- 5. ADVANCE APPROVAL IN SEVERAL STEPS
-- The amount authorised at a step is kept; a later step may lower it, never raise it.
-- ---------------------------------------------------------------------
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'approve_advance';
  if position('an earlier approver authorised' in v_def) = 0 then
    v_new := replace(v_def,
      '  -- the approver must have seen the recipient''s unsettled history (spec 1562): it is recorded with the decision',
      '  if a.approved_amount > 0 and v_amt > a.approved_amount then' || chr(10) ||
      '    raise exception ''NUMERO: an earlier approver authorised %. A later step may lower the amount, not raise it.'', a.approved_amount using errcode = ''P0001'';' || chr(10) ||
      '  end if;' || chr(10) ||
      '  -- the approver must have seen the recipient''s unsettled history (spec 1562): it is recorded with the decision');
    v_new := replace(v_new,
      'approved_by = (select auth.uid()), approved_at = now() where id = p_id;' || chr(10) || '  end if;',
      'approved_by = (select auth.uid()), approved_at = now() where id = p_id;' || chr(10) ||
      '  else' || chr(10) ||
      '    update public.advances set approved_amount = v_amt where id = p_id;' || chr(10) ||
      '  end if;');
    if position('an earlier approver authorised' in v_new) = 0 or position('set approved_amount = v_amt where id = p_id' in v_new) = 0 then
      raise exception 'NUMERO: approve_advance could not be corrected.';
    end if;
    execute v_new;
  end if;

  -- a rejected request starts again with nothing authorised
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'reject_advance';
  if position('approved_amount = 0' in v_def) = 0 then
    v_new := replace(v_def, 'update public.advances set status = ''rejected'' where id = p_id;', 'update public.advances set status = ''rejected'', approved_amount = 0 where id = p_id;');
    if v_new = v_def then raise exception 'NUMERO: reject_advance could not be corrected.'; end if;
    execute v_new;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. STORED FILES
-- ---------------------------------------------------------------------
-- the same rule as the documents table: a person reads every file with document.view, and otherwise the files they uploaded
alter policy numero_documents_read on storage.objects
  using (bucket_id = 'numero-documents'
         and ((select numero_private.can(numero_private.path_company(name), 'document.view')) or owner = (select auth.uid())));

-- A file that was stored but never registered is not evidence. Its uploader may remove it.
-- A file that belongs to a document can never be removed.
create or replace function numero_private.path_is_registered(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.documents d where d.storage_path = p_path);
$$;
drop policy if exists numero_documents_remove_unregistered on storage.objects;
create policy numero_documents_remove_unregistered on storage.objects for delete to authenticated
  using (bucket_id = 'numero-documents' and owner = (select auth.uid())
         and not numero_private.path_is_registered(name));

insert into numero_private.internal_functions(name) values ('apply_loan_recovery'), ('advance_account'), ('item_dims'), ('check_cash_box_limit') on conflict do nothing;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();
