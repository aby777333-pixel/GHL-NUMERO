-- >>> applied as migration p2_19_money_ledger_null_safety
-- =====================================================================
-- GHL NUMERO · 0010 · MONEY-LEDGER CHECK MADE NULL-SAFE
--
-- Several functions test "control_type not in ('bank','cash')". For a ledger
-- that has no control type at all the comparison yields NULL, the test does
-- not fire, and an ordinary ledger could be accepted where a bank or cash
-- ledger is required. This affects functions from 0003 (payments) onwards.
-- The test is rewritten in place, in every function that contains it.
-- Idempotent: functions already corrected are left untouched.
-- =====================================================================
do $$
declare f record; v_def text; v_new text; n int := 0;
begin
  for f in
    select p.oid, p.proname
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'numero_private' and p.prokind = 'f'
       and p.prosrc ~ '[a-z_]+\.control_type not in \(''bank'',''cash''\)'
  loop
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(v_def, '([a-z_]+)\.control_type not in \(''bank'',''cash''\)',
                            'coalesce(\1.control_type, '''') not in (''bank'',''cash'')', 'g');
    if v_new <> v_def then
      execute v_new;
      n := n + 1;
      raise notice 'NUMERO: money-ledger check corrected in %', f.proname;
    end if;
  end loop;
  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'numero_private' and p.prokind = 'f'
       and p.prosrc ~ '[a-z_]+\.control_type not in \(''bank'',''cash''\)') then
    raise exception 'NUMERO: the money-ledger check could not be corrected everywhere.';
  end if;
end $$;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
select numero_private.lock_internals();
