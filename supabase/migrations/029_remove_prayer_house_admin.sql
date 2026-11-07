-- Migration 029: allow Super Administrators to remove prayer-house administrator appointments.
-- The member remains approved; only the selected active house-admin assignment is deactivated.
create or replace function public.remove_prayer_house_admin(
  p_assignment_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_target_user_id uuid;
  v_target_name text;
  v_house_id smallint;
  v_house_name text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not private.is_super_admin() then
    raise exception 'Only an active Super Administrator may remove a prayer-house administrator.' using errcode = '42501';
  end if;

  select aa.user_id, p.full_name, aa.prayer_house_id, ph.name
    into v_target_user_id, v_target_name, v_house_id, v_house_name
  from public.admin_assignments aa
  join public.profiles p on p.id = aa.user_id
  join public.prayer_houses ph on ph.id = aa.prayer_house_id
  where aa.id = p_assignment_id
    and aa.access_level = 'prayer_house_admin'
    and aa.is_active = true
  for update of aa;

  if v_target_user_id is null then
    raise exception 'The active prayer-house administrator appointment was not found. Refresh the page and try again.' using errcode = 'P0002';
  end if;

  update public.admin_assignments
    set is_active = false
  where id = p_assignment_id
    and access_level = 'prayer_house_admin'
    and is_active = true;

  insert into public.admin_activity_log (
    actor_id,
    action,
    target_user_id,
    details
  )
  values (
    v_actor_id,
    'prayer_house_admin_removed',
    v_target_user_id,
    pg_catalog.jsonb_build_object(
      'prayer_house_id', v_house_id,
      'prayer_house_name', v_house_name,
      'target_name', v_target_name,
      'removed_assignment_id', p_assignment_id
    )
  );

  return true;
end;
$function$;

revoke all on function public.remove_prayer_house_admin(uuid) from public, anon;
grant execute on function public.remove_prayer_house_admin(uuid) to authenticated;
