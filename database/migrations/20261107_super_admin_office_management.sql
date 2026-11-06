-- Super Admin office assignment workflow
-- Applied to the Supabase project on 2026-11-07.
-- The RPC runs as SECURITY INVOKER and relies on explicit RLS policies.

drop policy if exists admin_activity_log_super_admin_insert on public.admin_activity_log;
create policy admin_activity_log_super_admin_insert
on public.admin_activity_log
for insert
to authenticated
with check (
  actor_id = (select auth.uid())
  and (select private.is_super_admin())
);

create or replace function public.assign_super_admin_office(
  p_target_user_id uuid,
  p_office text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_assignment_id uuid;
  v_target_name text;
  v_previous_ids uuid[];
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not private.is_super_admin() then
    raise exception 'Only an active Super Administrator may manage Super Admin offices.' using errcode = '42501';
  end if;

  if p_office is null or p_office not in (
    'Youth Chaplain',
    'Youth Matron',
    'Youth Patron',
    'Parish Moderator'
  ) then
    raise exception 'Choose one of the four recognised Super Admin offices.' using errcode = '22023';
  end if;

  select p.full_name
    into v_target_name
  from public.profiles p
  where p.id = p_target_user_id
    and p.membership_status = 'approved';

  if v_target_name is null then
    raise exception 'The selected member does not have an approved membership.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_office)::bigint);

  select pg_catalog.array_agg(aa.id)
    into v_previous_ids
  from public.admin_assignments aa
  where aa.access_level = 'super_admin'
    and aa.super_admin_office = p_office
    and aa.is_active = true;

  -- Insert and audit while the acting administrator still holds their authority.
  -- The following deactivation occurs in the same transaction, so external readers
  -- only see the final, consistent office holder after commit.
  insert into public.admin_assignments (
    user_id, access_level, prayer_house_id, super_admin_office, is_active, assigned_by
  )
  values (
    p_target_user_id, 'super_admin', null, p_office, true, v_actor_id
  )
  returning id into v_assignment_id;

  insert into public.admin_activity_log (actor_id, action, target_user_id, details)
  values (
    v_actor_id,
    'super_admin_office_assigned',
    p_target_user_id,
    pg_catalog.jsonb_build_object(
      'office', p_office,
      'target_name', v_target_name,
      'previous_assignment_ids', coalesce(v_previous_ids, '{}'::uuid[]),
      'new_assignment_id', v_assignment_id
    )
  );

  update public.admin_assignments
    set is_active = false
  where id = any(coalesce(v_previous_ids, '{}'::uuid[]));

  return v_assignment_id;
end;
$function$;

revoke all on function public.assign_super_admin_office(uuid, text) from public;
revoke all on function public.assign_super_admin_office(uuid, text) from anon;
grant execute on function public.assign_super_admin_office(uuid, text) to authenticated;
