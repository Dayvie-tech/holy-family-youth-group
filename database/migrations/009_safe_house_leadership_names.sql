-- Migration 009: expose leadership names without opening private profile rows.
-- Appointment rows already have house-scoped RLS. Store a safe display-name
-- snapshot on each appointment so authorised house admins can render a roster
-- without querying private profile columns.

drop function if exists public.get_house_leadership(smallint);

alter table public.appointments
  add column if not exists member_display_name text;

update public.appointments as a
set member_display_name = coalesce(nullif(p.display_name, ''), p.full_name)
from public.profiles as p
where p.id = a.member_id
  and a.member_display_name is distinct from coalesce(nullif(p.display_name, ''), p.full_name);

create or replace function private.set_appointment_member_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  select coalesce(nullif(p.display_name, ''), p.full_name)
    into new.member_display_name
  from public.profiles as p
  where p.id = new.member_id;

  if new.member_display_name is null then
    raise exception 'The appointment member profile could not be found.';
  end if;

  return new;
end;
$function$;

revoke all on function private.set_appointment_member_display_name() from public, anon, authenticated;

drop trigger if exists appointments_set_member_display_name on public.appointments;
create trigger appointments_set_member_display_name
  before insert or update of member_id on public.appointments
  for each row
  execute function private.set_appointment_member_display_name();

create index if not exists appointments_house_verified_effective_idx
  on public.appointments (prayer_house_id, verification_status, effective_from, effective_until)
  where scope = 'prayer_house';
