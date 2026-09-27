-- =====================================================================
-- GHL NUMERO · 0004 · LEDGER REPORTING, TIME MACHINE, SENTINEL, NUMI MEMORY,
--                     VOICE AUDIT, DYNAMIC FIELDS, REQUIREMENT LEDGER
-- Spec: 40, 73, 80, 88, 330-331, 352-353, 376, 512, 724-777, 901-908,
--       1500-1502, 1615, 1753-1755
-- Reporting totals always include every posted line (no invisible
-- accounting). Restricted detail is masked, never removed from totals.
-- =====================================================================

create or replace function numero_private.ledger_balances(
  p_companies uuid[], p_from date, p_to date, p_known_at timestamptz, p_dim uuid)
returns table (company_id uuid, account_id uuid, opening_debit numeric, opening_credit numeric,
               period_debit numeric, period_credit numeric)
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select c as id from unnest(p_companies) as c where numero_private.can(c, 'report.view')
  )
  select l.company_id, l.account_id,
         coalesce(sum(l.debit)  filter (where j.journal_date <  p_from), 0),
         coalesce(sum(l.credit) filter (where j.journal_date <  p_from), 0),
         coalesce(sum(l.debit)  filter (where j.journal_date >= p_from), 0),
         coalesce(sum(l.credit) filter (where j.journal_date >= p_from), 0)
  from public.journal_lines l
  join public.journals j on j.id = l.journal_id
  where l.company_id in (select id from allowed)
    and j.status in ('posted','reversed')
    and j.journal_date <= p_to
    and (p_known_at is null or j.posted_at <= p_known_at)
    and (p_dim is null or exists (select 1 from public.journal_line_dims d where d.line_id = l.id and d.org_unit_id = p_dim))
  group by l.company_id, l.account_id;
$$;

create or replace function public.ledger_balances(
  p_companies uuid[], p_from date, p_to date, p_known_at timestamptz default null, p_dim uuid default null)
returns table (company_id uuid, account_id uuid, opening_debit numeric, opening_credit numeric,
               period_debit numeric, period_credit numeric)
language sql stable set search_path = '' as $$
  select * from numero_private.ledger_balances(p_companies, p_from, p_to, p_known_at, p_dim);
$$;

-- Monthly movement per account (trend, budget vs actual, cash flow)
create or replace function numero_private.ledger_monthly(p_companies uuid[], p_from date, p_to date)
returns table (company_id uuid, account_id uuid, month date, debit numeric, credit numeric)
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select c as id from unnest(p_companies) as c where numero_private.can(c, 'report.view')
  )
  select l.company_id, l.account_id, date_trunc('month', j.journal_date)::date,
         coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
  from public.journal_lines l
  join public.journals j on j.id = l.journal_id
  where l.company_id in (select id from allowed)
    and j.status in ('posted','reversed')
    and j.journal_date between p_from and p_to
  group by 1, 2, 3;
$$;

create or replace function public.ledger_monthly(p_companies uuid[], p_from date, p_to date)
returns table (company_id uuid, account_id uuid, month date, debit numeric, credit numeric)
language sql stable set search_path = '' as $$
  select * from numero_private.ledger_monthly(p_companies, p_from, p_to);
$$;

