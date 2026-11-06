-- Migration 010: parish announcements, prayer-house notices and events.
-- Content is submitted by approved administrators, reviewed by parish leadership,
-- and published as a separate step. All browser access is constrained by RLS.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  body text not null check (char_length(btrim(body)) between 5 and 12000),
  scope text not null check (scope in ('parish', 'prayer_house')),
  prayer_house_id smallint references public.prayer_houses(id),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'published')),
  is_pinned boolean not null default false,
  expires_at timestamptz,
  author_id uuid not null references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  reviewed_at timestamptz,
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_scope_house_check check (
    (scope = 'parish' and prayer_house_id is null)
    or (scope = 'prayer_house' and prayer_house_id is not null)
  ),
  constraint announcements_review_metadata_check check (
    (reviewer_id is null and reviewed_at is null)
    or (reviewer_id is not null and reviewed_at is not null)
  ),
  constraint announcements_publish_metadata_check check (
    (published_by is null and published_at is null)
    or (published_by is not null and published_at is not null)
  )
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null check (char_length(btrim(description)) between 5 and 12000),
  scope text not null check (scope in ('parish', 'prayer_house')),
  prayer_house_id smallint references public.prayer_houses(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue text not null check (char_length(btrim(venue)) between 2 and 240),
  poster_path text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'published')),
  author_id uuid not null references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  reviewed_at timestamptz,
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_scope_house_check check (
    (scope = 'parish' and prayer_house_id is null)
    or (scope = 'prayer_house' and prayer_house_id is not null)
  ),
  constraint events_time_order_check check (ends_at is null or ends_at >= starts_at),
  constraint events_review_metadata_check check (
    (reviewer_id is null and reviewed_at is null)
    or (reviewer_id is not null and reviewed_at is not null)
  ),
  constraint events_publish_metadata_check check (
    (published_by is null and published_at is null)
    or (published_by is not null and published_at is not null)
  )
);

create table public.community_content_activity (
  id bigint generated always as identity primary key,
  content_type text not null check (content_type in ('announcement', 'event')),
  content_id uuid not null,
  actor_id uuid references public.profiles(id),
  action text not null,
  previous_status text,
  new_status text,
  created_at timestamptz not null default now()
);

create index announcements_public_feed_idx
  on public.announcements (scope, prayer_house_id, status, is_pinned desc, published_at desc);
create index announcements_expiry_idx
  on public.announcements (expires_at) where status = 'published';
create index events_public_feed_idx
  on public.events (scope, prayer_house_id, status, starts_at);
create index community_content_activity_content_idx
  on public.community_content_activity (content_type, content_id, created_at desc);

alter table public.announcements enable row level security;
alter table public.events enable row level security;
alter table public.community_content_activity enable row level security;

-- Public visitors may see published parish-wide content only.
create policy announcements_public_parish_read
  on public.announcements for select to anon
  using (scope = 'parish' and status = 'published'
    and (expires_at is null or expires_at > now()));

create policy events_public_parish_read
  on public.events for select to anon
  using (scope = 'parish' and status = 'published');

-- Approved members see parish-wide content and published content for their
-- primary prayer house. Authors and authorised administrators also see drafts
-- and items in the review queue within their permitted scope.
create policy announcements_authenticated_read
  on public.announcements for select to authenticated
  using (
    (author_id = (select auth.uid()))
    or (select private.has_parish_admin_access())
    or (
      status = 'published'
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.membership_status = 'approved'
          and (
            announcements.scope = 'parish'
            or p.primary_prayer_house_id = announcements.prayer_house_id
          )
      )
    )
    or (
      scope = 'prayer_house'
      and (select private.is_house_admin(announcements.prayer_house_id))
    )
  );

create policy events_authenticated_read
  on public.events for select to authenticated
  using (
    (author_id = (select auth.uid()))
    or (select private.has_parish_admin_access())
    or (
      status = 'published'
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.membership_status = 'approved'
          and (
            events.scope = 'parish'
            or p.primary_prayer_house_id = events.prayer_house_id
          )
      )
    )
    or (
      scope = 'prayer_house'
      and (select private.is_house_admin(events.prayer_house_id))
    )
  );

-- Only approved administrators can submit content. Parish-wide content is
-- reserved for parish administrators and Super Administrators.
create policy announcements_admin_insert
  on public.announcements for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status in ('draft', 'pending_approval')
    and reviewer_id is null and reviewed_at is null
    and published_by is null and published_at is null
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.membership_status = 'approved'
    )
    and (
      (scope = 'parish' and (select private.has_parish_admin_access()))
      or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
    )
  );

