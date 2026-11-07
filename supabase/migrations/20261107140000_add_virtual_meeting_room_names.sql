alter table public.virtual_meetings
  add column if not exists room_name text;

update public.virtual_meetings
set room_name = 'meeting-' || replace(gen_random_uuid()::text, '-', '')
where room_name is null;

alter table public.virtual_meetings
  alter column room_name set not null;

create unique index if not exists virtual_meetings_room_name_key
  on public.virtual_meetings (room_name);
