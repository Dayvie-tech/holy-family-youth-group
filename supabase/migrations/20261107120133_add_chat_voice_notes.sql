alter table public.chat_messages
  add column if not exists message_type text not null default 'text',
  add column if not exists audio_path text,
  add column if not exists audio_duration_seconds integer;

alter table public.chat_messages
  drop constraint if exists chat_messages_body_check,
  drop constraint if exists chat_messages_content_check;

alter table public.chat_messages
  add constraint chat_messages_content_check check (
    (deleted_at is not null and body = '[Message removed by an administrator]')
    or (message_type = 'text' and audio_path is null and audio_duration_seconds is null and char_length(body) between 1 and 2000)
    or (message_type = 'audio' and body = '' and audio_path is not null and audio_duration_seconds between 1 and 120)
  ),
  add constraint chat_messages_type_check check (message_type in ('text', 'audio'));

create or replace function private.prepare_chat_message()
returns trigger language plpgsql security definer
set search_path to 'public', 'private'
as $function$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or not private.is_approved_chat_member() then
      raise exception 'Only approved members can send chat messages';
    end if;
    if not private.can_access_chat_room(new.room_id) then
      raise exception 'You are not allowed to access this chat room';
    end if;
    select coalesce(nullif(btrim(p.display_name), ''), p.full_name) into v_name
    from public.profiles p where p.id = auth.uid() and p.membership_status = 'approved';
    if v_name is null then raise exception 'Your approved member profile could not be found'; end if;
    new.author_id := auth.uid();
    new.author_display_name := v_name;
    new.created_at := now();
    new.edited_at := null;
    new.deleted_at := null;
    new.deleted_by := null;
    if new.message_type = 'text' then
      new.body := btrim(new.body);
      new.audio_path := null;
      new.audio_duration_seconds := null;
      if char_length(new.body) < 1 or char_length(new.body) > 2000 then
        raise exception 'Messages must contain between 1 and 2000 characters';
      end if;
    elsif new.message_type = 'audio' then
      if coalesce(new.body, '') <> '' then raise exception 'Voice notes cannot contain text content'; end if;
      if new.audio_path is null
         or split_part(new.audio_path, '/', 1) <> new.room_id::text
         or split_part(new.audio_path, '/', 2) <> auth.uid()::text
         or new.audio_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9-]+\.(webm|ogg|mp4|m4a|aac)$'
         or new.audio_duration_seconds is null
         or new.audio_duration_seconds < 1
         or new.audio_duration_seconds > 120 then
        raise exception 'The voice note details are invalid';
      end if;
      new.body := '';
    else
      raise exception 'Unsupported chat message type';
    end if;
    return new;
  end if;

  if old.deleted_at is not null then raise exception 'This message has already been removed'; end if;
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is null or new.deleted_by is distinct from auth.uid()
       or new.body <> '[Message removed by an administrator]'
       or not private.can_moderate_chat_room(old.room_id) then
      raise exception 'You are not allowed to remove this message';
    end if;
    new.edited_at := old.edited_at;
    return new;
  end if;

  if old.author_id <> auth.uid() or new.room_id <> old.room_id
     or new.author_id <> old.author_id
     or new.author_display_name <> old.author_display_name
     or new.created_at <> old.created_at
     or new.deleted_by is distinct from old.deleted_by
     or new.message_type is distinct from old.message_type
     or new.audio_path is distinct from old.audio_path
     or new.audio_duration_seconds is distinct from old.audio_duration_seconds then
    raise exception 'You can only edit your own message text';
  end if;
  if old.message_type <> 'text' then raise exception 'Voice notes cannot be edited'; end if;
  new.body := btrim(new.body);
  if char_length(new.body) < 1 or char_length(new.body) > 2000 then
    raise exception 'Messages must contain between 1 and 2000 characters';
  end if;
  new.edited_at := now();
  return new;
end;
$function$;

create or replace function private.create_chat_notifications()
returns trigger language plpgsql security definer
set search_path to ''
as $function$
declare
  target_room public.chat_rooms%rowtype;
  notification_text text;
begin
  if new.deleted_at is not null then return new; end if;
  select * into target_room from public.chat_rooms where id = new.room_id;
  if not found then return new; end if;
  notification_text := case when new.message_type = 'audio'
    then new.author_display_name || ': Sent a voice note'
    else left(new.author_display_name || ': ' || new.body, 180) end;
  insert into public.notifications (user_id, notification_type, title, message, target_url, source_id)
  select p.id, 'chat', 'New message in ' || target_room.name, notification_text,
         'chat.html?room=' || target_room.id::text, new.id
  from public.profiles p
  where p.membership_status = 'approved' and p.id <> new.author_id
    and (
      target_room.room_type = 'general'
      or (target_room.room_type = 'prayer_house' and (
        p.primary_prayer_house_id = target_room.prayer_house_id
        or exists (select 1 from public.admin_assignments aa where aa.user_id = p.id
          and aa.access_level = 'prayer_house_admin' and aa.prayer_house_id = target_room.prayer_house_id and aa.is_active = true)
        or exists (select 1 from public.admin_assignments aa where aa.user_id = p.id
          and aa.access_level in ('parish_admin','super_admin') and aa.is_active = true)
      ))
      or (target_room.room_type = 'leadership' and (
        exists (select 1 from public.admin_assignments aa where aa.user_id = p.id and aa.is_active = true)
        or exists (select 1 from public.appointments a where a.member_id = p.id
          and a.verification_status = 'verified'
          and (a.effective_from is null or a.effective_from <= current_date)
          and (a.effective_until is null or a.effective_until >= current_date))
      ))
    )
  on conflict (user_id, notification_type, source_id) do nothing;
  return new;
end;
$function$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-voice-notes', 'chat-voice-notes', false, 5242880,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/mpeg'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_voice_notes_read_authorised on storage.objects;
drop policy if exists chat_voice_notes_upload_authorised on storage.objects;
drop policy if exists chat_voice_notes_delete_own on storage.objects;

create policy chat_voice_notes_read_authorised on storage.objects for select to authenticated
using (bucket_id = 'chat-voice-notes' and exists (
  select 1 from public.chat_rooms r
  where r.id::text = (storage.foldername(name))[1] and private.can_access_chat_room(r.id)
));
create policy chat_voice_notes_upload_authorised on storage.objects for insert to authenticated
with check (bucket_id = 'chat-voice-notes'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (select 1 from public.chat_rooms r
    where r.id::text = (storage.foldername(name))[1] and private.can_access_chat_room(r.id))
);
create policy chat_voice_notes_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'chat-voice-notes'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (select 1 from public.chat_rooms r
    where r.id::text = (storage.foldername(name))[1] and private.can_access_chat_room(r.id))
);