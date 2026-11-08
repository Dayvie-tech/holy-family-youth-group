-- Preserve leadership appointment history when a member steps down.
-- Super Admins may end a verified appointment; the member account and membership remain untouched.

drop policy if exists appointments_super_admin_end_verified on public.appointments;
create policy appointments_super_admin_end_verified
  on public.appointments
  for update
  to authenticated
  using (
    (select private.is_super_admin())
    and verification_status = 'verified'
  )
  with check (
    (select private.is_super_admin())
    and verification_status = 'verified'
  );

create or replace function private.guard_verified_appointment_end()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.verification_status = 'verified' then
    if new.verification_status is distinct from old.verification_status
       or (pg_catalog.to_jsonb(new) - 'effective_until')
          is distinct from (pg_catalog.to_jsonb(old) - 'effective_until') then
      raise exception 'Verified leadership appointments can only be ended, not edited or reclassified.';
    end if;

    if new.effective_until is distinct from old.effective_until then
      if auth.uid() is null or not private.is_super_admin() then
        raise exception 'Only a Super Admin may end a verified leadership appointment.';
      end if;
      if new.effective_until is distinct from current_date then
        raise exception 'A leadership appointment must be ended using today’s date.';
      end if;
      if old.effective_until is not null and old.effective_until <= current_date then
        raise exception 'This leadership appointment has already ended.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_verified_appointment_end() from public, anon, authenticated;
drop trigger if exists appointments_guard_verified_end on public.appointments;
create trigger appointments_guard_verified_end
  before update on public.appointments
  for each row
  execute function private.guard_verified_appointment_end();

create or replace function private.log_appointment_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_action text;
begin
  if v_actor is null then
    raise exception 'Appointment changes must be performed by an authenticated administrator.';
  end if;

  if new.verification_status is distinct from old.verification_status then
    v_action := case
      when new.verification_status = 'verified' then 'appointment_claim_verified'
      else 'appointment_claim_rejected'
    end;
  elsif new.effective_until is distinct from old.effective_until then
    v_action := 'leadership_appointment_ended';
  else
    return new;
  end if;

  insert into public.admin_activity_log (
    actor_id, action, target_user_id, details
  )
  values (
    v_actor,
    v_action,
    new.member_id,
    pg_catalog.jsonb_build_object(
      'appointment_id', new.id,
      'office_name', new.office_name,
      'scope', new.scope,
      'prayer_house_id', new.prayer_house_id,
      'verification_status', new.verification_status,
      'effective_until', new.effective_until
    )
  );

  return new;
end;
$function$;

create or replace function public.end_leadership_appointment(
  p_appointment_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.is_super_admin() then
    raise exception 'Only a signed-in Super Admin may end a leadership appointment.'
      using errcode = '42501';
  end if;

  update public.appointments
    set effective_until = current_date
  where id = p_appointment_id
    and verification_status = 'verified'
    and (effective_until is null or effective_until > current_date);

  if not found then
    raise exception 'The active leadership appointment was not found. Refresh the workspace and try again.'
      using errcode = 'P0002';
  end if;

  return true;
end;
$function$;

revoke all on function public.end_leadership_appointment(uuid) from public, anon;
grant execute on function public.end_leadership_appointment(uuid) to authenticated;

-- A member cannot be suspended while holding an active verified leadership office.
create or replace function private.guard_member_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if old.membership_status = new.membership_status then
    return new;
  end if;

  if old.membership_status = 'pending' and new.membership_status = 'approved' then
    return new;
  end if;

  if not (
    (old.membership_status = 'approved' and new.membership_status = 'suspended')
    or
    (old.membership_status = 'suspended' and new.membership_status = 'pending')
  ) then
    raise exception 'Unsupported membership status transition.';
  end if;

  if v_actor is null or not private.is_super_admin() then
    raise exception 'Only a signed-in Super Admin may change active membership status.';
  end if;
  if old.id = v_actor then
    raise exception 'You cannot change your own membership through member management.';
  end if;
  if exists (
    select 1
    from public.admin_assignments aa
    where aa.user_id = old.id and aa.is_active = true
  ) then
    raise exception 'This member still holds an active administrator appointment. End or transfer that appointment first.';
  end if;
  if new.membership_status = 'suspended' and exists (
    select 1
    from public.appointments a
    where a.member_id = old.id
      and a.verification_status = 'verified'
      and (a.effective_until is null or a.effective_until > current_date)
  ) then
    raise exception 'This member still holds an active leadership office. End that leadership appointment first.';
  end if;

  insert into public.admin_activity_log(actor_id, action, target_user_id, details)
  values (
    v_actor,
    case
      when new.membership_status = 'suspended' then 'member_removed_from_active_roster'
      else 'member_returned_to_pending_review'
    end,
    old.id,
    pg_catalog.jsonb_build_object(
      'previous_status', old.membership_status,
      'new_status', new.membership_status,
      'prayer_house_id', old.primary_prayer_house_id
    )
  );

  return new;
end;
$$;

revoke all on function private.guard_member_status_transition() from public, anon, authenticated;
