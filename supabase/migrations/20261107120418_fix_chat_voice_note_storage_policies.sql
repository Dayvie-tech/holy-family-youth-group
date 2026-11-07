drop policy if exists chat_voice_notes_read_authorised on storage.objects;
drop policy if exists chat_voice_notes_upload_authorised on storage.objects;
drop policy if exists chat_voice_notes_delete_own on storage.objects;

create policy chat_voice_notes_read_authorised
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-voice-notes'
  and exists (
    select 1 from public.chat_rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and private.can_access_chat_room(r.id)
  )
);

create policy chat_voice_notes_upload_authorised
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-voice-notes'
  and (storage.foldername(objects.name))[2] = (select auth.uid())::text
  and exists (
    select 1 from public.chat_rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and private.can_access_chat_room(r.id)
  )
);

create policy chat_voice_notes_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-voice-notes'
  and (storage.foldername(objects.name))[2] = (select auth.uid())::text
  and exists (
    select 1 from public.chat_rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and private.can_access_chat_room(r.id)
  )
);