-- >>> applied as migrations p2_21_follow_up_confidentiality and p2_22_follow_up_payroll_rule (shown here in its final form)
-- =====================================================================
-- GHL NUMERO · 0012 · A FOLLOW-UP IS AS CONFIDENTIAL AS ITS RECORD
--
-- Found in review: follow-ups were readable by everyone with access to the
-- company, so a follow-up on a confidential incident, or on a payroll run,
-- disclosed the existence and the subject of a record its reader could
-- not open.
--
-- A follow-up now takes the confidentiality of the record it is linked
-- to, at the moment it is created, and is read under the same rule as that
-- record. A follow-up on payroll needs the payroll permission instead: payroll
-- records are protected by that permission, not by a confidentiality level,
-- so that the people who run payroll can follow up their own work.
-- Non-destructive: one column is added; existing follow-ups are classified.
-- =====================================================================
alter table public.tasks add column if not exists confidentiality text not null default 'internal';

create or replace function numero_private.record_confidentiality(p_entity text, p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_entity is null or p_id is null then return 'internal'; end if;
  if p_entity not in ('register_items', 'advances', 'expense_claims', 'purchase_docs', 'loans', 'fixed_deposits', 'fixed_assets',
                      'invoices', 'payments', 'journals', 'documents', 'employees') then
    return 'internal';
  end if;
  begin
    execute format('select confidentiality from public.%I where id = $1', p_entity) into v using p_id;
  exception when undefined_column then v := null;
  end;
  return coalesce(v, 'internal');
end $$;

create or replace function numero_private.task_inherits_confidentiality() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.confidentiality := numero_private.record_confidentiality(new.entity, new.entity_id);
  return new;
end $$;
drop trigger if exists tasks_confidentiality on public.tasks;
create trigger tasks_confidentiality before insert on public.tasks
  for each row execute function numero_private.task_inherits_confidentiality();

update public.tasks t set confidentiality = numero_private.record_confidentiality(t.entity, t.entity_id)
 where t.entity is not null and t.confidentiality = 'internal';

alter policy tasks_select on public.tasks using (
  (select numero_private.has_company_access(company_id))
  and (select numero_private.can_view_level(company_id, confidentiality))
  and (entity is null or entity not in ('employees', 'salary_structures', 'payroll_runs', 'payroll_lines')
       or (select numero_private.can(company_id, 'payroll.view')))
);

insert into numero_private.internal_functions(name) values ('record_confidentiality'), ('task_inherits_confidentiality') on conflict do nothing;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();