-- Drill-down lines. Restricted journals are aggregated into a masked bucket so
-- every drill-down still ties to the report total.
create or replace function numero_private.ledger_lines(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_companies uuid[]; v_accounts uuid[]; v_from date := (p->>'from')::date; v_to date := (p->>'to')::date;
  v_party uuid := (p->>'party_id')::uuid; v_dim uuid := (p->>'org_unit_id')::uuid; v_journal uuid := (p->>'journal_id')::uuid;
  v_q text := nullif(trim(p->>'q'), ''); v_min numeric := (p->>'min_amount')::numeric;
  v_limit int := least(coalesce((p->>'limit')::int, 200), 1000); v_offset int := coalesce((p->>'offset')::int, 0);
  v_known timestamptz := (p->>'known_at')::timestamptz;
  v_rows jsonb; v_total bigint; v_sum_d numeric; v_sum_c numeric; v_rcount bigint; v_rd numeric; v_rc numeric;
begin
  select array_agg(c) into v_companies
  from (select (jsonb_array_elements_text(coalesce(p->'company_ids', '[]'::jsonb)))::uuid as c) s
  where numero_private.can(c, 'journal.view');
  if v_companies is null then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'sum_debit', 0, 'sum_credit', 0,
                              'restricted', jsonb_build_object('count', 0, 'debit', 0, 'credit', 0));
  end if;
  if p ? 'account_ids' and jsonb_array_length(p->'account_ids') > 0 then
    select array_agg((x)::uuid) into v_accounts from jsonb_array_elements_text(p->'account_ids') x;
  end if;

  with base as (
    select l.id, l.journal_id, l.company_id, l.line_no, l.account_id, l.party_id, l.description, l.debit, l.credit,
           l.txn_currency, l.txn_amount, l.fx_rate,
           j.voucher_no, j.voucher_type, j.journal_date, j.narration, j.status, j.source, j.source_id,
           j.origin, j.confidentiality, j.posted_at,
           numero_private.can_view_level(j.company_id, j.confidentiality) as visible
    from public.journal_lines l
    join public.journals j on j.id = l.journal_id
    where l.company_id = any(v_companies)
      and j.status in ('posted','reversed')
      and (v_accounts is null or l.account_id = any(v_accounts))
      and (v_from is null or j.journal_date >= v_from)
      and (v_to is null or j.journal_date <= v_to)
      and (v_known is null or j.posted_at <= v_known)
      and (v_party is null or l.party_id = v_party)
      and (v_journal is null or l.journal_id = v_journal)
      and (v_min is null or greatest(l.debit, l.credit) >= v_min)
      and (v_dim is null or exists (select 1 from public.journal_line_dims d where d.line_id = l.id and d.org_unit_id = v_dim))
  ),
  vis as (
    select b.* from base b
    where b.visible
      and (v_q is null or b.narration ilike '%' || v_q || '%' or b.description ilike '%' || v_q || '%'
           or b.voucher_no ilike '%' || v_q || '%')
  ),
  page as (
    select v.*, a.code as account_code, a.name as account_name, a.type as account_type,
           pt.display_name as party_name, pt.party_no, c.name as company_name
    from vis v
    join public.accounts a on a.id = v.account_id
    join public.companies c on c.id = v.company_id
    left join public.parties pt on pt.id = v.party_id
    order by v.journal_date desc, v.voucher_no desc, v.line_no
    limit v_limit offset v_offset
  )
  select (select coalesce(jsonb_agg(to_jsonb(page) - 'visible'), '[]'::jsonb) from page),
         (select count(*) from vis), (select coalesce(sum(debit), 0) from vis), (select coalesce(sum(credit), 0) from vis),
         (select count(*) from base where not visible),
         (select coalesce(sum(debit), 0) from base where not visible),
         (select coalesce(sum(credit), 0) from base where not visible)
    into v_rows, v_total, v_sum_d, v_sum_c, v_rcount, v_rd, v_rc;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'sum_debit', v_sum_d, 'sum_credit', v_sum_c,
    'restricted', jsonb_build_object('count', v_rcount, 'debit', v_rd, 'credit', v_rc));
end $$;

create or replace function public.ledger_lines(p jsonb) returns jsonb language sql stable set search_path = '' as $$
  select numero_private.ledger_lines(p); $$;

-- Subledger balances by party on control accounts
create or replace function numero_private.party_ledger_balances(p_companies uuid[], p_to date)
returns table (company_id uuid, party_id uuid, control_type text, debit numeric, credit numeric)
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select c as id from unnest(p_companies) as c where numero_private.can(c, 'party.view')
  )
  select l.company_id, l.party_id, a.control_type, coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
  from public.journal_lines l
  join public.journals j on j.id = l.journal_id
  join public.accounts a on a.id = l.account_id
  where l.company_id in (select id from allowed)
    and l.party_id is not null and a.control_type is not null
    and j.status in ('posted','reversed') and j.journal_date <= p_to
  group by 1, 2, 3;
$$;

