-- >>> applied as migration 20260927072152 · p2_01_permissions_approvals_workflow
-- =====================================================================
-- GHL NUMERO · 0006 · WORKFLOW POSTING ENGINE, GENERAL APPROVALS,
--                     REGISTERS & OBLIGATIONS, TASKS, DOCUMENT VAULT
-- Spec: 125, 134-137, 141, 145, 236, 243, 450-451, 516, 520-521,
--       663-690, 1556, 1742-1752, 1787, 1819
--
-- Additive only. Nothing from 0001-0005 is dropped.
--
-- Principles carried forward:
--   * An operational event (advance, claim, depreciation run, payroll run …)
--     never writes to the ledger on its own. It PROPOSES a journal, which
--     passes through the same approval and maker-checker control as any
--     other journal, and posts on final approval.
--   * Approval ≠ fund transfer ≠ expense ≠ settlement (spec 1556).
--   * NUMERO records accounting facts. It never moves money.
-- =====================================================================

-- ---------- permissions added in phase 2 ----------
create or replace function numero_private.seed_roles(gid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_role uuid; p text;
  base_perms text[] := array[
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
  ops_perms text[] := array[
    'register.view','register.manage','document.view','document.upload',
    'asset.view','asset.manage',
    'purchase.view','purchase.create','purchase.approve',
    'expense.view','expense.create','expense.approve',
    'treasury.view','treasury.manage'];
  payroll_perms text[] := array['payroll.view','payroll.manage','payroll.approve'];
begin
  for r in select * from (values
    ('owner','Owner', base_perms || ops_perms || payroll_perms),
    ('group_cfo','Group CFO', base_perms || ops_perms || payroll_perms),
    ('company_director','Company Director', array['company.view','account.view','journal.view','journal.approve','journal.reject','invoice.view','invoice.approve','bill.view','bill.approve','payment.view','payment.approve','party.view','bank.view','budget.view','budget.approve','report.view','report.export','audit.view','sentinel.view','numi.use',
        'register.view','document.view','asset.view','purchase.view','purchase.approve','expense.view','expense.create','expense.approve','treasury.view']),
    ('finance_head','Finance Head', array['company.view','account.view','account.configure','orgunit.configure','journal.view','journal.create','journal.edit','journal.submit','journal.approve','journal.reject','journal.post','journal.reverse','invoice.view','invoice.create','invoice.approve','bill.view','bill.create','bill.approve','payment.view','payment.create','payment.approve','party.view','party.create','party.edit','party.bank.verify','bank.view','bank.import','bank.reconcile','budget.view','budget.edit','budget.approve','period.lock','report.view','report.export','audit.view','sentinel.view','sentinel.review','numi.use','tax.configure','approval.configure']
        || ops_perms),
    ('accountant','Accountant', array['company.view','account.view','journal.view','journal.create','journal.edit','journal.submit','journal.post','invoice.view','invoice.create','bill.view','bill.create','payment.view','payment.create','party.view','party.create','party.edit','bank.view','bank.import','bank.reconcile','budget.view','report.view','report.export','sentinel.view','numi.use',
        'register.view','register.manage','document.view','document.upload','asset.view','asset.manage','purchase.view','purchase.create','expense.view','expense.create','treasury.view','treasury.manage']),
    ('junior_accountant','Junior Accountant', array['company.view','account.view','journal.view','journal.create','journal.edit','journal.submit','invoice.view','invoice.create','bill.view','bill.create','payment.view','payment.create','party.view','bank.view','report.view','numi.use',
        'register.view','document.view','document.upload','asset.view','purchase.view','expense.view','expense.create']),
    ('auditor','Auditor', array['company.view','account.view','journal.view','invoice.view','bill.view','payment.view','party.view','bank.view','budget.view','report.view','report.export','audit.view','sentinel.view','numi.use',
        'register.view','document.view','asset.view','purchase.view','expense.view','treasury.view']),
    ('tax_consultant','Tax Consultant', array['company.view','account.view','journal.view','invoice.view','bill.view','report.view','report.export','numi.use','document.view','register.view']),
    ('department_head','Department Head', array['company.view','budget.view','report.view','journal.view','numi.use',
        'register.view','document.upload','purchase.view','purchase.create','expense.create','expense.approve','party.view']),
    ('project_manager','Project Manager', array['company.view','budget.view','report.view','numi.use',
        'register.view','document.upload','purchase.view','purchase.create','expense.create','party.view']),
    ('purchase_manager','Purchase Manager', array['company.view','bill.view','bill.create','party.view','party.create','report.view','numi.use',
        'register.view','document.view','document.upload','purchase.view','purchase.create','expense.create']),
    ('sales_manager','Sales Manager', array['company.view','invoice.view','invoice.create','party.view','party.create','report.view','numi.use',
        'register.view','register.manage','document.upload','expense.create']),
    ('payroll_officer','Payroll Officer', array['company.view','party.view','numi.use','document.upload','expense.create','payroll.view','payroll.manage']),
    ('hr_head','HR Head', array['company.view','party.view','party.create','numi.use','document.upload','expense.create','expense.approve','payroll.view','payroll.manage','payroll.approve']),
    ('employee','Employee', array['company.view','numi.use','expense.create','document.upload']),
    ('read_only','Read Only', array['company.view','account.view','journal.view','invoice.view','bill.view','payment.view','party.view','bank.view','budget.view','report.view',
        'register.view','document.view','asset.view','purchase.view','expense.view','treasury.view'])
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

do $$ declare g record; begin
  for g in select id from public.groups loop perform numero_private.seed_roles(g.id); end loop;
end $$;

-- =====================================================================
-- 1. GENERAL APPROVAL ENGINE (any entity, amount-based multi-step rules)
-- =====================================================================
create or replace function numero_private.open_request(
  p_company uuid, p_entity text, p_entity_id uuid, p_amount numeric, p_summary text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rule public.approval_rules; v_steps text[]; v_req uuid; v_group uuid;
begin
  select group_id into v_group from public.companies where id = p_company;
  select * into v_rule from public.approval_rules r
   where r.is_active and r.entity = p_entity and r.group_id = v_group
     and (r.company_id = p_company or r.company_id is null)
     and coalesce(p_amount, 0) >= r.min_amount and (r.max_amount is null or coalesce(p_amount, 0) < r.max_amount)
   order by (r.company_id is not null) desc, r.min_amount desc limit 1;
  v_steps := case when found then v_rule.steps else array['*'] end;
  update public.approval_requests set status = 'cancelled', completed_at = now()
   where entity = p_entity and entity_id = p_entity_id and status = 'pending';
  insert into public.approval_requests(company_id, entity, entity_id, amount, rule_id, steps, summary, requested_by)
  values (p_company, p_entity, p_entity_id, coalesce(p_amount, 0), v_rule.id, v_steps, p_summary, (select auth.uid()))
  returning id into v_req;
  return v_req;
end $$;

-- Records one approval step. Returns 'approved' when the last step is complete, otherwise 'pending'.
create or replace function numero_private.decide_request(
  p_company uuid, p_entity text, p_entity_id uuid, p_maker uuid, p_perm text, p_what text, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.approval_requests; v_role text; v_action text; v_uid uuid := (select auth.uid());
begin
  if not numero_private.can(p_company, p_perm) then
    raise exception 'NUMERO: you are not authorised to approve this %.', p_what using errcode = '42501';
  end if;
  select * into r from public.approval_requests
   where entity = p_entity and entity_id = p_entity_id and status = 'pending' for update;
  if not found then raise exception 'NUMERO: this % is not awaiting approval.', p_what using errcode = 'P0001'; end if;
  v_role := r.steps[r.current_step];
  if v_role <> '*' and not numero_private.has_role(p_company, v_role)
     and not numero_private.is_group_admin(numero_private.company_group(p_company)) then
    raise exception 'NUMERO: this approval step requires the role %.', v_role using errcode = '42501';
  end if;
  v_action := numero_private.check_maker_checker(p_company, p_maker, p_what);
  if v_action = 'approve' and exists (
       select 1 from public.approval_actions a where a.request_id = r.id and a.actor = v_uid and a.action in ('approve','override')) then
    raise exception 'NUMERO: you have already approved an earlier step of this request.' using errcode = '42501';
  end if;
  insert into public.approval_actions(request_id, step, actor, action, comment)
  values (r.id, r.current_step, v_uid, v_action, p_comment);
  if r.current_step >= array_length(r.steps, 1) then
    update public.approval_requests set status = 'approved', completed_at = now() where id = r.id;
    return 'approved';
  end if;
  update public.approval_requests set current_step = current_step + 1 where id = r.id;
  return 'pending';
end $$;

create or replace function numero_private.refuse_request(
  p_company uuid, p_entity text, p_entity_id uuid, p_perm text, p_what text, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.approval_requests;
begin
  if not numero_private.can(p_company, p_perm) then
    raise exception 'NUMERO: you are not authorised to reject this %.', p_what using errcode = '42501';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'NUMERO: a reason is required to reject.' using errcode = 'P0001';
  end if;
  select * into r from public.approval_requests
   where entity = p_entity and entity_id = p_entity_id and status = 'pending' for update;
  if not found then raise exception 'NUMERO: this % is not awaiting approval.', p_what using errcode = 'P0001'; end if;
  insert into public.approval_actions(request_id, step, actor, action, comment)
  values (r.id, r.current_step, (select auth.uid()), 'reject', p_comment);
  update public.approval_requests set status = 'rejected', completed_at = now() where id = r.id;
end $$;

-- =====================================================================
-- 2. WORKFLOW POSTING ENGINE
-- =====================================================================
create table public.workflow_postings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  journal_id uuid not null unique references public.journals(id),
  source text not null,
  source_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','posted','voided','reversed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index workflow_postings_source_idx on public.workflow_postings(source, source_id);
alter table public.workflow_postings enable row level security;
create policy workflow_postings_select on public.workflow_postings for select to authenticated
  using (exists (select 1 from public.journals j where j.id = journal_id));

-- Prepares a journal from an operational event and places it in the approval queue.
create or replace function numero_private.propose_posting(
  p_company uuid, p_vtype text, p_date date, p_narration text, p_source text, p_source_id uuid,
  p_lines jsonb, p_payload jsonb default '{}'::jsonb, p_confidentiality text default 'internal') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_j uuid; v_total numeric; v_req uuid; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'NUMERO: authentication required.'; end if;
  if p_date is null then raise exception 'NUMERO: a posting date is required.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.workflow_postings w
              where w.source = p_source and w.source_id = p_source_id and w.status = 'pending') then
    raise exception 'NUMERO: an accounting entry for this record is already awaiting approval. Approve or reject it first.' using errcode = 'P0001';
  end if;
  perform numero_private.assert_period_open(p_company, p_date);
  insert into public.journals(company_id, voucher_type, journal_date, narration, source, source_id, origin,
                              confidentiality, created_by)
  values (p_company, p_vtype, p_date, p_narration, p_source, p_source_id, 'system',
          coalesce(p_confidentiality, 'internal'), v_uid)
  returning id into v_j;
  v_total := numero_private.write_journal_lines(v_j, p_company, p_lines);
  update public.journals set total = v_total where id = v_j;
  perform numero_private.assert_balanced(v_j);
  v_req := numero_private.open_request(p_company, 'journal', v_j, v_total, p_narration);
  update public.journals set status = 'submitted', submitted_by = v_uid, submitted_at = now() where id = v_j;
  insert into public.workflow_postings(company_id, journal_id, source, source_id, payload, created_by)
  values (p_company, v_j, p_source, p_source_id, coalesce(p_payload, '{}'::jsonb), v_uid);
  perform numero_private.log_event(p_company, 'journals', v_j, 'proposed', null,
    jsonb_build_object('source', p_source, 'source_id', p_source_id, 'total', v_total, 'approval_request', v_req,
                       'rule', 'Operational event → proposed journal → approval → posting'), null);
  return v_j;
end $$;

-- Calls numero_private.wf_<source>(posting, event) for a journal that belongs to a workflow.
-- Events: posted | voided | reversed. A handler may raise to refuse the event.
create or replace function numero_private.wf_dispatch(p_journal uuid, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workflow_postings; v_fn text;
begin
  if p_event not in ('posted','voided','reversed') then raise exception 'NUMERO: unknown workflow event.'; end if;
  select * into w from public.workflow_postings
   where journal_id = p_journal and status = case when p_event = 'reversed' then 'posted' else 'pending' end
   for update;
  if not found then return; end if;
  v_fn := 'wf_' || w.source;
  if to_regprocedure('numero_private.' || quote_ident(v_fn) || '(public.workflow_postings, text)') is null then
    raise exception 'NUMERO: no handler is installed for workflow source "%".', w.source using errcode = 'P0001';
  end if;
  execute format('select numero_private.%I($1, $2)', v_fn) using w, p_event;
  update public.workflow_postings set status = p_event, completed_at = now() where id = w.id;
end $$;

-- Reversal of a journal that came from a Phase 1 document keeps the document truthful.
create or replace function numero_private.on_document_reversed(j public.journals) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; pay public.payments; a record;
begin
  if j.source = 'invoice' then
    select * into inv from public.invoices where journal_id = j.id for update;
    if found then
      if inv.amount_settled > 0 then
        raise exception 'NUMERO: % has settlements of % recorded against it. Reverse those receipts or payments first.', inv.doc_no, inv.amount_settled using errcode = 'P0001';
      end if;
      update public.invoices set status = 'cancelled' where id = inv.id;
      perform numero_private.log_event(inv.company_id, 'invoices', inv.id, 'cancelled_by_reversal',
        jsonb_build_object('status', inv.status), jsonb_build_object('status', 'cancelled'), j.narration);
    end if;
  elsif j.source in ('payment','receipt') then
    select * into pay from public.payments where journal_id = j.id for update;
    if found then
      for a in select pa.invoice_id, pa.amount from public.payment_allocations pa where pa.payment_id = pay.id loop
        update public.invoices
           set amount_settled = greatest(amount_settled - a.amount, 0),
               status = case when status = 'cancelled' then status
                             when amount_settled - a.amount <= 0 then 'open' else 'partially_paid' end
         where id = a.invoice_id;
      end loop;
      update public.payments set status = 'cancelled' where id = pay.id;
      perform numero_private.log_event(pay.company_id, 'payments', pay.id, 'cancelled_by_reversal',
        jsonb_build_object('status', pay.status), jsonb_build_object('status', 'cancelled'), j.narration);
    end if;
  end if;
end $$;

-- >>> applied as migration 20260927072259 · p2_02_journal_workflow_hooks
-- ---------- journal workflow, extended with the workflow hooks ----------
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
    if exists (select 1 from public.workflow_postings w where w.journal_id = v_id) then
      raise exception 'NUMERO: this journal was prepared by a workflow and cannot be edited by hand. Reject it and issue it again from its source record.' using errcode = 'P0001';
    end if;
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

create or replace function numero_private.approve_journal(p_id uuid, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare j public.journals; r public.approval_requests; v_role text; v_action text; v_uid uuid := (select auth.uid()); v_voucher text;
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
  if not numero_private.can_view_level(j.company_id, j.confidentiality) then
    raise exception 'NUMERO: this journal is classified % and you are not cleared to see it. Nobody approves what they cannot read.', j.confidentiality using errcode = '42501';
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
    -- a journal prepared by a workflow posts on its final approval
    if exists (select 1 from public.workflow_postings w where w.journal_id = p_id and w.status = 'pending') then
      v_voucher := numero_private.do_post(p_id);
      perform numero_private.wf_dispatch(p_id, 'posted');
      perform numero_private.log_event(j.company_id, 'journals', p_id, 'posted', null,
        jsonb_build_object('voucher_no', v_voucher, 'total', j.total, 'rule', 'Workflow journal posts on final approval'), null);
    end if;
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
  perform set_config('numero.reason', p_comment, true);
  perform numero_private.wf_dispatch(p_id, 'voided');
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
  perform set_config('numero.reason', coalesce(p_reason, ''), true);
  perform numero_private.wf_dispatch(p_id, 'voided');
  update public.journals set status = 'cancelled' where id = p_id;
  perform numero_private.log_event(j.company_id, 'journals', p_id, 'cancelled', null, null, p_reason);
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
  perform numero_private.wf_dispatch(p_id, 'posted');
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

  -- the source record is consulted first: it may refuse (for example a settled invoice)
  perform set_config('numero.reason', p_reason, true);
  perform numero_private.on_document_reversed(j);
  perform numero_private.wf_dispatch(p_id, 'reversed');

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

-- ---------- account mapping administration ----------
create or replace function numero_private.set_account_map(p_company uuid, p_key text, p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.accounts;
begin
  if not numero_private.can(p_company, 'account.configure') then
    raise exception 'NUMERO: you are not authorised to change the account mapping.' using errcode = '42501';
  end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'NUMERO: a mapping key is required.' using errcode = 'P0001'; end if;
  select * into a from public.accounts where id = p_account;
  if not found or a.company_id <> p_company or a.is_group or not a.is_active then
    raise exception 'NUMERO: choose an active posting account of this company.' using errcode = 'P0001';
  end if;
  insert into public.company_account_map(company_id, key, account_id) values (p_company, p_key, p_account)
  on conflict (company_id, key) do update set account_id = excluded.account_id;
end $$;
create or replace function public.set_account_map(p_company uuid, p_key text, p_account uuid) returns void
language sql set search_path = '' as $$ select numero_private.set_account_map(p_company, p_key, p_account); $$;

-- >>> applied as migration 20260927072343 · p2_03_registers_obligations
-- =====================================================================
-- 3. REGISTERS & OBLIGATIONS (NUMERO FORWARD foundation)
-- A register item is any recorded arrangement that can create a future
-- financial consequence: a subscription, an insurance policy, a lease,
-- a guarantee, a legal claim, a vehicle, an incident, a financial path.
-- Kinds are data. Administrators can add kinds and fields without code.
-- =====================================================================
create table public.register_kinds (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id),        -- null = system default
  key text not null,
  name text not null,
  category text not null default 'other'
    check (category in ('obligation','income','pipeline','exposure','asset','incident','path','other')),
  direction text not null default 'out' check (direction in ('out','in','none')),
  default_certainty text not null default 'scheduled',
  dimension_type text,
  prefix text not null default 'REG',
  fields jsonb not null default '[]'::jsonb,
  sort int not null default 500,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index register_kinds_key on public.register_kinds(coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table public.register_sequences (
  company_id uuid not null references public.companies(id),
  prefix text not null,
  last_no bigint not null default 0,
  primary key (company_id, prefix)
);

create table public.register_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null,
  ref_no text not null,
  title text not null,
  party_id uuid references public.parties(id),
  org_unit_id uuid references public.org_units(id),
  account_id uuid references public.accounts(id),
  direction text not null default 'out' check (direction in ('out','in','none')),
  amount numeric(20,4) not null default 0 check (amount >= 0),
  currency text not null references public.currencies(code),
  frequency text not null default 'once'
    check (frequency in ('once','weekly','monthly','quarterly','half_yearly','yearly')),
  start_date date,
  end_date date,
  next_due date,
  total_value numeric(20,4),
  certainty text not null default 'scheduled'
    check (certainty in ('contracted','committed','scheduled','expected','probable','possible','contingent','forecast')),
  state text not null default 'active'
    check (state in ('proposed','negotiating','quoted','approved','contracted','committed','ordered','delivered','invoiced',
                     'due','paid','received','overdue','cancelled','disputed','forecast','contingent','closed','active',
                     'draft','sent','accepted','rejected','expired','converted','under_review','resolved')),
  auto_renew boolean not null default false,
  renewal_date date,
  cancel_by date,
  escalation_pct numeric(9,4),
  escalation_date date,
  escalation_months int,
  probability numeric(5,2) check (probability is null or (probability >= 0 and probability <= 100)),
  owner_user uuid references public.profiles(id),
  owner_name text,
  confidentiality text not null default 'internal'
    check (confidentiality in ('internal','confidential','highly_confidential','restricted','super_admin_only')),
  notes text,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('draft','active','paused','ended','cancelled','closed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, ref_no)
);
create index register_items_company_idx on public.register_items(company_id, kind, status);
create index register_items_due_idx on public.register_items(company_id, next_due);
create index register_items_party_idx on public.register_items(party_id) where party_id is not null;

create or replace function numero_private.save_register_item(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; v_gid uuid;
  k public.register_kinds; it public.register_items; v_no bigint; v_ref text; v_unit uuid; v_acc public.accounts;
  f jsonb; v_missing text;
begin
  if not numero_private.can(v_company, 'register.manage') then
    raise exception 'NUMERO: you are not authorised to maintain registers for this company.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'NUMERO: a title is required.' using errcode = 'P0001'; end if;
  if coalesce(p->>'confidentiality', 'internal') <> 'internal'
     and not numero_private.can_view_level(v_company, p->>'confidentiality') then
    raise exception 'NUMERO: you cannot create records at a confidentiality level you are not cleared for.' using errcode = '42501';
  end if;
  if p->>'party_id' is not null and not exists (
       select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: unknown party.' using errcode = 'P0001';
  end if;
  if p->>'account_id' is not null then
    select * into v_acc from public.accounts where id = (p->>'account_id')::uuid;
    if not found or v_acc.company_id <> v_company or v_acc.is_group then
      raise exception 'NUMERO: choose a posting account of this company.' using errcode = 'P0001';
    end if;
  end if;
  if p->>'org_unit_id' is not null and not exists (
       select 1 from public.org_units u where u.id = (p->>'org_unit_id')::uuid and u.company_id = v_company) then
    raise exception 'NUMERO: the selected dimension belongs to another company.' using errcode = 'P0001';
  end if;
  if (p->>'end_date') is not null and (p->>'start_date') is not null and (p->>'end_date')::date < (p->>'start_date')::date then
    raise exception 'NUMERO: the end date is before the start date.' using errcode = 'P0001';
  end if;

  if v_id is not null then
    select * into it from public.register_items where id = v_id for update;
    if not found or it.company_id <> v_company then raise exception 'NUMERO: register item not found.' using errcode = 'P0001'; end if;
    if not numero_private.can_view_level(v_company, it.confidentiality) then
      raise exception 'NUMERO: you are not cleared to change this record.' using errcode = '42501';
    end if;
  end if;

  select * into k from public.register_kinds
   where key = coalesce(p->>'kind', it.kind) and (group_id = v_gid or group_id is null) and is_active
   order by (group_id is not null) desc limit 1;
  if not found then raise exception 'NUMERO: unknown register kind %.', coalesce(p->>'kind', it.kind) using errcode = 'P0001'; end if;

  -- required fields of the kind must be present (spec 1792 evidence / completeness rules)
  for f in select * from jsonb_array_elements(k.fields) loop
    if coalesce((f->>'required')::boolean, false)
       and coalesce(trim(p->'data'->>(f->>'key')), '') = '' then
      v_missing := concat_ws(', ', v_missing, f->>'label');
    end if;
  end loop;
  if v_missing is not null then
    raise exception 'NUMERO: required information is missing — %.', v_missing using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.register_sequences(company_id, prefix, last_no) values (v_company, k.prefix, 1)
    on conflict (company_id, prefix) do update set last_no = public.register_sequences.last_no + 1
    returning last_no into v_no;
    v_ref := k.prefix || '-' || lpad(v_no::text, 5, '0');
    v_unit := (p->>'org_unit_id')::uuid;
    if v_unit is null and k.dimension_type is not null and coalesce((p->>'create_dimension')::boolean, true) then
      insert into public.org_units(company_id, type_key, code, name, confidentiality)
      values (v_company, k.dimension_type, v_ref, trim(p->>'title'), coalesce(p->>'confidentiality', 'internal'))
      returning id into v_unit;
    end if;
    insert into public.register_items(company_id, kind, ref_no, title, party_id, org_unit_id, account_id, direction, amount,
      currency, frequency, start_date, end_date, next_due, total_value, certainty, state, auto_renew, renewal_date, cancel_by,
      escalation_pct, escalation_date, escalation_months, probability, owner_user, owner_name, confidentiality, notes, data, status, created_by)
    values (v_company, k.key, v_ref, trim(p->>'title'), (p->>'party_id')::uuid, v_unit, (p->>'account_id')::uuid,
      coalesce(p->>'direction', k.direction), round(coalesce((p->>'amount')::numeric, 0), 2),
      coalesce(p->>'currency', (select base_currency from public.companies where id = v_company)),
      coalesce(p->>'frequency', 'once'), (p->>'start_date')::date, (p->>'end_date')::date,
      coalesce((p->>'next_due')::date, (p->>'start_date')::date), (p->>'total_value')::numeric,
      coalesce(p->>'certainty', k.default_certainty), coalesce(p->>'state', 'active'),
      coalesce((p->>'auto_renew')::boolean, false), (p->>'renewal_date')::date, (p->>'cancel_by')::date,
      (p->>'escalation_pct')::numeric, (p->>'escalation_date')::date, (p->>'escalation_months')::int,
      (p->>'probability')::numeric, (p->>'owner_user')::uuid, p->>'owner_name',
      coalesce(p->>'confidentiality', 'internal'), p->>'notes', coalesce(p->'data', '{}'::jsonb),
      coalesce(p->>'status', 'active'), (select auth.uid()))
    returning id into v_id;
  else
    perform set_config('numero.reason', coalesce(p->>'reason', ''), true);
    update public.register_items set
      title = trim(p->>'title'),
      party_id = (p->>'party_id')::uuid,
      org_unit_id = coalesce((p->>'org_unit_id')::uuid, org_unit_id),
      account_id = (p->>'account_id')::uuid,
      direction = coalesce(p->>'direction', direction),
      amount = round(coalesce((p->>'amount')::numeric, amount), 2),
      currency = coalesce(p->>'currency', currency),
      frequency = coalesce(p->>'frequency', frequency),
      start_date = (p->>'start_date')::date,
      end_date = (p->>'end_date')::date,
      next_due = (p->>'next_due')::date,
      total_value = (p->>'total_value')::numeric,
      certainty = coalesce(p->>'certainty', certainty),
      state = coalesce(p->>'state', state),
      auto_renew = coalesce((p->>'auto_renew')::boolean, auto_renew),
      renewal_date = (p->>'renewal_date')::date,
      cancel_by = (p->>'cancel_by')::date,
      escalation_pct = (p->>'escalation_pct')::numeric,
      escalation_date = (p->>'escalation_date')::date,
      escalation_months = (p->>'escalation_months')::int,
      probability = (p->>'probability')::numeric,
      owner_user = (p->>'owner_user')::uuid,
      owner_name = p->>'owner_name',
      confidentiality = coalesce(p->>'confidentiality', confidentiality),
      notes = p->>'notes',
      data = coalesce(p->'data', data),
      status = coalesce(p->>'status', status),
      updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;
create or replace function public.save_register_item(p jsonb) returns uuid language sql set search_path = '' as $$
  select numero_private.save_register_item(p); $$;

-- >>> applied as migration 20260927072515 · p2_04_register_kinds_seed
-- ---------- register kinds (generated from src/engine/registerKinds.json) ----------
insert into public.register_kinds(key, name, category, direction, default_certainty, dimension_type, prefix, sort, fields) values
  ('subscription', 'Subscription', 'obligation', 'out', 'scheduled', null, 'SUB', 10, '[{"key": "plan", "label": "Plan", "type": "text"}, {"key": "seats", "label": "Seats / licences", "type": "number"}, {"key": "used_by", "label": "Used by (team or person)", "type": "text"}, {"key": "payment_method", "label": "Paid through", "type": "select", "options": ["Bank transfer", "Corporate card", "Auto-debit", "UPI", "Other"]}, {"key": "login_owner", "label": "Account owner", "type": "text"}]'::jsonb),
  ('software_licence', 'Software Licence', 'obligation', 'out', 'contracted', null, 'LIC', 20, '[{"key": "licence_key_ref", "label": "Licence reference", "type": "text"}, {"key": "seats", "label": "Seats", "type": "number"}, {"key": "used_by", "label": "Used by", "type": "text"}]'::jsonb),
  ('domain_hosting', 'Domain & Hosting', 'obligation', 'out', 'scheduled', null, 'DOM', 30, '[{"key": "domain", "label": "Domain / service", "type": "text", "required": true}, {"key": "registrar", "label": "Registrar / host", "type": "text"}, {"key": "expiry", "label": "Expiry date", "type": "date", "alert": true}]'::jsonb),
  ('insurance', 'Insurance Policy', 'obligation', 'out', 'contracted', null, 'INS', 40, '[{"key": "policy_no", "label": "Policy number", "type": "text", "required": true}, {"key": "cover_type", "label": "Cover", "type": "select", "options": ["Vehicle", "Office", "Equipment", "Marine", "Liability", "Health", "Life", "Fire", "Other"]}, {"key": "sum_insured", "label": "Sum insured", "type": "money"}, {"key": "insured_object", "label": "What is insured", "type": "text"}, {"key": "expiry", "label": "Policy expiry", "type": "date", "alert": true}]'::jsonb),
  ('rent', 'Rent (premises we occupy)', 'obligation', 'out', 'contracted', null, 'RNT', 50, '[{"key": "premises", "label": "Premises", "type": "text", "required": true}, {"key": "deposit", "label": "Security deposit paid", "type": "money"}, {"key": "lock_in_until", "label": "Lock-in until", "type": "date"}, {"key": "notice_days", "label": "Notice period (days)", "type": "number"}]'::jsonb),
  ('lease', 'Lease', 'obligation', 'out', 'contracted', null, 'LSE', 60, '[{"key": "leased_object", "label": "What is leased", "type": "text", "required": true}, {"key": "deposit", "label": "Deposit", "type": "money"}, {"key": "lock_in_until", "label": "Lock-in until", "type": "date"}]'::jsonb),
  ('amc', 'Service / AMC Contract', 'obligation', 'out', 'contracted', null, 'AMC', 70, '[{"key": "covered_object", "label": "What is covered", "type": "text"}, {"key": "visits_per_year", "label": "Visits per year", "type": "number"}, {"key": "expiry", "label": "Cover ends", "type": "date", "alert": true}]'::jsonb),
  ('retainer', 'Retainer / Professional Fees', 'obligation', 'out', 'contracted', null, 'RET', 80, '[{"key": "scope", "label": "Scope of work", "type": "text"}]'::jsonb),
  ('utility', 'Utility (estimate)', 'obligation', 'out', 'expected', null, 'UTL', 90, '[{"key": "connection_no", "label": "Connection / consumer number", "type": "text"}, {"key": "premises", "label": "Premises", "type": "text"}]'::jsonb),
  ('contract_expense', 'Contract — we pay', 'obligation', 'out', 'contracted', 'contract', 'CTE', 100, '[{"key": "milestones", "label": "Milestones", "type": "text"}, {"key": "retention_pct", "label": "Retention %", "type": "number"}, {"key": "penalty_clause", "label": "Penalty clause", "type": "text"}]'::jsonb),
  ('credit_card', 'Credit / Corporate Card', 'obligation', 'out', 'expected', null, 'CRD', 110, '[{"key": "card_last4", "label": "Card (last 4 digits)", "type": "text"}, {"key": "holder", "label": "Card holder", "type": "text"}, {"key": "credit_limit", "label": "Limit", "type": "money"}, {"key": "statement_day", "label": "Statement day of month", "type": "number"}, {"key": "due_day", "label": "Payment due day of month", "type": "number"}]'::jsonb),
  ('compliance', 'Tax / Compliance Deadline', 'obligation', 'out', 'expected', null, 'CMP', 120, '[{"key": "requirement", "label": "Requirement", "type": "select", "options": ["GST", "TDS", "Income Tax", "Payroll statutory", "Corporate filing", "Audit", "Licence", "Other"], "required": true}, {"key": "period_covered", "label": "Period covered", "type": "text"}, {"key": "reviewer", "label": "Reviewer", "type": "text"}, {"key": "estimate_basis", "label": "How the amount was estimated", "type": "text"}]'::jsonb),
  ('csr_donation', 'CSR / Donation Commitment', 'obligation', 'out', 'committed', null, 'CSR', 130, '[{"key": "beneficiary_purpose", "label": "Purpose", "type": "text"}, {"key": "approval_ref", "label": "Approval reference", "type": "text"}]'::jsonb),
  ('dividend', 'Dividend / Distribution', 'obligation', 'out', 'expected', null, 'DIV', 140, '[{"key": "declared_on", "label": "Declared on", "type": "date"}, {"key": "approval_ref", "label": "Board / approval reference", "type": "text"}]'::jsonb),
  ('contract_revenue', 'Contract — we receive', 'income', 'in', 'contracted', 'contract', 'CTR', 200, '[{"key": "milestones", "label": "Milestones", "type": "text"}, {"key": "retention_pct", "label": "Retention %", "type": "number"}, {"key": "recognition_basis", "label": "Approved revenue recognition basis", "type": "text"}]'::jsonb),
  ('sales_order', 'Sales Order', 'income', 'in', 'committed', null, 'SO', 210, '[{"key": "items", "label": "Products / services", "type": "text"}, {"key": "delivery_date", "label": "Delivery date", "type": "date"}]'::jsonb),
  ('tenant_lease', 'Tenant Lease (we are landlord)', 'income', 'in', 'contracted', 'property', 'TEN', 220, '[{"key": "unit", "label": "Unit / premises", "type": "text", "required": true}, {"key": "deposit", "label": "Deposit received", "type": "money"}, {"key": "cam", "label": "Maintenance (CAM) per period", "type": "money"}]'::jsonb),
  ('capital_call', 'Capital Call / Contribution', 'income', 'in', 'expected', null, 'CAP', 230, '[{"key": "commitment", "label": "Total commitment", "type": "money"}, {"key": "called_to_date", "label": "Called to date", "type": "money"}]'::jsonb),
  ('capital_infusion', 'Capital Infusion', 'income', 'in', 'expected', null, 'CIN', 240, '[{"key": "instrument", "label": "Instrument", "type": "select", "options": ["Equity", "Preference", "Convertible", "Shareholder loan", "Other"]}]'::jsonb),
  ('quotation', 'Quotation (sent to customer)', 'pipeline', 'in', 'possible', null, 'QUO', 300, '[{"key": "items", "label": "Products / services", "type": "text"}, {"key": "valid_until", "label": "Valid until", "type": "date", "alert": true}]'::jsonb),
  ('negotiation', 'Negotiation', 'pipeline', 'none', 'possible', null, 'NEG', 310, '[{"key": "proposed_value", "label": "Proposed value", "type": "money"}, {"key": "commercial_terms", "label": "Commercial terms", "type": "text"}, {"key": "decision_date", "label": "Expected decision date", "type": "date"}]'::jsonb),
  ('asset_purchase', 'Planned Asset Purchase', 'pipeline', 'out', 'expected', null, 'APP', 320, '[{"key": "asset_description", "label": "Asset", "type": "text"}, {"key": "justification", "label": "Justification", "type": "text"}]'::jsonb),
  ('asset_sale', 'Planned Asset Sale', 'pipeline', 'in', 'possible', null, 'ASL', 330, '[{"key": "asset_description", "label": "Asset", "type": "text"}]'::jsonb),
  ('customer_refund', 'Customer Refund Due', 'pipeline', 'out', 'committed', null, 'RFD', 340, '[{"key": "refund_reason", "label": "Reason", "type": "text"}, {"key": "original_reference", "label": "Original invoice / receipt", "type": "text"}]'::jsonb),
  ('commission', 'Commission Entitlement', 'pipeline', 'out', 'possible', null, 'COM', 350, '[{"key": "basis", "label": "Basis", "type": "text"}, {"key": "stage", "label": "Stage", "type": "select", "options": ["Potential", "Earned", "Pending approval", "Approved", "Payable", "Paid", "Clawed back"]}]'::jsonb),
  ('bank_guarantee', 'Bank Guarantee', 'exposure', 'none', 'contingent', null, 'BG', 400, '[{"key": "guarantee_type", "label": "Type", "type": "select", "options": ["Performance", "Financial", "Bid bond", "Advance payment", "Other"]}, {"key": "beneficiary", "label": "Beneficiary", "type": "text", "required": true}, {"key": "issuing_bank", "label": "Issuing bank", "type": "text"}, {"key": "margin_amount", "label": "Margin money held", "type": "money"}, {"key": "commission", "label": "Commission / fees", "type": "money"}, {"key": "expiry", "label": "Expiry", "type": "date", "alert": true}, {"key": "claim_expiry", "label": "Claim expiry", "type": "date", "alert": true}]'::jsonb),
  ('corporate_guarantee', 'Corporate Guarantee', 'exposure', 'none', 'contingent', null, 'CG', 410, '[{"key": "beneficiary", "label": "In favour of", "type": "text", "required": true}, {"key": "on_behalf_of", "label": "On behalf of", "type": "text"}, {"key": "expiry", "label": "Expiry", "type": "date", "alert": true}]'::jsonb),
  ('letter_of_credit', 'Letter of Credit', 'exposure', 'out', 'committed', null, 'LC', 420, '[{"key": "lc_no", "label": "LC number", "type": "text"}, {"key": "issuing_bank", "label": "Issuing bank", "type": "text"}, {"key": "margin_amount", "label": "Margin", "type": "money"}, {"key": "settlement_date", "label": "Settlement date", "type": "date", "alert": true}, {"key": "expiry", "label": "Expiry", "type": "date", "alert": true}]'::jsonb),
  ('credit_facility', 'Credit Facility', 'exposure', 'none', 'contracted', null, 'FAC', 430, '[{"key": "facility_type", "label": "Type", "type": "select", "options": ["Overdraft", "Cash credit", "Working capital", "Term loan limit", "Bill discounting", "Other"]}, {"key": "sanctioned_limit", "label": "Sanctioned limit", "type": "money", "required": true}, {"key": "drawn", "label": "Drawn (as last updated)", "type": "money"}, {"key": "security", "label": "Security", "type": "text"}, {"key": "review_date", "label": "Renewal / review date", "type": "date", "alert": true}]'::jsonb),
  ('covenant', 'Loan Covenant', 'exposure', 'none', 'contracted', null, 'COV', 440, '[{"key": "covenant", "label": "Covenant", "type": "text", "required": true}, {"key": "threshold", "label": "Threshold", "type": "text"}, {"key": "test_date", "label": "Next test date", "type": "date", "alert": true}]'::jsonb),
  ('legal_claim', 'Legal Case / Claim', 'exposure', 'out', 'contingent', null, 'LGL', 450, '[{"key": "case_no", "label": "Case number", "type": "text"}, {"key": "forum", "label": "Court / forum", "type": "text"}, {"key": "legal_status", "label": "Legal status", "type": "text"}, {"key": "probability_class", "label": "Probability (as assessed by counsel)", "type": "select", "options": ["Not assessed", "Remote", "Possible", "Probable"]}, {"key": "assessed_by", "label": "Assessed by", "type": "text"}, {"key": "accounting_treatment", "label": "Approved accounting treatment", "type": "text"}, {"key": "next_hearing", "label": "Next hearing", "type": "date", "alert": true}]'::jsonb),
  ('contingent_liability', 'Contingent Liability', 'exposure', 'out', 'contingent', null, 'CNT', 460, '[{"key": "nature", "label": "Nature", "type": "select", "options": ["Lawsuit", "Guarantee", "Disputed tax", "Warranty claim", "Contract dispute", "Other"]}, {"key": "accounting_treatment", "label": "Approved accounting treatment", "type": "text"}]'::jsonb),
  ('warranty', 'Warranty Given', 'exposure', 'out', 'contingent', null, 'WAR', 470, '[{"key": "product", "label": "Product", "type": "text"}, {"key": "known_claims", "label": "Known claims", "type": "money"}]'::jsonb),
  ('security_deposit_paid', 'Security Deposit Paid', 'exposure', 'in', 'expected', null, 'SDP', 480, '[{"key": "held_by", "label": "Held by", "type": "text"}, {"key": "refund_conditions", "label": "Refund conditions", "type": "text"}]'::jsonb),
  ('security_deposit_received', 'Security Deposit Received', 'exposure', 'out', 'expected', null, 'SDR', 490, '[{"key": "refund_conditions", "label": "Refund conditions", "type": "text"}]'::jsonb),
  ('retention', 'Retention Money', 'exposure', 'out', 'contracted', null, 'RTN', 495, '[{"key": "release_conditions", "label": "Release conditions", "type": "text"}, {"key": "released", "label": "Released to date", "type": "money"}]'::jsonb),
  ('vehicle', 'Vehicle', 'asset', 'none', 'scheduled', 'vehicle', 'VEH', 500, '[{"key": "registration_no", "label": "Registration number", "type": "text", "required": true}, {"key": "make_model", "label": "Make and model", "type": "text"}, {"key": "fuel_type", "label": "Fuel", "type": "select", "options": ["Petrol", "Diesel", "CNG", "Electric", "Hybrid"]}, {"key": "ownership", "label": "Ownership", "type": "select", "options": ["Owned", "Leased", "Hired", "Employee-owned"]}, {"key": "driver", "label": "Driver / assigned to", "type": "text"}, {"key": "fastag_id", "label": "FASTag / toll tag", "type": "text"}, {"key": "fuel_card", "label": "Fuel card", "type": "text"}, {"key": "odometer", "label": "Odometer (km, as last updated)", "type": "number"}, {"key": "insurance_expiry", "label": "Insurance expiry", "type": "date", "alert": true}, {"key": "puc_expiry", "label": "Pollution certificate expiry", "type": "date", "alert": true}, {"key": "fitness_expiry", "label": "Fitness certificate expiry", "type": "date", "alert": true}, {"key": "permit_expiry", "label": "Permit expiry", "type": "date", "alert": true}, {"key": "road_tax_expiry", "label": "Road tax valid until", "type": "date", "alert": true}, {"key": "next_service", "label": "Next service due", "type": "date", "alert": true}]'::jsonb),
  ('property', 'Property', 'asset', 'none', 'scheduled', 'property', 'PRP', 510, '[{"key": "property_type", "label": "Type", "type": "select", "options": ["Owned", "Leased", "Rental", "Office", "Warehouse", "Land", "Commercial unit", "Guest house"]}, {"key": "address", "label": "Address", "type": "text"}, {"key": "area", "label": "Area", "type": "text"}, {"key": "property_tax_due", "label": "Property tax due", "type": "date", "alert": true}]'::jsonb),
  ('incident', 'Incident', 'incident', 'none', 'possible', 'event', 'INC', 600, '[{"key": "incident_type", "label": "Type", "type": "select", "options": ["Accident", "Damage", "Theft", "Loss", "Emergency", "Disaster", "Cyber", "Extortion / coercion reported", "Improper payment reported", "Off-book transaction reported", "Whistleblower report", "Other"], "required": true}, {"key": "incident_date", "label": "Date of incident", "type": "date", "required": true}, {"key": "location", "label": "Location", "type": "text"}, {"key": "reported_by", "label": "Reported by", "type": "text"}, {"key": "estimated_loss", "label": "Estimated financial loss", "type": "money"}, {"key": "recovered", "label": "Recovered to date", "type": "money"}, {"key": "insurance_claim_ref", "label": "Insurance claim reference", "type": "text"}, {"key": "authority_report_ref", "label": "Report to authorities (reference)", "type": "text"}, {"key": "reviewed_by", "label": "Reviewed by", "type": "text"}]'::jsonb),
  ('insurance_claim', 'Insurance Claim', 'incident', 'in', 'possible', null, 'ICL', 610, '[{"key": "policy_no", "label": "Policy number", "type": "text"}, {"key": "claim_no", "label": "Claim number", "type": "text"}, {"key": "claimed", "label": "Amount claimed", "type": "money"}, {"key": "approved_by_insurer", "label": "Approved by insurer", "type": "money"}, {"key": "received", "label": "Received", "type": "money"}]'::jsonb),
  ('dispute', 'Dispute', 'incident', 'none', 'possible', null, 'DSP', 620, '[{"key": "disputed_document", "label": "Disputed document / reference", "type": "text"}, {"key": "disputed_amount", "label": "Disputed amount", "type": "money"}, {"key": "raised_by", "label": "Raised by", "type": "select", "options": ["Us", "Counterparty"]}, {"key": "position", "label": "Our position", "type": "text"}, {"key": "resolution", "label": "Resolution", "type": "text"}]'::jsonb),
  ('recovery', 'Recovery Case', 'incident', 'in', 'possible', null, 'REC', 630, '[{"key": "recovering_from", "label": "What is being recovered", "type": "text"}, {"key": "recovered", "label": "Recovered to date", "type": "money"}, {"key": "method", "label": "Method", "type": "select", "options": ["Follow-up", "Negotiation", "Legal", "Insurance", "Payroll recovery", "Other"]}]'::jsonb),
  ('write_off', 'Write-off Request', 'incident', 'none', 'possible', null, 'WOF', 640, '[{"key": "what", "label": "What is proposed to be written off", "type": "text", "required": true}, {"key": "justification", "label": "Justification", "type": "text", "required": true}, {"key": "efforts", "label": "Recovery efforts made", "type": "text"}, {"key": "approved_by", "label": "Approved by", "type": "text"}, {"key": "journal_ref", "label": "Write-off journal (voucher no.)", "type": "text"}, {"key": "recovered_after", "label": "Recovered after write-off", "type": "money"}]'::jsonb),
  ('bad_debt', 'Doubtful / Bad Debt', 'incident', 'none', 'possible', null, 'BDT', 650, '[{"key": "invoice_refs", "label": "Invoices concerned", "type": "text"}, {"key": "provision", "label": "Provision recorded", "type": "money"}, {"key": "assessment", "label": "Assessment (by finance)", "type": "text"}]'::jsonb),
  ('exception', 'Exceptional Transaction', 'incident', 'none', 'possible', null, 'EXC', 660, '[{"key": "nature", "label": "Nature", "type": "select", "options": ["Emergency expenditure", "Unplanned expense", "Settlement", "Fine / penalty", "Cancellation loss", "No-show cost", "Wastage", "Other"], "required": true}, {"key": "voucher_ref", "label": "Voucher reference", "type": "text"}, {"key": "approved_by", "label": "Approved by", "type": "text"}, {"key": "explanation", "label": "Explanation", "type": "text", "required": true}]'::jsonb),
  ('path', 'Financial Path', 'path', 'none', 'scheduled', 'path', 'PTH', 700, '[{"key": "path_type", "label": "Path type", "type": "select", "options": ["Personal", "Petty", "Travel", "Site", "Charity", "Emergency", "Department wallet", "Project", "Other"], "required": true}, {"key": "purpose", "label": "Purpose", "type": "text", "required": true}, {"key": "monthly_limit", "label": "Monthly limit", "type": "money"}, {"key": "evidence_rule", "label": "Evidence required", "type": "select", "options": ["Receipt for every spend", "Receipt above a limit", "Summary statement", "As per company policy"]}, {"key": "settlement_rule", "label": "Settlement rule", "type": "select", "options": ["Settle monthly", "Settle per trip / event", "Settle on completion", "Imprest — top up to float"]}, {"key": "settle_within_days", "label": "Settle within (days)", "type": "number"}]'::jsonb),
  ('trip', 'Trip', 'path', 'out', 'expected', 'trip', 'TRP', 710, '[{"key": "traveller", "label": "Traveller", "type": "text", "required": true}, {"key": "from_place", "label": "From", "type": "text"}, {"key": "to_place", "label": "To", "type": "text", "required": true}, {"key": "purpose", "label": "Business purpose", "type": "text", "required": true}, {"key": "travel_mode", "label": "Mode", "type": "select", "options": ["Air", "Train", "Road", "Mixed"]}, {"key": "international", "label": "Foreign travel", "type": "boolean"}, {"key": "per_diem", "label": "Daily allowance", "type": "money"}, {"key": "client", "label": "Client / project", "type": "text"}]'::jsonb),
  ('event', 'Event / Meeting / Conference', 'path', 'out', 'expected', 'event', 'EVT', 720, '[{"key": "event_type", "label": "Type", "type": "select", "options": ["Conference", "Seminar", "Board meeting", "Client event", "Team outing", "Training", "Exhibition", "Other"]}, {"key": "venue", "label": "Venue", "type": "text"}, {"key": "attendees", "label": "Attendees", "type": "number"}, {"key": "purpose", "label": "Purpose", "type": "text"}]'::jsonb),
  ('work_order', 'Work Order (construction / project)', 'path', 'out', 'contracted', 'project', 'WO', 730, '[{"key": "work_completed", "label": "Work completed (value)", "type": "money"}, {"key": "certified", "label": "Certified", "type": "money"}, {"key": "retention_pct", "label": "Retention %", "type": "number"}, {"key": "retention_held", "label": "Retention held", "type": "money"}, {"key": "estimated_remaining", "label": "Estimated cost to complete", "type": "money"}, {"key": "estimate_by", "label": "Estimate prepared by", "type": "text"}]'::jsonb),
  ('other', 'Other', 'other', 'none', 'expected', null, 'REG', 900, '[]'::jsonb)
on conflict (coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do update set
  name = excluded.name, category = excluded.category, direction = excluded.direction,
  default_certainty = excluded.default_certainty, dimension_type = excluded.dimension_type,
  prefix = excluded.prefix, sort = excluded.sort, fields = excluded.fields;

-- >>> applied as migration 20260927072538 · p2_05_tasks
-- ---------- tasks & follow-ups (spec 145) ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entity text,
  entity_id uuid,
  title text not null,
  detail text,
  due_date date,
  owner_user uuid references public.profiles(id),
  owner_name text,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  outcome text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  completed_by uuid,
  completed_at timestamptz
);
create index tasks_company_idx on public.tasks(company_id, status, due_date);
create index tasks_entity_idx on public.tasks(entity, entity_id);

create or replace function numero_private.save_task(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p->>'company_id')::uuid; v_id uuid := (p->>'id')::uuid; t public.tasks; v_status text;
begin
  if not numero_private.has_company_access(v_company) then
    raise exception 'NUMERO: you do not have access to this company.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'NUMERO: the task needs a title.' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.tasks(company_id, entity, entity_id, title, detail, due_date, owner_user, owner_name, priority, created_by)
    values (v_company, p->>'entity', (p->>'entity_id')::uuid, trim(p->>'title'), p->>'detail', (p->>'due_date')::date,
            (p->>'owner_user')::uuid, p->>'owner_name', coalesce(p->>'priority', 'normal'), (select auth.uid()))
    returning id into v_id;
    return v_id;
  end if;
  select * into t from public.tasks where id = v_id for update;
  if not found or t.company_id <> v_company then raise exception 'NUMERO: task not found.' using errcode = 'P0001'; end if;
  if t.status in ('done','cancelled') then raise exception 'NUMERO: this task is already %.', t.status using errcode = 'P0001'; end if;
  v_status := coalesce(p->>'status', t.status);
  if v_status in ('done','cancelled') and coalesce(trim(p->>'outcome'), '') = '' then
    raise exception 'NUMERO: record the outcome when closing a task.' using errcode = 'P0001';
  end if;
  update public.tasks set title = trim(p->>'title'), detail = p->>'detail', due_date = (p->>'due_date')::date,
    owner_user = (p->>'owner_user')::uuid, owner_name = p->>'owner_name',
    priority = coalesce(p->>'priority', priority), status = v_status, outcome = p->>'outcome',
    completed_by = case when v_status in ('done','cancelled') then (select auth.uid()) end,
    completed_at = case when v_status in ('done','cancelled') then now() end
  where id = v_id;
  return v_id;
end $$;
create or replace function public.save_task(p jsonb) returns uuid language sql set search_path = '' as $$
  select numero_private.save_task(p); $$;

-- >>> applied as migration 20260927072638 · p2_06_document_vault_privileges
-- =====================================================================
-- 4. DOCUMENT VAULT
-- Files live in a private storage bucket, one folder per company.
-- A document is evidence: its facts never change and it is never deleted.
-- =====================================================================
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  mime text,
  size_bytes bigint not null default 0,
  sha256 text not null,
  storage_path text not null,
  doc_kind text not null default 'unclassified',
  status text not null default 'received' check (status in ('received','classified','linked','processed','rejected')),
  party_id uuid references public.parties(id),
  doc_date date,
  amount numeric(20,4),
  currency text references public.currencies(code),
  reference text,
  expires_on date,
  duplicate_of uuid references public.documents(id),
  confidentiality text not null default 'internal'
    check (confidentiality in ('internal','confidential','highly_confidential','restricted','super_admin_only')),
  notes text,
  origin text not null default 'upload',
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now(),
  unique (company_id, storage_path)
);
create index documents_company_idx on public.documents(company_id, status, uploaded_at desc);
create index documents_hash_idx on public.documents(company_id, sha256);

create table public.document_links (
  document_id uuid not null references public.documents(id),
  entity text not null,
  entity_id uuid not null,
  company_id uuid not null references public.companies(id),
  linked_by uuid default auth.uid(),
  linked_at timestamptz not null default now(),
  primary key (document_id, entity, entity_id)
);
create index document_links_entity_idx on public.document_links(entity, entity_id);

create or replace function numero_private.guard_document() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'NUMERO: documents are evidence and cannot be deleted. Mark the document rejected instead.' using errcode = 'P0001';
  end if;
  if new.sha256 is distinct from old.sha256 or new.storage_path is distinct from old.storage_path
     or new.company_id is distinct from old.company_id or new.size_bytes is distinct from old.size_bytes
     or new.uploaded_by is distinct from old.uploaded_by or new.uploaded_at is distinct from old.uploaded_at then
    raise exception 'NUMERO: the recorded facts of a document cannot be altered.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger documents_guard before update or delete on public.documents
  for each row execute function numero_private.guard_document();

create or replace function numero_private.register_document(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := (p->>'company_id')::uuid; v_id uuid; v_dups jsonb; v_first uuid; v_gid uuid;
  v_path text := p->>'storage_path';
begin
  if not numero_private.can(v_company, 'document.upload') then
    raise exception 'NUMERO: you are not authorised to add documents for this company.' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'name'), '') = '' or coalesce(p->>'sha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'NUMERO: a document needs a name and a valid fingerprint.' using errcode = 'P0001';
  end if;
  if v_path is null or split_part(v_path, '/', 1) <> v_company::text then
    raise exception 'NUMERO: the file is not stored in this company''s folder.' using errcode = 'P0001';
  end if;
  select group_id into v_gid from public.companies where id = v_company;
  if p->>'party_id' is not null and not exists (
       select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: unknown party.' using errcode = 'P0001';
  end if;

  select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'uploaded_at', d.uploaded_at, 'reason', 'identical file content')
                   order by d.uploaded_at),
         (array_agg(d.id order by d.uploaded_at))[1]
    into v_dups, v_first
    from public.documents d
   where d.company_id = v_company and d.sha256 = p->>'sha256';

  insert into public.documents(company_id, name, mime, size_bytes, sha256, storage_path, doc_kind, status, party_id, doc_date,
                               amount, currency, reference, expires_on, duplicate_of, confidentiality, notes, origin, uploaded_by)
  values (v_company, trim(p->>'name'), p->>'mime', coalesce((p->>'size_bytes')::bigint, 0), p->>'sha256', v_path,
          coalesce(nullif(p->>'doc_kind', ''), 'unclassified'),
          case when coalesce(nullif(p->>'doc_kind', ''), 'unclassified') = 'unclassified' then 'received' else 'classified' end,
          (p->>'party_id')::uuid, (p->>'doc_date')::date, (p->>'amount')::numeric, nullif(p->>'currency', ''),
          nullif(p->>'reference', ''), (p->>'expires_on')::date, v_first,
          coalesce(p->>'confidentiality', 'internal'), p->>'notes', coalesce(p->>'origin', 'upload'), (select auth.uid()))
  returning id into v_id;

  if p->>'entity' is not null and p->>'entity_id' is not null then
    insert into public.document_links(document_id, entity, entity_id, company_id)
    values (v_id, p->>'entity', (p->>'entity_id')::uuid, v_company) on conflict do nothing;
    update public.documents set status = 'linked' where id = v_id;
  end if;

  if v_first is not null then
    insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
    values (v_company, 'duplicate_document', 'review', 'POSSIBLE DUPLICATE — identical file already in the vault',
      'The file "' || trim(p->>'name') || '" has exactly the same content as a document recorded earlier. It was kept, not discarded, and is flagged for human review.',
      jsonb_build_object('document_id', v_id, 'matches', v_dups, 'rule', 'same company + identical SHA-256 fingerprint'),
      'documents', v_id, 'dupdoc:' || v_id::text)
    on conflict (company_id, dedupe_key) do nothing;
  end if;
  return jsonb_build_object('id', v_id, 'possible_duplicates', coalesce(v_dups, '[]'::jsonb));
end $$;

create or replace function numero_private.classify_document(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.documents; v_gid uuid; v_status text;
begin
  select * into d from public.documents where id = p_id for update;
  if not found then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'document.upload') then
    raise exception 'NUMERO: you are not authorised to classify documents.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = d.company_id;
  if p->>'party_id' is not null and not exists (
       select 1 from public.parties x where x.id = (p->>'party_id')::uuid and x.group_id = v_gid) then
    raise exception 'NUMERO: unknown party.' using errcode = 'P0001';
  end if;
  v_status := coalesce(p->>'status', case when d.status = 'received' then 'classified' else d.status end);
  if v_status = 'rejected' and coalesce(trim(p->>'notes'), '') = '' then
    raise exception 'NUMERO: a note is required when rejecting a document.' using errcode = 'P0001';
  end if;
  update public.documents set
    doc_kind = coalesce(nullif(p->>'doc_kind', ''), doc_kind),
    party_id = case when p ? 'party_id' then (p->>'party_id')::uuid else party_id end,
    doc_date = case when p ? 'doc_date' then (p->>'doc_date')::date else doc_date end,
    amount = case when p ? 'amount' then (p->>'amount')::numeric else amount end,
    currency = case when p ? 'currency' then nullif(p->>'currency', '') else currency end,
    reference = case when p ? 'reference' then nullif(p->>'reference', '') else reference end,
    expires_on = case when p ? 'expires_on' then (p->>'expires_on')::date else expires_on end,
    notes = case when p ? 'notes' then p->>'notes' else notes end,
    confidentiality = coalesce(p->>'confidentiality', confidentiality),
    status = v_status
  where id = p_id;
end $$;

create or replace function numero_private.link_document(p_id uuid, p_entity text, p_entity_id uuid, p_remove boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  select * into d from public.documents where id = p_id for update;
  if not found then raise exception 'NUMERO: document not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(d.company_id, 'document.upload') then
    raise exception 'NUMERO: you are not authorised to link documents.' using errcode = '42501';
  end if;
  if coalesce(p_entity, '') = '' or p_entity_id is null then
    raise exception 'NUMERO: choose the record to link this document to.' using errcode = 'P0001';
  end if;
  if coalesce(p_remove, false) then
    delete from public.document_links where document_id = p_id and entity = p_entity and entity_id = p_entity_id;
    perform numero_private.log_event(d.company_id, 'documents', p_id, 'unlinked', jsonb_build_object('entity', p_entity, 'entity_id', p_entity_id), null, null);
  else
    insert into public.document_links(document_id, entity, entity_id, company_id)
    values (p_id, p_entity, p_entity_id, d.company_id) on conflict do nothing;
    update public.documents set status = 'linked' where id = p_id and status in ('received','classified');
    perform numero_private.log_event(d.company_id, 'documents', p_id, 'linked', null, jsonb_build_object('entity', p_entity, 'entity_id', p_entity_id), null);
  end if;
end $$;

create or replace function public.register_document(p jsonb) returns jsonb language sql set search_path = '' as $$
  select numero_private.register_document(p); $$;
create or replace function public.classify_document(p_id uuid, p jsonb) returns void language sql set search_path = '' as $$
  select numero_private.classify_document(p_id, p); $$;
create or replace function public.link_document(p_id uuid, p_entity text, p_entity_id uuid, p_remove boolean default false) returns void
language sql set search_path = '' as $$ select numero_private.link_document(p_id, p_entity, p_entity_id, p_remove); $$;

-- ---------- private storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('numero-documents', 'numero-documents', false, 26214400)
on conflict (id) do nothing;

create or replace function numero_private.path_company(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

create policy numero_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'numero-documents'
         and (select numero_private.can(numero_private.path_company(name), 'document.view')));
create policy numero_documents_add on storage.objects for insert to authenticated
  with check (bucket_id = 'numero-documents'
         and (select numero_private.can(numero_private.path_company(name), 'document.upload')));
-- no update and no delete policy: stored evidence is never replaced or removed by a client

-- ---------- custom field values: controlled write ----------
create or replace function numero_private.save_custom_values(p_company uuid, p_entity text, p_entity_id uuid, p_values jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid; d public.custom_field_defs; n int := 0; v jsonb; v_missing text;
begin
  if not numero_private.has_company_access(p_company) then
    raise exception 'NUMERO: you do not have access to this company.' using errcode = '42501';
  end if;
  select group_id into v_gid from public.companies where id = p_company;
  for d in select * from public.custom_field_defs f
            where f.group_id = v_gid and f.entity = p_entity and f.status = 'active'
              and (f.company_id is null or f.company_id = p_company) loop
    v := p_values -> d.key;
    if d.is_required and (v is null or v = 'null'::jsonb or trim(both '"' from v::text) = '') then
      v_missing := concat_ws(', ', v_missing, d.label);
      continue;
    end if;
    if p_values ? d.key then
      insert into public.custom_field_values(field_id, entity_id, company_id, value, updated_by, updated_at)
      values (d.id, p_entity_id, p_company, v, (select auth.uid()), now())
      on conflict (field_id, entity_id) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
      n := n + 1;
    end if;
  end loop;
  if v_missing is not null then
    raise exception 'NUMERO: required information is missing — %.', v_missing using errcode = 'P0001';
  end if;
  return n;
end $$;
create or replace function public.save_custom_values(p_company uuid, p_entity text, p_entity_id uuid, p_values jsonb) returns int
language sql set search_path = '' as $$ select numero_private.save_custom_values(p_company, p_entity, p_entity_id, p_values); $$;

-- ---------- audit ----------
create trigger audit_register_items after insert or update or delete on public.register_items
  for each row execute function numero_private.audit_row();
create trigger audit_register_kinds after insert or update or delete on public.register_kinds
  for each row execute function numero_private.audit_row();
create trigger audit_tasks after insert or update or delete on public.tasks
  for each row execute function numero_private.audit_row();
create trigger audit_documents after insert or update on public.documents
  for each row execute function numero_private.audit_row();
create trigger audit_custom_values after insert or update or delete on public.custom_field_values
  for each row execute function numero_private.audit_row();

-- ---------- row level security ----------
alter table public.register_kinds enable row level security;
alter table public.register_sequences enable row level security;
alter table public.register_items enable row level security;
alter table public.tasks enable row level security;
alter table public.documents enable row level security;
alter table public.document_links enable row level security;

create policy register_kinds_select on public.register_kinds for select to authenticated
  using (group_id is null or group_id = (select numero_private.my_group()));
create policy register_kinds_write on public.register_kinds for all to authenticated
  using (group_id is not null and (select numero_private.is_group_admin(group_id)))
  with check (group_id is not null and (select numero_private.is_group_admin(group_id)));

create policy register_items_select on public.register_items for select to authenticated
  using ((select numero_private.can(company_id, 'register.view'))
         and (select numero_private.can_view_level(company_id, confidentiality)));

create policy tasks_select on public.tasks for select to authenticated
  using ((select numero_private.has_company_access(company_id)));

create policy documents_select on public.documents for select to authenticated
  using (((select numero_private.can(company_id, 'document.view')) or uploaded_by = (select auth.uid()))
         and (select numero_private.can_view_level(company_id, confidentiality)));
create policy document_links_select on public.document_links for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));

-- ---------- privileges ----------
-- Internal functions are reachable only from inside other controlled functions.
-- Every migration registers the internal functions it adds, then calls lock_internals().
create table numero_private.internal_functions (name text primary key);
insert into numero_private.internal_functions(name) values
  ('do_post'), ('propose_posting'), ('write_journal_lines'), ('open_request'), ('decide_request'), ('refuse_request'),
  ('on_document_reversed'), ('seed_roles'), ('lock_internals'), ('wf_dispatch')
on conflict do nothing;

create or replace function numero_private.lock_internals() returns void
language plpgsql security definer set search_path = '' as $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'numero_private'
       and (left(p.proname, 3) = 'wf_'
            or p.proname in (select name from numero_private.internal_functions))
  loop
    execute format('revoke execute on function %s from authenticated, anon, public', f.sig);
  end loop;
end $$;

revoke all on table numero_private.internal_functions from public, anon, authenticated;
revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();
