-- >>> applied as migration 20260927154824 · p3_24_assessment_corrections
-- =====================================================================
-- GHL NUMERO · PHASE 3 · corrections after the assessment of release 0.3.0
--  1. stock moved between two places of a company was not received again: the age of stock is kept
--  2. a stock document is not dated in the future
--  3. system health compares every stock ledger with the books, also one that holds no item
--  4. the class of an alert is worked out from its amount or, where it carries none, from its difference
--  5. a Group Super Admin is told of an approval that waits only when it is classed for the owner,
--     or when nobody else could approve it
--  6. a verification opened by mistake can be cancelled, with a reason
--  7. a statement line matched in part is not reconciled
-- Nothing is dropped and no record is changed.
-- =====================================================================

-- 1 ------------------------------------------------------------------
create or replace function public.stock_on_hand(p_companies uuid[])
returns table (company_id uuid, item_id uuid, warehouse_id uuid, lot_id uuid, qty numeric, pending_out numeric, pending_in numeric, last_in date, last_out date)
language sql stable set search_path = '' as $$
  with m as (
    select x.company_id, x.item_id, x.warehouse_id, x.lot_id, x.qty, x.status, x.kind, x.move_date
      from public.inv_movements x
     where x.company_id = any(p_companies) and x.status in ('proposed','posted')),
  came as (
    -- the day goods of this item and lot last came into the company: a transfer between its own places is not a receipt
    select m.company_id, m.item_id, m.lot_id, max(m.move_date) as d
      from m where m.status = 'posted' and m.qty > 0 and m.kind <> 'transfer_in'
     group by m.company_id, m.item_id, m.lot_id)
  select m.company_id, m.item_id, m.warehouse_id, m.lot_id,
         coalesce(sum(m.qty) filter (where m.status = 'posted'), 0),
         coalesce(-sum(m.qty) filter (where m.status = 'proposed' and m.qty < 0), 0),
         coalesce(sum(m.qty) filter (where m.status = 'proposed' and m.qty > 0), 0),
         coalesce(max(m.move_date) filter (where m.status = 'posted' and m.qty > 0 and m.kind <> 'transfer_in'),
                  (select c.d from came c where c.company_id = m.company_id and c.item_id = m.item_id and c.lot_id is not distinct from m.lot_id)),
         max(m.move_date) filter (where m.status = 'posted' and m.qty < 0 and m.kind <> 'transfer_out')
    from m
   group by m.company_id, m.item_id, m.warehouse_id, m.lot_id
  having coalesce(sum(m.qty) filter (where m.status = 'posted'), 0) <> 0
      or coalesce(sum(m.qty) filter (where m.status = 'proposed'), 0) <> 0;
$$;

-- 2, 3, 4b, 7 --------------------------------------------------------
do $m$
declare v text; v2 text;
begin
  -- 2. the day of the server is that of UTC, so a document dated tomorrow by the server may be dated today where it is written
  select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'numero_private' and p.proname = 'save_stock_doc';
  v2 := replace(v, $a$  if v_kind is null or v_kind not in ('receipt','issue','transfer','return_in','return_out','adjustment','landed_cost') then$a$,
$b$  if v_date > current_date + 1 then
    raise exception 'NUMERO: a stock document is dated today or earlier: goods have not moved on a day that has not come.' using errcode = 'P0001';
  end if;
  if v_kind is null or v_kind not in ('receipt','issue','transfer','return_in','return_out','adjustment','landed_cost') then$b$);
  if v2 = v then raise exception 'p3_24: save_stock_doc was not changed'; end if;
  execute v2;

  -- 3.
  select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'numero_private' and p.proname = 'system_health';
  v2 := replace(v, 'from public.inv_categories c join public.inv_items i on i.category_id = c.id join public.accounts a on a.id = c.inventory_account_id',
                   'from public.inv_categories c left join public.inv_items i on i.category_id = c.id join public.accounts a on a.id = c.inventory_account_id');
  if v2 = v then raise exception 'p3_24: system_health (join) was not changed'; end if;
  v := v2;
  v2 := replace(v, 'select c.company_id, a.name, sum(i.value_on_hand) as stock,', 'select c.company_id, a.name, coalesce(sum(i.value_on_hand), 0) as stock,');
  if v2 = v then raise exception 'p3_24: system_health (sum) was not changed'; end if;
  execute v2;

  -- 4b.
  select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'numero_private' and p.proname = 'on_alert';
  v2 := replace(v, $a$(new.evidence->>'amount')::numeric$a$, $b$coalesce(new.evidence->>'amount', new.evidence->>'difference')::numeric$b$);
  if v2 = v then raise exception 'p3_24: on_alert was not changed'; end if;
  execute v2;

  -- 7.
  select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'numero_private' and p.proname = 'refresh_notifications';
  v2 := replace(v, $a$where t.status in ('unmatched','suggested','needs_review') and t.txn_date < current_date - 7$a$,
                   $b$where t.status in ('unmatched','suggested','needs_review','partial') and t.txn_date < current_date - 7$b$);
  if v2 = v then raise exception 'p3_24: refresh_notifications was not changed'; end if;
  execute v2;
end $m$;

-- 4a. an amount counts for its size, whichever way it points -----------
create or replace function numero_private.attention_class(p_group uuid, p_kind text, p_amount numeric, p_default text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.class from public.attention_rules r
     where r.group_id = p_group and r.kind in (p_kind, '*') and abs(coalesce(p_amount, 0)) >= r.min_amount
     order by (r.kind = p_kind) desc, r.min_amount desc limit 1), p_default);
$$;