create policy events_admin_insert
  on public.events for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status in ('draft', 'pending_approval')
    and reviewer_id is null and reviewed_at is null
    and published_by is null and published_at is null
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.membership_status = 'approved'
    )
    and (
      (scope = 'parish' and (select private.has_parish_admin_access()))
      or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
    )
  );

-- Authors may edit only their own draft or rejected item, and may resubmit it.
create policy announcements_author_edit
  on public.announcements for update to authenticated
  using (
    author_id = (select auth.uid())
    and status in ('draft', 'rejected')
    and (
      (scope = 'parish' and (select private.has_parish_admin_access()))
      or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
    )
  )
  with check (
    author_id = (select auth.uid())
    and status in ('draft', 'pending_approval')
    and reviewer_id is null and reviewed_at is null
    and published_by is null and published_at is null
    and (
      (scope = 'parish' and (select private.has_parish_admin_access()))
      or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
    )
  );

create policy events_author_edit
  on public.events for update to authenticated
  using (
    author_id = (select auth.uid())
    and status in ('draft', 'rejected')
    and (
      (scope = 'parish' and (select private.has_parish_admin_access()))
      or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
    )
  )
  with check (
    author_id = (select auth.uid())
    and status in ('draft', 'pending_approval')
    and reviewer_id is null and reviewed_at is null
    and published_by is null and published_at is null
    and (
      (scope = 'parish' and (select private.has_parish_admin_access()))
      or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
    )
  );

-- Only parish-level administrators review pending submissions.
create policy announcements_parish_review
  on public.announcements for update to authenticated
  using (status = 'pending_approval' and (select private.has_parish_admin_access()))
  with check (
    status in ('approved', 'rejected')
    and reviewer_id = (select auth.uid())
    and reviewed_at is not null
    and published_by is null and published_at is null
    and (select private.has_parish_admin_access())
  );

create policy events_parish_review
  on public.events for update to authenticated
  using (status = 'pending_approval' and (select private.has_parish_admin_access()))
  with check (
    status in ('approved', 'rejected')
    and reviewer_id = (select auth.uid())
    and reviewed_at is not null
    and published_by is null and published_at is null
    and (select private.has_parish_admin_access())
  );

-- Publication is a separate action after approval.
create policy announcements_parish_publish
  on public.announcements for update to authenticated
  using (status = 'approved' and (select private.has_parish_admin_access()))
  with check (
    status = 'published'
    and published_by = (select auth.uid())
    and published_at is not null
    and (select private.has_parish_admin_access())
  );

create policy events_parish_publish
  on public.events for update to authenticated
  using (status = 'approved' and (select private.has_parish_admin_access()))
  with check (
    status = 'published'
    and published_by = (select auth.uid())
    and published_at is not null
    and (select private.has_parish_admin_access())
  );

create policy community_content_activity_parish_read
  on public.community_content_activity for select to authenticated
  using ((select private.has_parish_admin_access()));

-- A private trigger records content creation, submission, review and publication.
create or replace function private.audit_community_content_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  old_status text;
  new_status text;
  action_name text;
begin
  if tg_op = 'INSERT' then
    old_status := null;
    new_status := new.status;
    action_name := case when new.status = 'pending_approval'
      then 'submitted_for_approval' else 'draft_created' end;
  else
    old_status := old.status;
    new_status := new.status;
    if old.status is distinct from new.status then
      action_name := case new.status
        when 'pending_approval' then 'submitted_for_approval'
        when 'approved' then 'approved'
        when 'rejected' then 'rejected'
        when 'published' then 'published'
        else 'status_changed'
      end;
    else
      action_name := 'content_edited';
    end if;
  end if;

  insert into public.community_content_activity
    (content_type, content_id, actor_id, action, previous_status, new_status)
  values
    (case tg_table_name when 'announcements' then 'announcement' else 'event' end,
     new.id, auth.uid(), action_name, old_status, new_status);

  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function private.audit_community_content_change() from public, anon, authenticated;

create trigger announcements_audit_changes
  before insert or update on public.announcements
  for each row execute function private.audit_community_content_change();

create trigger events_audit_changes
  before insert or update on public.events
  for each row execute function private.audit_community_content_change();

-- Posters are publicly viewable after publication; only active, approved
-- administrators can upload, and uploads are stored under their own user folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-posters', 'community-posters', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy community_posters_admin_upload
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'community-posters'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.membership_status = 'approved'
    )
    and (
      (select private.has_parish_admin_access())
      or exists (
        select 1 from public.admin_assignments aa
        where aa.user_id = (select auth.uid())
          and aa.access_level = 'prayer_house_admin'
          and aa.is_active = true
      )
    )
  );

-- Explicit grants are required for new public-schema tables on current projects.
grant select on public.announcements, public.events to anon;
grant select, insert, update on public.announcements, public.events to authenticated;
grant select on public.community_content_activity to authenticated;
