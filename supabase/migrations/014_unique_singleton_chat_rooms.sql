create unique index if not exists chat_rooms_singleton_type_idx
on public.chat_rooms(room_type)
where prayer_house_id is null;
