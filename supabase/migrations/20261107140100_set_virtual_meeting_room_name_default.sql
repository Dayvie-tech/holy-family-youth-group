alter table public.virtual_meetings
  alter column room_name set default ('meeting-' || replace(gen_random_uuid()::text, '-', ''));
