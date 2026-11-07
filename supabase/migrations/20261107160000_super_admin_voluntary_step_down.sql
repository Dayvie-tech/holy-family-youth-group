create or replace function public.step_down_super_admin_office(p_office text)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_assignment_id uuid;
  v_has_other_office boolean;
  v_has_other_super_admin boolean;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_office is null or p_office not in ('Youth Chaplain','Youth Matron','Youth Patron','Parish Moderator') then
    raise exception 'Choose one of the four recognised Super Admin offices.' using errcode = '22023';
  end if;
  select aa.id into v_assignment_id
  from public.admin_assignments aa
  where aa.user_id = v_actor_id and aa.access_level = 'super_admin'
    and aa.super_admin_office = p_office and aa.is_active = true
  for update;
  if v_assignment_id is null then
    raise exception 'You do not currently hold this Super Admin office.' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.admin_assignments aa
    where aa.user_id = v_actor_id and aa.access_level = 'super_admin'
      and aa.is_active = true and aa.id <> v_assignment_id
  ) into v_has_other_office;
  select exists (
    select 1 from public.admin_assignments aa
    where aa.user_id <> v_actor_id and aa.access_level = 'super_admin' and aa.is_active = true
  ) into v_has_other_super_admin;
  if not v_has_other_office and not v_has_other_super_admin then
    raise exception 'You cannot vacate the final active Super Admin office. Another Super Admin must be appointed first.' using errcode = '23514';
  end if;
  insert into public.admin_activity_log (actor_id, action, target_user_id, details)
  values (v_actor_id, 'super_admin_office_voluntarily_vacated', v_actor_id,
    pg_catalog.jsonb_build_object('office', p_office, 'assignment_id', v_assignment_id, 'status', 'VACANT'));
  update public.admin_assignments set is_active = false
  where id = v_assignment_id and user_id = v_actor_id and is_active = true;
  if not found then
    raise exception 'The office could not be vacated. Please refresh and try again.' using errcode = '40001';
  end if;
end;
$function$;
revoke all on function public.step_down_super_admin_office(text) from public, anon;
grant execute on function public.step_down_super_admin_office(text) to authenticated;
