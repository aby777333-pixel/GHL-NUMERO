-- =====================================================================
-- GHL NUMERO · 0020 · MORE THAN ONE GROUP SUPER ADMIN
-- The owner names people, by email, who hold the same authority as the owner.
-- A person named before they have an account becomes Group Super Admin the moment
-- their email address is confirmed; one who has a confirmed account becomes one at once.
-- Nothing here is reachable except through the functions below, and each grant and
-- withdrawal is written to the audit trail. Additive: nothing existing is altered
-- except that a new trigger watches auth.users for a confirmed address.
-- =====================================================================

create table if not exists public.group_super_admin_grants (
  email text primary key check (email = lower(btrim(email)) and email like '_%@_%._%'),
  group_id uuid not null references public.groups(id),
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  claimed_by uuid references public.profiles(id),
  claimed_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz
);
alter table public.group_super_admin_grants enable row level security;
revoke all on public.group_super_admin_grants from anon, authenticated;
grant select on public.group_super_admin_grants to authenticated;
drop policy if exists group_super_admin_grants_read on public.group_super_admin_grants;
create policy group_super_admin_grants_read on public.group_super_admin_grants
  for select to authenticated using (numero_private.is_group_admin(group_id));

-- Gives the authority of a standing grant to the account of that address, once the address is confirmed.
create or replace function numero_private.apply_super_admin_grant(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_email text; v_confirmed timestamptz; v_meta jsonb; g public.group_super_admin_grants; v_group uuid; v_admin boolean;
begin
  select lower(u.email), u.email_confirmed_at, u.raw_user_meta_data into v_email, v_confirmed, v_meta from auth.users u where u.id = p_user;
  if v_email is null or v_confirmed is null then return false; end if;
  select * into g from public.group_super_admin_grants where email = v_email and revoked_at is null;
  if not found then return false; end if;
  -- the profile is normally made when the account is made; make sure of it
  insert into public.profiles(id, email, full_name)
  values (p_user, v_email, coalesce(v_meta->>'full_name', split_part(v_email, '@', 1)))
  on conflict (id) do nothing;
  select group_id, is_group_super_admin into v_group, v_admin from public.profiles where id = p_user;
  if v_group is not null and v_group <> g.group_id then return false; end if;  -- belongs to another group: never moved
  if v_admin and v_group = g.group_id then
    update public.group_super_admin_grants set claimed_by = coalesce(claimed_by, p_user), claimed_at = coalesce(claimed_at, now()) where email = v_email;
    return true;
  end if;
  update public.profiles set group_id = g.group_id, is_group_super_admin = true where id = p_user;
  update public.group_super_admin_grants set claimed_by = p_user, claimed_at = now() where email = v_email;
  insert into public.audit_log(actor, group_id, entity, entity_id, action, old_value, new_value, reason, meta)
  values (p_user, g.group_id, 'profiles', p_user, 'super_admin_granted',
          jsonb_build_object('group_id', v_group, 'is_group_super_admin', coalesce(v_admin, false)),
          jsonb_build_object('group_id', g.group_id, 'is_group_super_admin', true),
          'Group Super Admin by grant of the Group Super Admin', jsonb_build_object('email', v_email, 'granted_by', g.granted_by));
  return true;
end $$;

create or replace function numero_private.on_auth_user_verified() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null or old.email is distinct from new.email) then
    perform numero_private.apply_super_admin_grant(new.id);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_verified on auth.users;
create trigger on_auth_user_verified after insert or update of email_confirmed_at, email on auth.users
  for each row execute function numero_private.on_auth_user_verified();

