-- >>> applied as migration p2_23_review_corrections_2
-- =====================================================================
-- GHL NUMERO · 0013 · CORRECTIONS FOUND WHEN THE FIRST CORRECTIONS WERE REVIEWED
--
--  1. A required custom field that belongs to one sub-type (a register
--     kind, a document type, a party type) no longer blocks saving on a
--     record of another sub-type, where the screen does not even show it.
--  2. A follow-up stays as confidential as its record: raising the level of
--     the record later raises the level of its follow-ups.
--  3. A claim or an advance linked to a register item is at least as
--     confidential as that item. Its accounting entry carries the item's
--     tag, so it must not be more widely readable than the item.
-- Non-destructive: functions and triggers only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CUSTOM FIELDS: THE SUB-TYPE OF THE RECORD
-- ---------------------------------------------------------------------
-- The sub-types a record belongs to. NULL means the record type has no sub-types known here: every field applies.
create or replace function numero_private.record_scopes(p_entity text, p_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v text[];
begin
  if p_entity = 'register_items' then
    select array[kind] into v from public.register_items where id = p_id;
  elsif p_entity in ('invoices', 'invoice', 'bill') then
    select array[doc_type] into v from public.invoices where id = p_id;
  elsif p_entity in ('party', 'parties') then
    select coalesce(array_agg(distinct type_key), '{}') into v from public.party_roles where party_id = p_id;
  else
    return null;
  end if;
  return coalesce(v, '{}');
end $$;

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'numero_private' and p.proname = 'save_custom_values';
  if position('record_scopes' in v_def) = 0 then
    v_new := replace(v_def,
      'and (f.company_id is null or f.company_id = p_company) loop',
      'and (f.company_id is null or f.company_id = p_company)' || chr(10) ||
      '              and (f.scope_key is null or numero_private.record_scopes(p_entity, p_entity_id) is null' || chr(10) ||
      '                   or f.scope_key = any(numero_private.record_scopes(p_entity, p_entity_id))) loop');
    if v_new = v_def then raise exception 'NUMERO: save_custom_values could not be corrected.'; end if;
    execute v_new;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. A FOLLOW-UP FOLLOWS ITS RECORD
-- ---------------------------------------------------------------------
create or replace function numero_private.follow_ups_follow_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.confidentiality is distinct from old.confidentiality then
    update public.tasks set confidentiality = new.confidentiality where entity = tg_table_name and entity_id = new.id;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['register_items', 'advances', 'expense_claims', 'purchase_docs', 'loans', 'fixed_deposits', 'fixed_assets',
                           'invoices', 'journals', 'documents', 'employees'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'confidentiality') then
      execute format('drop trigger if exists follow_ups_follow_record on public.%I', t);
      execute format('create trigger follow_ups_follow_record after update of confidentiality on public.%I for each row execute function numero_private.follow_ups_follow_record()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. A CLAIM OR AN ADVANCE IS AT LEAST AS CONFIDENTIAL AS THE ITEM IT IS LINKED TO
-- ---------------------------------------------------------------------
create or replace function numero_private.inherit_item_confidentiality() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if new.register_item_id is not null then
    select confidentiality into v from public.register_items where id = new.register_item_id;
    if v is not null and numero_private.conf_rank(v) > numero_private.conf_rank(new.confidentiality) then
      new.confidentiality := v;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists advances_inherit_item_confidentiality on public.advances;
create trigger advances_inherit_item_confidentiality before insert or update of register_item_id, confidentiality on public.advances
  for each row execute function numero_private.inherit_item_confidentiality();
drop trigger if exists expense_claims_inherit_item_confidentiality on public.expense_claims;
create trigger expense_claims_inherit_item_confidentiality before insert or update of register_item_id, confidentiality on public.expense_claims
  for each row execute function numero_private.inherit_item_confidentiality();

insert into numero_private.internal_functions(name) values ('record_scopes'), ('follow_ups_follow_record'), ('inherit_item_confidentiality') on conflict do nothing;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();