create or replace function public.party_ledger_balances(p_companies uuid[], p_to date)
returns table (company_id uuid, party_id uuid, control_type text, debit numeric, credit numeric)
language sql stable set search_path = '' as $$
  select * from numero_private.party_ledger_balances(p_companies, p_to);
$$;

-- Journal detail with full responsibility chain; restricted access is logged.
create or replace function numero_private.open_journal(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.journals; v jsonb;
begin
  select * into j from public.journals where id = p_id;
  if not found or not numero_private.can(j.company_id, 'journal.view') then
    raise exception 'NUMERO: journal not found.' using errcode = 'P0001';
  end if;
  if not numero_private.can_view_level(j.company_id, j.confidentiality) then
    insert into public.vault_access_log(actor, company_id, entity, entity_id, action)
    values ((select auth.uid()), j.company_id, 'journals', j.id, 'denied');
    return jsonb_build_object('restricted', true, 'id', j.id, 'company_id', j.company_id,
      'message', 'RESTRICTED — your account is not authorised to view this record.');
  end if;
  if j.confidentiality <> 'internal' then
    insert into public.vault_access_log(actor, company_id, entity, entity_id, action, meta)
    values ((select auth.uid()), j.company_id, 'journals', j.id, 'viewed', jsonb_build_object('level', j.confidentiality));
  end if;
  select to_jsonb(j) || jsonb_build_object(
    'company_name', (select name from public.companies where id = j.company_id),
    'people', (select coalesce(jsonb_object_agg(pr.id, coalesce(pr.full_name, pr.email)), '{}'::jsonb) from public.profiles pr
               where pr.id in (j.created_by, j.submitted_by, j.approved_by, j.posted_by)),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', l.id, 'line_no', l.line_no, 'account_id', l.account_id, 'account_code', a.code, 'account_name', a.name,
                 'party_id', l.party_id, 'party_name', pt.display_name, 'description', l.description,
                 'debit', l.debit, 'credit', l.credit, 'txn_currency', l.txn_currency, 'txn_amount', l.txn_amount, 'fx_rate', l.fx_rate,
                 'dims', (select coalesce(jsonb_object_agg(d.type_key, jsonb_build_object('id', u.id, 'name', u.name, 'code', u.code)), '{}'::jsonb)
                          from public.journal_line_dims d join public.org_units u on u.id = d.org_unit_id where d.line_id = l.id)
               ) order by l.line_no), '[]'::jsonb)
              from public.journal_lines l
              join public.accounts a on a.id = l.account_id
              left join public.parties pt on pt.id = l.party_id
              where l.journal_id = j.id),
    'approvals', (select coalesce(jsonb_agg(jsonb_build_object('step', a.step, 'action', a.action, 'comment', a.comment, 'at', a.at,
                     'actor', (select coalesce(full_name, email) from public.profiles where id = a.actor)) order by a.at), '[]'::jsonb)
                  from public.approval_actions a join public.approval_requests r on r.id = a.request_id
                  where r.entity = 'journal' and r.entity_id = j.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('at', al.at, 'action', al.action, 'reason', al.reason,
                     'actor', (select coalesce(full_name, email) from public.profiles where id = al.actor)) order by al.at), '[]'::jsonb)
                from public.audit_log al where al.entity = 'journals' and al.entity_id = j.id and al.action not in ('insert','update'))
  ) into v;
  return v;
end $$;

create or replace function public.open_journal(p_id uuid) returns jsonb language sql set search_path = '' as $$
  select numero_private.open_journal(p_id); $$;

