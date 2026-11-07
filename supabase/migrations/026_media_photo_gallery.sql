-- Holy Family Youth Group: Media & Photo Gallery
create table public.gallery_albums (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 180),
  description text not null default '' check (char_length(description) <= 3000),
  event_date date,
  prayer_house_id smallint references public.prayer_houses(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','pending','approved','published','rejected','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gallery_albums_public_idx
  on public.gallery_albums (event_date desc nulls last, created_at desc)
  where status = 'published';
create index gallery_albums_admin_idx
  on public.gallery_albums (status, updated_at desc);

create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.gallery_albums(id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  caption text not null default '' check (char_length(caption) <= 500),
  alt_text text not null check (char_length(btrim(alt_text)) between 3 and 300),
  display_order integer not null default 0,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index gallery_photos_album_order_idx
  on public.gallery_photos (album_id, display_order, created_at);

alter table public.gallery_albums enable row level security;
alter table public.gallery_photos enable row level security;
revoke all on public.gallery_albums, public.gallery_photos from public, anon, authenticated;
grant select, insert, update, delete on public.gallery_albums, public.gallery_photos to authenticated;

create policy "gallery_admin_reads_albums" on public.gallery_albums
for select to authenticated using ((select private.has_parish_admin_access()));
create policy "gallery_admin_creates_albums" on public.gallery_albums
for insert to authenticated with check (
  (select private.has_parish_admin_access())
  and created_by = (select auth.uid())
  and status in ('draft','pending')
  and reviewed_by is null and reviewed_at is null and published_at is null
);
create policy "gallery_admin_updates_albums" on public.gallery_albums
for update to authenticated using ((select private.has_parish_admin_access()))
with check (
  (select private.has_parish_admin_access())
  and (
    status not in ('approved','published','rejected')
    or (created_by <> (select auth.uid()) and reviewed_by = (select auth.uid()) and reviewed_at is not null)
  )
  and (status <> 'published' or published_at is not null)
);
create policy "gallery_admin_deletes_albums" on public.gallery_albums
for delete to authenticated using ((select private.has_parish_admin_access()));

create policy "gallery_admin_reads_photos" on public.gallery_photos
for select to authenticated using ((select private.has_parish_admin_access()));
create policy "gallery_admin_creates_photos" on public.gallery_photos
for insert to authenticated with check (
  (select private.has_parish_admin_access())
  and created_by = (select auth.uid())
  and exists (select 1 from public.gallery_albums a where a.id = album_id)
);
create policy "gallery_admin_updates_photos" on public.gallery_photos
for update to authenticated using ((select private.has_parish_admin_access()))
with check ((select private.has_parish_admin_access()));
create policy "gallery_admin_deletes_photos" on public.gallery_photos
for delete to authenticated using ((select private.has_parish_admin_access()));

create or replace function private.set_gallery_album_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'The original album creator cannot be changed.';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke execute on function private.set_gallery_album_updated_at() from public, anon, authenticated;
create trigger gallery_albums_set_updated_at before update on public.gallery_albums
for each row execute function private.set_gallery_album_updated_at();

create or replace function private.guard_gallery_photo_owner()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'The original photo uploader cannot be changed.';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_gallery_photo_owner() from public, anon, authenticated;
create trigger gallery_photos_guard_owner before update on public.gallery_photos
for each row execute function private.guard_gallery_photo_owner();

create table private.gallery_audit_log (
  id bigint generated always as identity primary key,
  record_type text not null check (record_type in ('album','photo')),
  record_id uuid not null,
  actor_id uuid,
  action text not null,
  old_status text,
  new_status text,
  changed_at timestamptz not null default now()
);
revoke all on private.gallery_audit_log from public, anon, authenticated;

create or replace function private.audit_gallery_album_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.gallery_audit_log(record_type,record_id,actor_id,action,old_status,new_status)
  values ('album',coalesce(new.id,old.id),auth.uid(),tg_op,
    case when tg_op = 'INSERT' then null else old.status end,
    case when tg_op = 'DELETE' then null else new.status end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function private.audit_gallery_album_change() from public, anon, authenticated;
create trigger gallery_albums_audit after insert or update or delete on public.gallery_albums
for each row execute function private.audit_gallery_album_change();

create or replace function private.audit_gallery_photo_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.gallery_audit_log(record_type,record_id,actor_id,action)
  values ('photo',coalesce(new.id,old.id),auth.uid(),tg_op);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function private.audit_gallery_photo_change() from public, anon, authenticated;
create trigger gallery_photos_audit after insert or update or delete on public.gallery_photos
for each row execute function private.audit_gallery_photo_change();

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('gallery-media','gallery-media',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "gallery_media_admin_read" on storage.objects
for select to authenticated using (
  bucket_id = 'gallery-media' and (select private.has_parish_admin_access())
);
create policy "gallery_media_admin_upload" on storage.objects
for insert to authenticated with check (
  bucket_id = 'gallery-media' and (select private.has_parish_admin_access())
);
create policy "gallery_media_admin_update" on storage.objects
for update to authenticated using (
  bucket_id = 'gallery-media' and (select private.has_parish_admin_access())
) with check (
  bucket_id = 'gallery-media' and (select private.has_parish_admin_access())
);
create policy "gallery_media_admin_delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'gallery-media' and (select private.has_parish_admin_access())
);

create or replace view public.published_gallery_albums
with (security_barrier = true, security_invoker = false)
as
select id,title,description,event_date,prayer_house_id,published_at,created_at
from public.gallery_albums
where status = 'published';
revoke all on public.published_gallery_albums from public, anon, authenticated;
grant select on public.published_gallery_albums to anon, authenticated;

create or replace view public.published_gallery_photos
with (security_barrier = true, security_invoker = false)
as
select p.id,p.album_id,p.storage_path,p.caption,p.alt_text,p.display_order,p.created_at
from public.gallery_photos p
join public.gallery_albums a on a.id = p.album_id
where a.status = 'published';
revoke all on public.published_gallery_photos from public, anon, authenticated;
grant select on public.published_gallery_photos to anon, authenticated;

comment on view public.published_gallery_albums is
  'Public-facing published photo albums only; internal creator and reviewer information is not exposed.';
comment on view public.published_gallery_photos is
  'Public-facing photos from published albums only; internal uploader information is not exposed.';

create policy "gallery_media_published_read" on storage.objects
for select to anon, authenticated using (
  bucket_id = 'gallery-media'
  and exists (
    select 1 from public.published_gallery_photos p
    where p.storage_path = name
  )
);
