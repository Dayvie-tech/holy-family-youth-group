-- Migration 011: tighten content grants and consolidate update policies.
-- The project has permissive legacy default grants; explicitly keep only the
-- operations required by this module. RLS remains the row-level boundary.

revoke all privileges on table public.announcements from anon, authenticated;
revoke all privileges on table public.events from anon, authenticated;
revoke all privileges on table public.community_content_activity from anon, authenticated;

grant select on public.announcements, public.events to anon;
grant select, insert, update on public.announcements, public.events to authenticated;
grant select on public.community_content_activity to authenticated;

drop policy if exists announcements_author_edit on public.announcements;
drop policy if exists announcements_parish_review on public.announcements;
drop policy if exists announcements_parish_publish on public.announcements;

create policy announcements_controlled_update
  on public.announcements for update to authenticated
  using (
    (
      author_id = (select auth.uid())
      and status in ('draft', 'rejected')
      and (
        (scope = 'parish' and (select private.has_parish_admin_access()))
        or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
      )
    )
    or (
      status = 'pending_approval'
      and author_id <> (select auth.uid())
      and (select private.has_parish_admin_access())
    )
    or (
      status = 'approved'
      and (select private.has_parish_admin_access())
    )
  )
  with check (
    (
      author_id = (select auth.uid())
      and status in ('draft', 'pending_approval')
      and reviewer_id is null and reviewed_at is null
      and published_by is null and published_at is null
      and (
        (scope = 'parish' and (select private.has_parish_admin_access()))
        or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
      )
    )
    or (
      status in ('approved', 'rejected')
      and reviewer_id = (select auth.uid())
      and reviewed_at is not null
      and published_by is null and published_at is null
      and (select private.has_parish_admin_access())
    )
    or (
      status = 'published'
      and published_by = (select auth.uid())
      and published_at is not null
      and (select private.has_parish_admin_access())
    )
  );

drop policy if exists events_author_edit on public.events;
drop policy if exists events_parish_review on public.events;
drop policy if exists events_parish_publish on public.events;

create policy events_controlled_update
  on public.events for update to authenticated
  using (
    (
      author_id = (select auth.uid())
      and status in ('draft', 'rejected')
      and (
        (scope = 'parish' and (select private.has_parish_admin_access()))
        or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
      )
    )
    or (
      status = 'pending_approval'
      and author_id <> (select auth.uid())
      and (select private.has_parish_admin_access())
    )
    or (
      status = 'approved'
      and (select private.has_parish_admin_access())
    )
  )
  with check (
    (
      author_id = (select auth.uid())
      and status in ('draft', 'pending_approval')
      and reviewer_id is null and reviewed_at is null
      and published_by is null and published_at is null
      and (
        (scope = 'parish' and (select private.has_parish_admin_access()))
        or (scope = 'prayer_house' and (select private.is_house_admin(prayer_house_id)))
      )
    )
    or (
      status in ('approved', 'rejected')
      and reviewer_id = (select auth.uid())
      and reviewed_at is not null
      and published_by is null and published_at is null
      and (select private.has_parish_admin_access())
    )
    or (
      status = 'published'
      and published_by = (select auth.uid())
      and published_at is not null
      and (select private.has_parish_admin_access())
    )
  );

-- Cover each foreign-key lookup. The feed indexes serve ordering/filtering,
-- while these narrow indexes support joins and referential checks.
create index if not exists announcements_author_id_idx on public.announcements(author_id);
create index if not exists announcements_prayer_house_id_idx on public.announcements(prayer_house_id);
create index if not exists announcements_reviewer_id_idx on public.announcements(reviewer_id);
create index if not exists announcements_published_by_idx on public.announcements(published_by);
create index if not exists events_author_id_idx on public.events(author_id);
create index if not exists events_prayer_house_id_idx on public.events(prayer_house_id);
create index if not exists events_reviewer_id_idx on public.events(reviewer_id);
create index if not exists events_published_by_idx on public.events(published_by);
create index if not exists community_content_activity_actor_id_idx on public.community_content_activity(actor_id);
