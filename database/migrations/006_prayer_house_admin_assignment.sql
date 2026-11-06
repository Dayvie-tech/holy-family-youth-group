-- Migration 006: audited prayer-house administrator appointments.
-- Only active Super Administrators may appoint or transfer a prayer-house administrator.
-- The function runs as invoker so existing RLS policies remain in force.

create or replace function public.assign_prayer_house_admin(
  p_target_user_id uuid,
  p_prayer_house_id smallint
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
  v_house_name text;
  v_previous_ids uuid[];
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not private.is_super_admin() then
    raise exception 'Only an active Super Administrator may appoint prayer-house administrators.' using errcode = '42501';
  end if;

  select p.full_name
    into v_target_name
  from public.profiles p
  where p.id = p_target_user_id
    and p.membership_status = 'approved';

  if v_target_name is null then
    raise exception 'The selected member does not have an approved membership.' using errcode = '22023';
  end if;

  select ph.name
    into v_house_name
  from public.prayer_houses ph
  where ph.id = p_prayer_house_id
    and ph.is_active = true;

  if v_house_name is null then
    raise exception 'Choose an active prayer house.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('prayer_house_admin:' || p_prayer_house_id::text)::bigint
  );

  select aa.id
    into v_assignment_id
  from public.admin_assignments aa
  where aa.user_id = p_target_user_id
    and aa.access_level = 'prayer_house_admin'
    and aa.prayer_house_id = p_prayer_house_id
    and aa.is_active = true
  limit 1;

  if v_assignment_id is not null then
    return v_assignment_id;
  end if;

  select coalesce(pg_catalog.array_agg(aa.id), '{}'::uuid[])
    into v_previous_ids
  from public.admin_assignments aa
  where aa.access_level = 'prayer_house_admin'
    and aa.prayer_house_id = p_prayer_house_id
    and aa.is_active = true;

  insert into public.admin_assignments (
    user_id,
    access_level,
    prayer_house_id,
    super_admin_office,
    is_active,
    assigned_by
  )
  values (
    p_target_user_id,
    'prayer_house_admin',
    p_prayer_house_id,
    null,
    true,
    v_actor_id
  )
  returning id into v_assignment_id;

  insert into public.admin_activity_log (
    actor_id,
    action,
    target_user_id,
    details
  )
  values (
    v_actor_id,
    'prayer_house_admin_assigned',
    p_target_user_id,
    pg_catalog.jsonb_build_object(
      'prayer_house_id', p_prayer_house_id,
      'prayer_house_name', v_house_name,
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

revoke all on function public.assign_prayer_house_admin(uuid, smallint) from public, anon;
grant execute on function public.assign_prayer_house_admin(uuid, smallint) to authenticated;

-- The existing Super Admin assignment RPC is also restricted to signed-in callers.
revoke all on function public.assign_super_admin_office(uuid, text) from public, anon;
grant execute on function public.assign_super_admin_office(uuid, text) to authenticated;
