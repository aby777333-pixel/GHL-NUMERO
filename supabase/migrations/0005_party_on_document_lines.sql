-- =====================================================================
-- GHL NUMERO · 0005 · PARTY TAG ON REVENUE / EXPENSE LINES OF DOCUMENTS
-- Spec: 149 (vendor spend analysis), 162 (universal transaction tagging),
--       126 (money graph)
-- When an invoice or bill is approved, its revenue / expense lines now carry
-- the party as well as the control-account line. Subledger balances are
-- unaffected: they are computed on control accounts only.
-- Non-destructive: already-posted journals are not touched (posted history
-- is immutable); the change applies to documents approved from now on.
-- =====================================================================
do $patch$
declare
  v text;
  v_old constant text := $a$v_lines := v_lines || jsonb_build_object('account_id', l.account_id, 'description', l.description,$a$;
  v_new constant text := $a$v_lines := v_lines || jsonb_build_object('account_id', l.account_id, 'party_id', inv.party_id, 'description', l.description,$a$;
begin
  select pg_get_functiondef('numero_private.approve_invoice(uuid)'::regprocedure) into v;
  if position(v_new in v) > 0 then
    return;  -- already applied
  end if;
  if position(v_old in v) = 0 then
    raise exception 'NUMERO migration 0005: expected statement not found in approve_invoice; nothing was changed.';
  end if;
  execute replace(v, v_old, v_new);
end
$patch$;

revoke execute on all functions in schema numero_private from public, anon;
grant execute on all functions in schema numero_private to authenticated;