-- Accounting integrity self-check (never trusts itself: recomputes from lines)
create or replace function numero_private.integrity_check(p_companies uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select c as id from unnest(p_companies) as c where numero_private.can(c, 'report.view')
  ),
  per_journal as (
    select j.id, j.company_id, sum(l.debit) d, sum(l.credit) c
    from public.journals j join public.journal_lines l on l.journal_id = j.id
    where j.company_id in (select id from allowed) and j.status in ('posted','reversed')
    group by j.id, j.company_id
  )
  select jsonb_build_object(
    'posted_journals', (select count(*) from per_journal),
    'unbalanced_journals', (select count(*) from per_journal where d <> c),
    'total_debits', (select coalesce(sum(d), 0) from per_journal),
    'total_credits', (select coalesce(sum(c), 0) from per_journal),
    'drafts', (select count(*) from public.journals where company_id in (select id from allowed) and status = 'draft'),
    'awaiting_approval', (select count(*) from public.journals where company_id in (select id from allowed) and status = 'submitted'),
    'approved_unposted', (select count(*) from public.journals where company_id in (select id from allowed) and status = 'approved'),
    'unreconciled_bank_lines', (select count(*) from public.bank_transactions where company_id in (select id from allowed) and status in ('unmatched','suggested','needs_review','partial')),
    'locked_periods', (select count(*) from public.fiscal_periods where company_id in (select id from allowed) and status = 'locked'),
    'open_alerts', (select count(*) from public.alerts where company_id in (select id from allowed) and status in ('open','reviewing'))
  );
$$;

create or replace function public.integrity_check(p_companies uuid[]) returns jsonb language sql stable set search_path = '' as $$
  select numero_private.integrity_check(p_companies); $$;

