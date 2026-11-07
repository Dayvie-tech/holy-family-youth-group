-- Holy Family Youth Group: History & Heritage content manager
create table public.heritage_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 180),
  category text not null check (category in ('beginnings','faith-fellowship','leadership-service','projects-milestones','photo-memories')),
  body text not null check (char_length(btrim(body)) between 10 and 20000),
  event_date date,
  photo_path text,
  photo_caption text,
  status text not null default 'draft' check (status in ('draft','pending','published','rejected','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index heritage_entries_public_order_idx on public.heritage_entries (category, event_date desc nulls last, created_at desc) where status = 'published';
create index heritage_entries_admin_queue_idx on public.heritage_entries (status, updated_at desc);
alter table public.heritage_entries enable row level security;
revoke all on public.heritage_entries from public, anon, authenticated;
grant select on public.heritage_entries to authenticated;
grant insert, update on public.heritage_entries to authenticated;

create policy "heritage_public_reads_published" on public.heritage_entries
for select to anon, authenticated using (status = 'published');
create policy "heritage_admin_reads_all" on public.heritage_entries
for select to authenticated using ((select private.has_parish_admin_access()));
create policy "heritage_approved_members_submit_memories" on public.heritage_entries
for insert to authenticated with check (
  status = 'pending' and created_by = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.membership_status = 'approved')
);
create policy "heritage_admin_creates_entries" on public.heritage_entries
for insert to authenticated with check ((select private.has_parish_admin_access()) and created_by = (select auth.uid()) and status in ('draft','pending'));
create policy "heritage_admin_updates_entries" on public.heritage_entries
for update to authenticated using ((select private.has_parish_admin_access()))
with check ((select private.has_parish_admin_access()) and (status <> 'published' or (created_by <> (select auth.uid()) and reviewed_by = (select auth.uid()) and reviewed_at is not null)));

create or replace function private.set_heritage_entry_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger heritage_entries_set_updated_at before update on public.heritage_entries
for each row execute function private.set_heritage_entry_updated_at();

create table private.heritage_entry_audit (
  id bigint generated always as identity primary key,
  entry_id uuid not null,
  actor_id uuid,
  action text not null,
  old_status text,
  new_status text,
  changed_at timestamptz not null default now()
);
revoke all on private.heritage_entry_audit from public, anon, authenticated;
create or replace function private.audit_heritage_entry_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.heritage_entry_audit(entry_id, actor_id, action, old_status, new_status)
  values (coalesce(new.id, old.id), auth.uid(), tg_op,
    case when tg_op = 'INSERT' then null else old.status end,
    case when tg_op = 'DELETE' then null else new.status end);
  if tg_op = 'DELETE' then return old; end if;\n  return new;
end;
$$;
create trigger heritage_entries_audit after insert or update or delete on public.heritage_entries
for each row execute function private.audit_heritage_entry_change();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('heritage-media','heritage-media',true,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "heritage_media_public_read" on storage.objects for select to anon, authenticated
using (bucket_id = 'heritage-media');
create policy "heritage_media_admin_upload" on storage.objects for insert to authenticated
with check (bucket_id = 'heritage-media' and (select private.has_parish_admin_access()));
create policy "heritage_media_admin_update" on storage.objects for update to authenticated
using (bucket_id = 'heritage-media' and (select private.has_parish_admin_access()))
with check (bucket_id = 'heritage-media' and (select private.has_parish_admin_access()));
create policy "heritage_media_admin_delete" on storage.objects for delete to authenticated
using (bucket_id = 'heritage-media' and (select private.has_parish_admin_access()));

-- Public readers use a narrow view so internal account IDs and review metadata stay private.
create or replace view public.published_heritage_entries
with (security_barrier = true, security_invoker = false)
as
select id, title, category, body, event_date, photo_path, photo_caption, 'published'::text as status, published_at, created_at
from public.heritage_entries
where status = 'published';
revoke all on public.published_heritage_entries from public, anon, authenticated;
grant select on public.published_heritage_entries to anon, authenticated;
comment on view public.published_heritage_entries is
  'Public-facing published heritage content only. Internal submitter and reviewer identifiers are not exposed.';
