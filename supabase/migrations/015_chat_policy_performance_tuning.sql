
create index if not exists chat_rooms_prayer_house_id_idx on public.chat_rooms(prayer_house_id);
create index if not exists chat_messages_deleted_by_idx on public.chat_messages(deleted_by);
drop policy if exists chat_messages_update_own on public.chat_messages;
drop policy if exists chat_messages_moderator_update on public.chat_messages;
create policy chat_messages_update_author_or_moderator on public.chat_messages for update to authenticated
using ((author_id = (select auth.uid()) and deleted_at is null) or private.can_moderate_chat_room(room_id))
with check ((author_id = (select auth.uid()) and deleted_at is null) or private.can_moderate_chat_room(room_id));
drop policy if exists chat_messages_insert_authorised on public.chat_messages;
create policy chat_messages_insert_authorised on public.chat_messages for insert to authenticated
with check (author_id = (select auth.uid()) and private.can_access_chat_room(room_id));