-- 5 ------------------------------------------------------------------
-- Tells every person who holds a permission in a company. A person is never told about their own action.
-- The owner is not to be overwhelmed with routine bookkeeping: of an approval that waits, a Group Super Admin is told
-- only when the rules of the group class it as owner action or critical, or when no other person could approve it.
create or replace function numero_private.notify_holders(
  p_company uuid, p_perm text, p_except uuid, p_kind text, p_class text, p_title text, p_body text,
  p_entity text, p_entity_id uuid, p_dedupe text, p_mandatory boolean default false) returns int
language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_n int; v_others int; v_owner boolean;
begin
  select group_id into v_group from public.companies where id = p_company;
  select count(distinct m.user_id) into v_others
    from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
    join public.profiles pr on pr.id = m.user_id
   where m.company_id = p_company and rp.permission = p_perm and not pr.is_group_admin and m.user_id is distinct from p_except
     and (m.valid_from is null or m.valid_from <= current_date) and (m.valid_to is null or m.valid_to >= current_date);
  v_owner := p_kind <> 'approval_waiting' or p_class in ('owner_action','critical') or v_others = 0;
  insert into public.notifications(group_id, company_id, user_id, kind, class, title, body, entity, entity_id, mandatory, dedupe_key)
  select distinct v_group, p_company, u.user_id, p_kind, p_class, p_title, p_body, p_entity, p_entity_id, p_mandatory, p_dedupe
    from (
      select m.user_id, pr.is_group_admin as admin
        from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
        join public.profiles pr on pr.id = m.user_id
       where m.company_id = p_company and rp.permission = p_perm
         and (m.valid_from is null or m.valid_from <= current_date) and (m.valid_to is null or m.valid_to >= current_date)
      union
      select pr.id, true from public.profiles pr where pr.group_id = v_group and pr.is_group_admin) u
   where u.user_id is distinct from p_except
     and (v_owner or not u.admin)
     and (p_mandatory or not exists (
           select 1 from public.notification_prefs np where np.user_id = u.user_id and np.kind = p_kind and np.channel = 'in_app' and not np.enabled))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 6 ------------------------------------------------------------------
create or replace function numero_private.cancel_verification(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.verification_runs;
begin
  select * into r from public.verification_runs where id = p_id for update;
  if not found then raise exception 'NUMERO: verification not found.' using errcode = 'P0001'; end if;
  if not numero_private.can(r.company_id, 'reality.manage') then
    raise exception 'NUMERO: you are not authorised to carry out a verification.' using errcode = '42501';
  end if;
  if r.status <> 'open' then raise exception 'NUMERO: this verification is %. What was completed stays as it was found.', r.status using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'NUMERO: a reason is required.' using errcode = 'P0001'; end if;
  perform set_config('numero.reason', p_reason, true);
  -- what had been entered on the sheet stays on it; nothing is raised from a sheet that was cancelled
  update public.verification_runs set status = 'cancelled', note = concat_ws(' · ', nullif(trim(note), ''), 'Cancelled: ' || trim(p_reason)), completed_at = now()
   where id = p_id;
end $$;
create or replace function public.cancel_verification(p_id uuid, p_reason text) returns void language sql set search_path = '' as $$ select numero_private.cancel_verification(p_id, p_reason); $$;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927160638 · p3_25_notify_holders_admin_column
-- =====================================================================
-- GHL NUMERO · PHASE 3 · correction of p3_24
-- notify_holders, as rewritten in p3_24, named the column profiles.is_group_admin, which does not exist: the
-- administrators of the group are named by profiles.is_group_super_admin. Because a notification must never
-- stop an approval, the fault was swallowed and no notice was written. Found by tests T240, T241, T253, T276, T277.
-- =====================================================================
do $m$
declare v text; v2 text;
begin
  select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'numero_private' and p.proname = 'notify_holders';
  v2 := replace(v, 'pr.is_group_admin', 'pr.is_group_super_admin');
  if v2 = v then raise exception 'p3_25: notify_holders was not changed'; end if;
  if v2 like '%pr.is_group_admin %' or v2 like '%pr.is_group_admin)%' then raise exception 'p3_25: the old column is still named'; end if;
  execute v2;
end $m$;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927161543 · p3_26_api_row_probe
-- =====================================================================
-- GHL NUMERO · PHASE 3 · how many rows the API hands over to one request
-- The application reads every list in pages. The size of a page is whatever the API delivers: a setting of the
-- project ("Max rows"), 1,000 unless changed. If the application assumed 1,000 and the setting were lower, a list
-- would end early and nobody would know. This function returns 1,001 numbers and nothing else; the application
-- asks for it once and counts what arrives. It reads no table and tells nothing about the books.
-- =====================================================================
create or replace function public.api_row_probe() returns setof integer
language sql immutable set search_path = '' as $$
  select g from generate_series(1, 1001) g;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();

-- >>> applied as migration 20260927162616 · p3_27_health_counts_lines_matched_in_part
-- =====================================================================
-- GHL NUMERO · PHASE 3 · one count of what is not reconciled
-- A statement line matched in part is not reconciled. Reality, the closing of a period and, since p3_24, the
-- notice count it as open; system health did not. Health and the notice now count the same lines.
-- =====================================================================
do $m$
declare v text; v2 text;
begin
  select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'numero_private' and p.proname = 'system_health';
  v2 := replace(v, $a$count(*) filter (where t.status in ('unmatched','suggested','needs_review')) as unmatched$a$,
                   $b$count(*) filter (where t.status in ('unmatched','suggested','needs_review','partial')) as unmatched$b$);
  if v2 = v then raise exception 'p3_27: system_health was not changed'; end if;
  execute v2;
end $m$;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
select numero_private.lock_internals();
