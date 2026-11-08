-- Allow Super Admins to appoint existing approved members to verified leadership positions.
-- This does not create or alter Auth users, profiles, or membership status.

drop policy if exists appointments_super_admin_assign_verified on public.appointments;
create policy appointments_super_admin_assign_verified
  on public.appointments
  for insert
  to authenticated
  with check (
    (select private.is_super_admin())
    and verification_status = 'verified'
    and verified_by = (select auth.uid())
    and verified_at is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = member_id
        and p.membership_status = 'approved'
        and (
          (scope = 'parish' and prayer_house_id is null)
          or
          (scope = 'prayer_house' and p.primary_prayer_house_id = prayer_house_id)
        )
    )
  );

create or replace function public.assign_leadership_position(
  p_member_id uuid,
  p_office_name text,
  p_scope text,
  p_prayer_house_id smallint default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_member public.profiles%rowtype;
  v_appointment_id uuid;
  v_slot_key text;
begin
  if v_actor is null or not private.is_super_admin() then
    raise exception 'Only a signed-in Super Admin may assign leadership positions.'
      using errcode = '42501';
  end if;

  if p_office_name is null or p_office_name not in (
    'Chairperson', 'Vice Chairperson', 'Secretary', 'Vice Secretary',
    'Organizing Secretary', 'Treasurer', 'Project Manager',
    'Assistant Project Manager', 'Games Coordinator', 'Catechist',
    'Patron', 'Matron', 'Chaplain'
  ) then
    raise exception 'Choose a valid parish or prayer-house leadership position.';
  end if;

  if p_scope is null or p_scope not in ('parish', 'prayer_house') then
    raise exception 'Choose either a parish-wide or prayer-house appointment.';
  end if;

  select *
    into v_member
  from public.profiles
  where id = p_member_id;

  if not found or v_member.membership_status <> 'approved' then
    raise exception 'Only an existing approved member can receive a leadership appointment.';
  end if;

  if p_scope = 'parish' then
    if p_prayer_house_id is not null then
      raise exception 'A parish-wide appointment cannot be linked to a prayer house.';
    end if;
  else
    if p_prayer_house_id is null
       or v_member.primary_prayer_house_id is distinct from p_prayer_house_id
       or not exists (
         select 1 from public.prayer_houses h
         where h.id = p_prayer_house_id and h.is_active = true
       ) then
      raise exception 'A prayer-house appointment must use the selected member’s active registered prayer house.';
    end if;
  end if;

  if p_office_name = 'Chaplain'
     and (p_scope <> 'parish' or v_member.gender is distinct from 'male'
       or (v_member.chaplain_title is distinct from 'Father' and v_member.chaplain_title is distinct from 'Deacon')) then
    raise exception 'The Parish Chaplain appointment requires a male member whose Church title is Father or Deacon.';
  end if;

  v_slot_key := p_scope || ':' || p_office_name || ':' || coalesce(p_prayer_house_id::text, 'parish');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_slot_key, 0));

  if exists (
    select 1
    from public.appointments a
    where a.office_name = p_office_name
      and a.scope = p_scope
      and a.prayer_house_id is not distinct from p_prayer_house_id
      and a.verification_status = 'verified'
      and (a.effective_from is null or a.effective_from <= current_date)
      and (a.effective_until is null or a.effective_until > current_date)
  ) then
    raise exception 'This leadership position already has an active holder. End the current appointment above before assigning a replacement.';
  end if;

  insert into public.appointments (
    member_id, office_name, scope, prayer_house_id,
    verification_status, verified_by, verified_at, effective_from
  )
  values (
    p_member_id, p_office_name, p_scope, p_prayer_house_id,
    'verified', v_actor, pg_catalog.now(), current_date
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$function$;

revoke all on function public.assign_leadership_position(uuid, text, text, smallint) from public, anon;
grant execute on function public.assign_leadership_position(uuid, text, text, smallint) to authenticated;

create or replace function private.log_super_admin_leadership_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if new.verification_status <> 'verified' then
    return new;
  end if;

  if v_actor is null or v_actor is distinct from new.verified_by
     or not private.is_super_admin() then
    raise exception 'Verified leadership appointments must be assigned by a signed-in Super Admin.';
  end if;

  insert into public.admin_activity_log (
    actor_id, action, target_user_id, details
  )
  values (
    v_actor,
    'leadership_appointment_assigned',
    new.member_id,
    pg_catalog.jsonb_build_object(
      'appointment_id', new.id,
      'office_name', new.office_name,
      'scope', new.scope,
      'prayer_house_id', new.prayer_house_id,
      'verification_status', new.verification_status,
      'effective_from', new.effective_from
    )
  );

  return new;
end;
$function$;

revoke all on function private.log_super_admin_leadership_assignment() from public, anon, authenticated;
drop trigger if exists appointments_log_super_admin_assignment on public.appointments;
create trigger appointments_log_super_admin_assignment
  after insert on public.appointments
  for each row
  execute function private.log_super_admin_leadership_assignment();
