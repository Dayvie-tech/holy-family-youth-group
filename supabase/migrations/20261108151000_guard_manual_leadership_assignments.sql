-- Enforce manual Super Admin appointment rules for every verified INSERT,
-- including direct Data API inserts that do not call the assignment RPC.

create or replace function private.guard_verified_leadership_assignment_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_member public.profiles%rowtype;
  v_actor uuid := auth.uid();
  v_slot_key text;
begin
  if new.verification_status <> 'verified' then
    return new;
  end if;

  if v_actor is null or not private.is_super_admin()
     or new.verified_by is distinct from v_actor then
    raise exception 'Only a signed-in Super Admin may create a verified leadership appointment.'
      using errcode = '42501';
  end if;

  if new.office_name is null or new.office_name not in (
    'Chairperson', 'Vice Chairperson', 'Secretary', 'Vice Secretary',
    'Organizing Secretary', 'Treasurer', 'Project Manager',
    'Assistant Project Manager', 'Games Coordinator', 'Catechist',
    'Patron', 'Matron', 'Chaplain'
  ) then
    raise exception 'Choose a valid parish or prayer-house leadership position.';
  end if;

  if new.scope not in ('parish', 'prayer_house') then
    raise exception 'Choose either a parish-wide or prayer-house appointment.';
  end if;

  if new.effective_from is distinct from current_date or new.effective_until is not null then
    raise exception 'A new manual appointment must start today and must not have an end date.';
  end if;

  select *
    into v_member
  from public.profiles
  where id = new.member_id
    and membership_status = 'approved';

  if not found then
    raise exception 'Only an existing approved member can receive a leadership appointment.';
  end if;

  if new.scope = 'parish' then
    if new.prayer_house_id is not null then
      raise exception 'A parish-wide appointment cannot be linked to a prayer house.';
    end if;
  else
    if new.prayer_house_id is null
       or v_member.primary_prayer_house_id is distinct from new.prayer_house_id
       or not exists (
         select 1 from public.prayer_houses h
         where h.id = new.prayer_house_id and h.is_active = true
       ) then
      raise exception 'A prayer-house appointment must use the selected member’s active registered prayer house.';
    end if;
  end if;

  if new.office_name = 'Chaplain'
     and (new.scope <> 'parish' or v_member.gender is distinct from 'male'
       or (v_member.chaplain_title is distinct from 'Father' and v_member.chaplain_title is distinct from 'Deacon')) then
    raise exception 'The Parish Chaplain appointment requires a male member whose Church title is Father or Deacon.';
  end if;

  v_slot_key := new.scope || ':' || new.office_name || ':' || coalesce(new.prayer_house_id::text, 'parish');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_slot_key, 0));

  if exists (
    select 1
    from public.appointments a
    where a.office_name = new.office_name
      and a.scope = new.scope
      and a.prayer_house_id is not distinct from new.prayer_house_id
      and a.verification_status = 'verified'
      and (a.effective_from is null or a.effective_from <= current_date)
      and (a.effective_until is null or a.effective_until > current_date)
  ) then
    raise exception 'This leadership position already has an active holder. End the current appointment before assigning a replacement.';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_verified_leadership_assignment_insert() from public, anon, authenticated;
drop trigger if exists appointments_guard_super_admin_assignment on public.appointments;
create trigger appointments_guard_super_admin_assignment
  before insert on public.appointments
  for each row
  execute function private.guard_verified_leadership_assignment_insert();
