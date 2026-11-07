-- Tighten chat moderation: use caller privileges plus RLS rather than a SECURITY DEFINER RPC.
create or replace function public.moderate_chat_message(p_message_id uuid)
returns void language plpgsql security invoker set search_path = public, private
as $$
declare v_room_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select m.room_id into v_room_id from public.chat_messages m where m.id = p_message_id and m.deleted_at is null;
  if v_room_id is null then raise exception 'Message not found or already removed'; end if;
  if not private.can_moderate_chat_room(v_room_id) then raise exception 'You are not allowed to moderate this chat room'; end if;
  update public.chat_messages set body='[Message removed by an administrator]', deleted_at=now(), deleted_by=auth.uid()
  where id=p_message_id and deleted_at is null;
end;
$$;
drop policy if exists chat_messages_moderator_update on public.chat_messages;
create policy chat_messages_moderator_update on public.chat_messages for update to authenticated
using (private.can_moderate_chat_room(room_id)) with check (private.can_moderate_chat_room(room_id));
revoke all on function public.moderate_chat_message(uuid) from public, anon;
grant execute on function public.moderate_chat_message(uuid) to authenticated;
grant update (body, deleted_at, deleted_by) on public.chat_messages to authenticated;
