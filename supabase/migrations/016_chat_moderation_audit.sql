create table if not exists private.chat_message_moderation_log (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete restrict,
  room_id uuid not null references public.chat_rooms(id) on delete restrict,
  moderator_id uuid not null references public.profiles(id) on delete restrict,
  original_body text not null,
  removed_at timestamptz not null default now()
);
create index if not exists chat_message_moderation_log_room_removed_idx
  on private.chat_message_moderation_log(room_id, removed_at desc);
revoke all on private.chat_message_moderation_log from public, anon, authenticated;
create or replace function private.audit_chat_message_moderation()
returns trigger language plpgsql security definer set search_path = public, private
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    insert into private.chat_message_moderation_log (message_id, room_id, moderator_id, original_body, removed_at)
    values (new.id, new.room_id, new.deleted_by, old.body, new.deleted_at);
  end if;
  return new;
end;
$$;
drop trigger if exists chat_messages_moderation_audit on public.chat_messages;
create trigger chat_messages_moderation_audit after update on public.chat_messages
for each row execute function private.audit_chat_message_moderation();
