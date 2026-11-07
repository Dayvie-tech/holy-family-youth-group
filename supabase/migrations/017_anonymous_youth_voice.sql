-- Migration 017: anonymous, moderated Youth Voice.
-- Submitter IDs are retained only in the unexposed private schema for abuse prevention.
-- Neither members nor moderators can retrieve contributor identities.

create table public.youth_voice_posts (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('idea', 'concern', 'reflection', 'question')),
  body text not null check (char_length(btrim(body)) between 10 and 4000),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'published', 'rejected', 'hidden')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  constraint youth_voice_review_metadata_check
    check (status = 'pending_review' or reviewed_at is not null),
  constraint youth_voice_publish_metadata_check
    check ((status = 'published' and published_at is not null) or
           (status <> 'published' and published_at is null))
);
create index youth_voice_posts_feed_idx
  on public.youth_voice_posts (status, published_at desc, created_at desc);

create table private.youth_voice_submitters (
  submission_id uuid primary key references public.youth_voice_posts(id) on delete cascade,
  submitter_id uuid not null references public.profiles(id) on delete cascade,
  submitted_at timestamptz not null default now()
);
create index youth_voice_submitters_rate_idx
  on private.youth_voice_submitters (submitter_id, submitted_at desc);

create table private.youth_voice_moderation_log (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.youth_voice_posts(id) on delete cascade,
  moderator_id uuid not null references public.profiles(id),
  previous_status text not null,
  new_status text not null,
  created_at timestamptz not null default now()
);
create index youth_voice_moderation_log_submission_idx
  on private.youth_voice_moderation_log (submission_id, created_at desc);
create index youth_voice_moderation_log_moderator_idx
  on private.youth_voice_moderation_log (moderator_id);

alter table public.youth_voice_posts enable row level security;
alter table private.youth_voice_submitters enable row level security;
alter table private.youth_voice_moderation_log enable row level security;

revoke all on public.youth_voice_posts from anon, authenticated;
grant select, insert on public.youth_voice_posts to authenticated;
grant update (status, reviewed_at, published_at) on public.youth_voice_posts to authenticated;
revoke all on private.youth_voice_submitters from public, anon, authenticated;
revoke all on private.youth_voice_moderation_log from public, anon, authenticated;

create policy youth_voice_read_scoped
  on public.youth_voice_posts for select to authenticated
  using (
    (status = 'published' and (select private.is_approved_chat_member()))
    or (select private.has_parish_admin_access())
  );
create policy youth_voice_approved_member_submit
  on public.youth_voice_posts for insert to authenticated
  with check (
    status = 'pending_review'
    and reviewed_at is null
    and published_at is null
    and (select private.is_approved_chat_member())
  );
create policy youth_voice_parish_admin_moderate
  on public.youth_voice_posts for update to authenticated
  using ((select private.has_parish_admin_access()))
  with check (
    (select private.has_parish_admin_access())
    and status in ('pending_review', 'published', 'rejected', 'hidden')
  );

create or replace function private.capture_youth_voice_submitter()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_recent_count integer;
begin
  if v_actor is null then raise exception 'Sign in with an approved member account to submit Youth Voice.'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_actor and p.membership_status = 'approved') then
    raise exception 'Only approved youth members can submit Youth Voice.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_actor::text), 92017);
  select count(*) into v_recent_count from private.youth_voice_submitters s
    where s.submitter_id = v_actor and s.submitted_at > pg_catalog.now() - interval '24 hours';
  if v_recent_count >= 3 then
    raise exception 'You have reached the limit of three Youth Voice submissions in 24 hours. Please try again later.';
  end if;
  insert into private.youth_voice_submitters (submission_id, submitter_id) values (new.id, v_actor);
  return new;
end;
$$;
revoke all on function private.capture_youth_voice_submitter() from public, anon, authenticated;
create trigger youth_voice_capture_submitter after insert on public.youth_voice_posts
  for each row execute function private.capture_youth_voice_submitter();

create or replace function private.audit_youth_voice_moderation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if new.status is distinct from old.status then
    if v_actor is null then raise exception 'A signed-in moderator is required.'; end if;
    insert into private.youth_voice_moderation_log
      (submission_id, moderator_id, previous_status, new_status)
    values (new.id, v_actor, old.status, new.status);
  end if;
  return new;
end;
$$;
revoke all on function private.audit_youth_voice_moderation() from public, anon, authenticated;
create trigger youth_voice_moderation_audit after update of status on public.youth_voice_posts
  for each row execute function private.audit_youth_voice_moderation();

comment on table public.youth_voice_posts is
  'Anonymous Youth Voice submissions. Submitter identity is kept separately in the unexposed private schema and is never shown to members or moderators.';
comment on table private.youth_voice_submitters is
  'Private anti-abuse mapping for Youth Voice submissions. Never expose through the Data API or moderator UI.';
comment on table private.youth_voice_moderation_log is
  'Private audit trail of Youth Voice moderation status changes.';