-- ---------- the functions a Group Super Admin calls (each checks the caller itself) ----------
create or replace function numero_private.grant_group_super_admin(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_email text := lower(btrim(coalesce(p_email, ''))); v_user uuid; v_group uuid;
begin
  if v_gid is null or not numero_private.is_group_admin(v_gid) then
    raise exception 'NUMERO: only a Group Super Admin can name another.' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'NUMERO: that is not an email address.' using errcode = 'P0001'; end if;
  select p.id, p.group_id into v_user, v_group from public.profiles p where lower(p.email) = v_email;
  if v_group is not null and v_group <> v_gid then raise exception 'NUMERO: this person belongs to a different group.' using errcode = 'P0001'; end if;
  insert into public.group_super_admin_grants(email, group_id, granted_by)
  values (v_email, v_gid, (select auth.uid()))
  on conflict (email) do update set group_id = excluded.group_id, granted_by = excluded.granted_by, granted_at = now(),
    revoked_by = null, revoked_at = null, claimed_by = null, claimed_at = null;
  perform numero_private.log_event(null, 'group_super_admin_grants', null, 'grant', null, jsonb_build_object('email', v_email), 'Named Group Super Admin');
  if v_user is not null and numero_private.apply_super_admin_grant(v_user) then return 'active'; end if;
  return 'pending';
end $$;

create or replace function numero_private.revoke_group_super_admin(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_email text := lower(btrim(coalesce(p_email, ''))); v_owner text; v_user uuid; v_left int;
begin
  if v_gid is null or not numero_private.is_group_admin(v_gid) then
    raise exception 'NUMERO: only a Group Super Admin can withdraw this.' using errcode = 'P0001';
  end if;
  select lower(value #>> '{}') into v_owner from public.app_config where key = 'owner_email';
  if v_email = v_owner then raise exception 'NUMERO: the owner''s authority cannot be withdrawn.' using errcode = 'P0001'; end if;
  select id into v_user from public.profiles where lower(email) = v_email and group_id = v_gid and is_group_super_admin;
  if v_user is not null then
    select count(*) into v_left from public.profiles where group_id = v_gid and is_group_super_admin and id <> v_user;
    if v_left = 0 then raise exception 'NUMERO: the group cannot be left without a Group Super Admin.' using errcode = 'P0001'; end if;
    update public.profiles set is_group_super_admin = false where id = v_user;
  end if;
  update public.group_super_admin_grants set revoked_by = (select auth.uid()), revoked_at = now() where email = v_email and group_id = v_gid and revoked_at is null;
  if v_user is null and not found then raise exception 'NUMERO: % is not a Group Super Admin.', v_email using errcode = 'P0001'; end if;
  perform numero_private.log_event(null, 'group_super_admin_grants', v_user, 'revoke', jsonb_build_object('email', v_email), null, 'Group Super Admin withdrawn');
end $$;

-- Everyone who holds, or has been named to, the authority of Group Super Admin in the caller's group.
create or replace function numero_private.list_group_super_admins()
returns table(email text, full_name text, status text, since timestamptz, is_owner boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_gid uuid := numero_private.my_group(); v_owner text;
begin
  if v_gid is null or not numero_private.is_group_admin(v_gid) then return; end if;
  select lower(value #>> '{}') into v_owner from public.app_config where key = 'owner_email';
  return query
    select lower(p.email), p.full_name, 'active'::text, coalesce(gr.claimed_at, p.created_at), lower(p.email) = v_owner
      from public.profiles p left join public.group_super_admin_grants gr on gr.email = lower(p.email)
     where p.group_id = v_gid and p.is_group_super_admin
    union all
    select gr.email, null::text, 'pending'::text, gr.granted_at, gr.email = v_owner
      from public.group_super_admin_grants gr
     where gr.group_id = v_gid and gr.revoked_at is null
       and not exists (select 1 from public.profiles p where lower(p.email) = gr.email and p.group_id = v_gid and p.is_group_super_admin)
    order by 5 desc, 3, 1;
end $$;

-- the application reaches them through thin public wrappers that run with the caller's rights, as bootstrap_group does
create or replace function public.grant_group_super_admin(p_email text) returns text
language sql set search_path = '' as $$ select numero_private.grant_group_super_admin(p_email) $$;
create or replace function public.revoke_group_super_admin(p_email text) returns void
language sql set search_path = '' as $$ select numero_private.revoke_group_super_admin(p_email) $$;
create or replace function public.list_group_super_admins()
returns table(email text, full_name text, status text, since timestamptz, is_owner boolean)
language sql stable set search_path = '' as $$ select * from numero_private.list_group_super_admins() $$;

revoke all on function numero_private.grant_group_super_admin(text) from public, anon;
revoke all on function numero_private.revoke_group_super_admin(text) from public, anon;
revoke all on function numero_private.list_group_super_admins() from public, anon;
grant execute on function numero_private.grant_group_super_admin(text) to authenticated;
grant execute on function numero_private.revoke_group_super_admin(text) to authenticated;
grant execute on function numero_private.list_group_super_admins() to authenticated;
revoke all on function public.grant_group_super_admin(text) from public, anon;
revoke all on function public.revoke_group_super_admin(text) from public, anon;
revoke all on function public.list_group_super_admins() from public, anon;
grant execute on function public.grant_group_super_admin(text) to authenticated;
grant execute on function public.revoke_group_super_admin(text) to authenticated;
grant execute on function public.list_group_super_admins() to authenticated;
revoke all on function numero_private.apply_super_admin_grant(uuid) from public, anon, authenticated;
revoke all on function numero_private.on_auth_user_verified() from public, anon, authenticated;
