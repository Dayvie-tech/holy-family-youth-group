-- Make Heritage uploads private and expose only photos attached to published records.
update storage.buckets
set public = false
where id = 'heritage-media';

drop policy if exists heritage_media_public_read on storage.objects;
drop policy if exists heritage_media_admin_read on storage.objects;
drop policy if exists heritage_media_published_read on storage.objects;

create policy heritage_media_admin_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'heritage-media'
  and (select private.has_parish_admin_access())
);

create policy heritage_media_published_read
on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'heritage-media'
  and exists (
    select 1
    from public.published_heritage_entries e
    where e.photo_path = objects.name
  )
);

create index if not exists heritage_entries_published_photo_path_idx
on public.heritage_entries (photo_path)
where status = 'published' and photo_path is not null;