-- ---------- SENTINEL: factual anomaly indicators, never accusations ----------
create or replace function numero_private.run_sentinel(p_company uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_gid uuid; v_settings jsonb; v_tz text; v_large numeric; v_round numeric; v_before int; v_after int;
begin
  if not numero_private.can(p_company, 'sentinel.view') then
    raise exception 'NUMERO: you are not authorised to run Sentinel.' using errcode = '42501';
  end if;
  select c.group_id, g.settings into v_gid, v_settings
    from public.companies c join public.groups g on g.id = c.group_id where c.id = p_company;
  v_tz := coalesce(v_settings #>> '{sentinel,timezone}', 'Asia/Kolkata');
  v_large := coalesce((v_settings #>> '{sentinel,large_payment}')::numeric, 500000);
  v_round := coalesce((v_settings #>> '{sentinel,round_number_unit}')::numeric, 100000);
  select count(*) into v_before from public.alerts where company_id = p_company;

  -- duplicate payment candidates
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  select p_company, 'duplicate_payment', 'priority', 'ANOMALY DETECTED — possible duplicate payment',
         'Two payments of the same amount (' || a.amount || ' ' || a.currency || ') went to the same party within ' ||
           abs(a.pay_date - b.pay_date) || ' day(s): ' || coalesce(a.pay_no, 'draft') || ' and ' || coalesce(b.pay_no, 'draft') ||
           '. This is a factual pattern for human review.',
         jsonb_build_object('payment_ids', jsonb_build_array(a.id, b.id), 'party_id', a.party_id, 'amount', a.amount,
                            'rule', 'same party + same amount + within 3 days'),
         'payments', b.id, 'duppay:' || least(a.id::text, b.id::text) || ':' || greatest(a.id::text, b.id::text)
  from public.payments a
  join public.payments b on b.company_id = a.company_id and b.party_id = a.party_id and b.amount = a.amount
       and b.direction = a.direction and b.id > a.id and abs(b.pay_date - a.pay_date) <= 3
  where a.company_id = p_company and a.status <> 'cancelled' and b.status <> 'cancelled'
  on conflict (company_id, dedupe_key) do nothing;

  -- duplicate invoice / bill reference
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  select p_company, 'duplicate_invoice', 'priority', 'ANOMALY DETECTED — invoice reference used more than once',
         'Reference "' || a.reference || '" appears on more than one ' || replace(a.doc_type, '_', ' ') || ' for the same party.',
         jsonb_build_object('invoice_ids', jsonb_build_array(a.id, b.id), 'reference', a.reference,
                            'rule', 'same party + same reference'),
         'invoices', b.id, 'dupinv:' || least(a.id::text, b.id::text) || ':' || greatest(a.id::text, b.id::text)
  from public.invoices a
  join public.invoices b on b.company_id = a.company_id and b.party_id = a.party_id and b.doc_type = a.doc_type
       and b.id > a.id and lower(b.reference) = lower(a.reference)
  where a.company_id = p_company and a.reference is not null and a.reference <> ''
    and a.status <> 'cancelled' and b.status <> 'cancelled'
  on conflict (company_id, dedupe_key) do nothing;

  -- large round-number manual journals
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  select p_company, 'round_number_journal', 'review', 'ANOMALY DETECTED — large round-number manual journal',
         'Manual journal ' || j.voucher_no || ' totals exactly ' || j.total || ', a round multiple of ' || v_round ||
           '. Round figures in manual journals are a standard review indicator.',
         jsonb_build_object('journal_id', j.id, 'total', j.total, 'rule', 'manual journal, total is a multiple of ' || v_round),
         'journals', j.id, 'round:' || j.id::text
  from public.journals j
  where j.company_id = p_company and j.status in ('posted','reversed') and j.source = 'manual'
    and j.total >= v_round and mod(j.total, v_round) = 0
  on conflict (company_id, dedupe_key) do nothing;

  -- posted outside normal hours / on weekends
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  select p_company, 'unusual_time', 'review', 'ANOMALY DETECTED — manual journal posted at an unusual time',
         'Manual journal ' || j.voucher_no || ' was posted on ' || to_char(j.posted_at at time zone v_tz, 'Dy DD Mon YYYY HH24:MI') ||
           ' (' || v_tz || '), outside configured working hours.',
         jsonb_build_object('journal_id', j.id, 'posted_at', j.posted_at, 'rule', 'weekend, or between 23:00 and 05:00'),
         'journals', j.id, 'time:' || j.id::text
  from public.journals j
  where j.company_id = p_company and j.status in ('posted','reversed') and j.source = 'manual'
    and (extract(isodow from j.posted_at at time zone v_tz) in (6, 7)
         or extract(hour from j.posted_at at time zone v_tz) >= 23
         or extract(hour from j.posted_at at time zone v_tz) < 5)
  on conflict (company_id, dedupe_key) do nothing;

  -- backdated entries
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  select p_company, 'backdated', 'review', 'ANOMALY DETECTED — backdated entry',
         'Journal ' || j.voucher_no || ' is dated ' || j.journal_date || ' but was created on ' || j.created_at::date ||
           ' (' || (j.created_at::date - j.journal_date) || ' days later).',
         jsonb_build_object('journal_id', j.id, 'journal_date', j.journal_date, 'created_at', j.created_at,
                            'rule', 'journal date more than 30 days before creation'),
         'journals', j.id, 'backdated:' || j.id::text
  from public.journals j
  where j.company_id = p_company and j.status in ('posted','reversed') and j.source = 'manual'
    and j.voucher_type <> 'opening' and j.created_at::date - j.journal_date > 30
  on conflict (company_id, dedupe_key) do nothing;

  -- just below an approval threshold
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  select distinct on (j.id) p_company, 'below_threshold', 'review', 'ANOMALY DETECTED — amount just below an approval threshold',
         'Journal ' || j.voucher_no || ' totals ' || j.total || ', within 5% below the approval threshold of ' || r.min_amount ||
           ' ("' || r.name || '").',
         jsonb_build_object('journal_id', j.id, 'total', j.total, 'threshold', r.min_amount, 'rule', 'total between 95% and 100% of a threshold'),
         'journals', j.id, 'threshold:' || j.id::text
  from public.journals j
  join public.approval_rules r on r.group_id = v_gid and r.is_active and r.entity = 'journal'
       and (r.company_id is null or r.company_id = j.company_id) and r.min_amount > 0
  where j.company_id = p_company and j.status in ('posted','reversed') and j.source = 'manual'
    and j.total >= r.min_amount * 0.95 and j.total < r.min_amount
  order by j.id, r.min_amount
  on conflict (company_id, dedupe_key) do nothing;

  -- new party receiving an immediate large payment
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  select p_company, 'new_vendor_large_payment', 'priority', 'ANOMALY DETECTED — new party received an immediate large payment',
         pt.display_name || ' was created on ' || pt.created_at::date || ' and was paid ' || p.amount || ' ' || p.currency ||
           ' on ' || p.pay_date || ' (' || (p.pay_date - pt.created_at::date) || ' day(s) later).',
         jsonb_build_object('payment_id', p.id, 'party_id', pt.id, 'amount', p.amount,
                            'rule', 'payment of at least ' || v_large || ' within 7 days of party creation'),
         'payments', p.id, 'newvendor:' || p.id::text
  from public.payments p join public.parties pt on pt.id = p.party_id
  where p.company_id = p_company and p.direction = 'out' and p.status <> 'cancelled'
    and p.amount * p.fx_rate >= v_large and p.pay_date - pt.created_at::date between 0 and 7
  on conflict (company_id, dedupe_key) do nothing;

  -- journals reversed almost immediately
  insert into public.alerts(company_id, kind, attention, title, explanation, evidence, entity, entity_id, dedupe_key)
  select p_company, 'immediate_reversal', 'review', 'ANOMALY DETECTED — journal reversed shortly after posting',
         'Journal ' || j.voucher_no || ' was reversed within 24 hours of being posted.',
         jsonb_build_object('journal_id', j.id, 'reversal_journal', r.id, 'rule', 'reversal posted within 24 hours'),
         'journals', j.id, 'quickrev:' || j.id::text
  from public.journals j join public.journals r on r.id = j.reversed_by
  where j.company_id = p_company and j.status = 'reversed' and r.posted_at - j.posted_at < interval '24 hours'
  on conflict (company_id, dedupe_key) do nothing;

  select count(*) into v_after from public.alerts where company_id = p_company;
  return v_after - v_before;
end $$;

create or replace function numero_private.review_alert(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_id for update;
  if not found then raise exception 'NUMERO: alert not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(a.company_id, 'sentinel.review') then
    raise exception 'NUMERO: you are not authorised to review Sentinel alerts.' using errcode = '42501';
  end if;
  if p_status not in ('open','reviewing','false_positive','resolved') then
    raise exception 'NUMERO: invalid alert status.' using errcode = 'P0001';
  end if;
  if p_status in ('false_positive','resolved') and coalesce(trim(p_note), '') = '' then
    raise exception 'NUMERO: a note is required to close an alert.' using errcode = 'P0001';
  end if;
  update public.alerts set status = p_status, review_note = p_note,
         reviewed_by = (select auth.uid()), reviewed_at = now() where id = p_id;
  perform numero_private.log_event(a.company_id, 'alerts', p_id, 'alert_' || p_status,
    jsonb_build_object('status', a.status), jsonb_build_object('status', p_status), p_note);
end $$;

create or replace function public.run_sentinel(p_company uuid) returns int language sql set search_path = '' as $$
  select numero_private.run_sentinel(p_company); $$;
create or replace function public.review_alert(p_id uuid, p_status text, p_note text default null) returns void language sql set search_path = '' as $$
  select numero_private.review_alert(p_id, p_status, p_note); $$;

-- ---------- NUMI learned preferences (explainable, inspectable, disable-able) ----------
create table public.numi_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pattern text not null,
  party_id uuid references public.parties(id),
  account_id uuid not null references public.accounts(id),
  dims jsonb not null default '{}'::jsonb,
  approved_count int not null default 1,
  status text not null default 'active' check (status in ('active','disabled')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (company_id, pattern, account_id)
);

create table public.numi_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  group_id uuid,
  channel text not null default 'text' check (channel in ('text','voice')),
  question text not null,
  intent text,
  answer text,
  evidence jsonb,
  screen text
);

create table public.voice_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  group_id uuid,
  provider text not null,
  language text,
  transcript text not null,
  intent text,
  action text,
  required_confirmation boolean not null default false,
  confirmed boolean,
  result text
);

create or replace function numero_private.numi_learn(p_company uuid, p_pattern text, p_party uuid, p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not numero_private.can(p_company, 'journal.create') then
    raise exception 'NUMERO: not authorised.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.accounts where id = p_account and company_id = p_company) then
    raise exception 'NUMERO: account does not belong to this company.' using errcode = 'P0001';
  end if;
  insert into public.numi_rules(company_id, pattern, party_id, account_id, created_by)
  values (p_company, lower(trim(p_pattern)), p_party, p_account, (select auth.uid()))
  on conflict (company_id, pattern, account_id)
  do update set approved_count = public.numi_rules.approved_count + 1, last_used_at = now();
end $$;
create or replace function public.numi_learn(p_company uuid, p_pattern text, p_party uuid, p_account uuid) returns void language sql set search_path = '' as $$
  select numero_private.numi_learn(p_company, p_pattern, p_party, p_account); $$;

-- ---------- dynamic field engine ----------
create table public.custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  company_id uuid references public.companies(id),
  entity text not null,
  scope_key text,
  key text not null,
  label text not null,
  field_type text not null,
  options jsonb not null default '[]'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  is_required boolean not null default false,
  status text not null default 'active' check (status in ('draft','active','inactive')),
  version int not null default 1,
  sort int not null default 100,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index custom_field_defs_key on public.custom_field_defs(
  group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), entity, coalesce(scope_key, ''), key);

create table public.custom_field_values (
  field_id uuid not null references public.custom_field_defs(id),
  entity_id uuid not null,
  company_id uuid not null references public.companies(id),
  value jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (field_id, entity_id)
);

-- ---------- requirement ledger (zero-omission governance) ----------
create table public.requirement_ledger (
  group_id uuid not null references public.groups(id),
  no int not null,
  prompt text not null,
  module text not null,
  title text not null,
  body text,
  status text not null default 'PLANNED',
  phase int not null default 1,
  evidence text,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (group_id, no)
);

create trigger audit_numi_rules after insert or update or delete on public.numi_rules
  for each row execute function numero_private.audit_row();
create trigger audit_custom_fields after insert or update or delete on public.custom_field_defs
  for each row execute function numero_private.audit_row();
create trigger voice_audit_append_only before update or delete on public.voice_audit
  for each row execute function numero_private.audit_is_append_only();
create trigger numi_log_append_only before update or delete on public.numi_log
  for each row execute function numero_private.audit_is_append_only();

alter table public.numi_rules enable row level security;
alter table public.numi_log enable row level security;
alter table public.voice_audit enable row level security;
alter table public.custom_field_defs enable row level security;
alter table public.custom_field_values enable row level security;
alter table public.requirement_ledger enable row level security;

create policy numi_rules_select on public.numi_rules for select to authenticated
  using ((select numero_private.can(company_id, 'numi.use')));
create policy numi_rules_update on public.numi_rules for update to authenticated
  using ((select numero_private.can(company_id, 'account.configure')))
  with check ((select numero_private.can(company_id, 'account.configure')));

create policy numi_log_select on public.numi_log for select to authenticated
  using (user_id = (select auth.uid()) or (group_id is not null and (select numero_private.is_group_admin(group_id))));
create policy numi_log_insert on public.numi_log for insert to authenticated
  with check (user_id = (select auth.uid()) and group_id = (select numero_private.my_group()));

create policy voice_audit_select on public.voice_audit for select to authenticated
  using (user_id = (select auth.uid()) or (group_id is not null and (select numero_private.is_group_admin(group_id))));
create policy voice_audit_insert on public.voice_audit for insert to authenticated
  with check (user_id = (select auth.uid()) and group_id = (select numero_private.my_group()));

create policy cfd_select on public.custom_field_defs for select to authenticated
  using (group_id = (select numero_private.my_group()));
create policy cfd_write on public.custom_field_defs for all to authenticated
  using ((select numero_private.is_group_admin(group_id))
         or (company_id is not null and (select numero_private.can(company_id, 'field.configure'))))
  with check ((select numero_private.is_group_admin(group_id))
         or (company_id is not null and (select numero_private.can(company_id, 'field.configure'))));

create policy cfv_select on public.custom_field_values for select to authenticated
  using ((select numero_private.has_company_access(company_id)));
create policy cfv_write on public.custom_field_values for all to authenticated
  using ((select numero_private.can(company_id, 'journal.create')) or (select numero_private.can(company_id, 'party.edit')))
  with check ((select numero_private.can(company_id, 'journal.create')) or (select numero_private.can(company_id, 'party.edit')));

create policy reqs_select on public.requirement_ledger for select to authenticated
  using ((select numero_private.is_group_admin(group_id)));
create policy reqs_write on public.requirement_ledger for all to authenticated
  using ((select numero_private.is_group_admin(group_id)))
  with check ((select numero_private.is_group_admin(group_id)));

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
