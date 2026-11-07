create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null check (notification_type in ('announcement','event','chat','youth_voice')),
  title text not null,
  message text not null,
  target_url text not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_user_type_source_unique unique (user_id, notification_type, source_id)
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
grant select, update on public.notifications to authenticated;

create policy notifications_read_own
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_mark_own_read
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function private.create_content_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_type text;
  target_url text;
  target_title text;
  target_message text;
begin
  if old.status = 'published' or new.status <> 'published' then
    return new;
  end if;

  if tg_table_name = 'announcements' then
    if new.expires_at is not null and new.expires_at <= now() then
      return new;
    end if;
    target_type := 'announcement';
    target_url := 'announcements.html';
    target_title := 'New announcement: ' || new.title;
    target_message := left(new.body, 180);
  else
    if new.starts_at <= now() then
      return new;
    end if;
    target_type := 'event';
    target_url := 'events.html';
    target_title := 'New event: ' || new.title;
    target_message := left(new.description, 180);
  end if;

  insert into public.notifications (user_id, notification_type, title, message, target_url, source_id)
  select p.id, target_type, target_title, target_message, target_url, new.id
  from public.profiles p
  where p.membership_status = 'approved'
    and (
      new.scope = 'parish'
      or (new.scope = 'prayer_house' and p.primary_prayer_house_id = new.prayer_house_id)
    )
    and p.id <> coalesce(new.published_by, new.author_id)
  on conflict (user_id, notification_type, source_id) do nothing;

  return new;
end;
$$;

create or replace function private.create_chat_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.chat_rooms%rowtype;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  select * into target_room
  from public.chat_rooms
  where id = new.room_id;

  if not found then
    return new;
  end if;

  insert into public.notifications (user_id, notification_type, title, message, target_url, source_id)
  select p.id,
         'chat',
         'New message in ' || target_room.name,
         left(new.author_display_name || ': ' || new.body, 180),
         'chat.html?room=' || target_room.id::text,
         new.id
  from public.profiles p
  where p.membership_status = 'approved'
    and p.id <> new.author_id
    and (
      target_room.room_type = 'general'
      or (
        target_room.room_type = 'prayer_house'
        and (
          p.primary_prayer_house_id = target_room.prayer_house_id
          or exists (
            select 1 from public.admin_assignments aa
            where aa.user_id = p.id
              and aa.access_level = 'prayer_house_admin'
              and aa.prayer_house_id = target_room.prayer_house_id
              and aa.is_active = true
          )
          or exists (
            select 1 from public.admin_assignments aa
            where aa.user_id = p.id
              and aa.access_level in ('parish_admin','super_admin')
              and aa.is_active = true
          )
        )
      )
      or (
        target_room.room_type = 'leadership'
        and (
          exists (
            select 1 from public.admin_assignments aa
            where aa.user_id = p.id and aa.is_active = true
          )
          or exists (
            select 1 from public.appointments a
            where a.member_id = p.id
              and a.verification_status = 'verified'
              and (a.effective_from is null or a.effective_from <= current_date)
              and (a.effective_until is null or a.effective_until >= current_date)
          )
        )
      )
    )
  on conflict (user_id, notification_type, source_id) do nothing;

  return new;
end;
$$;

create or replace function private.create_youth_voice_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'published' or new.status <> 'published' then
    return new;
  end if;

  insert into public.notifications (user_id, notification_type, title, message, target_url, source_id)
  select p.id, 'youth_voice', 'New Youth Voice post', 'A new community voice has been published.', 'youth-voice.html', new.id
  from public.profiles p
  where p.membership_status = 'approved'
  on conflict (user_id, notification_type, source_id) do nothing;

  return new;
end;
$$;

create trigger notifications_after_announcement_publish
after update of status on public.announcements
for each row execute function private.create_content_notifications();

create trigger notifications_after_event_publish
after update of status on public.events
for each row execute function private.create_content_notifications();

create trigger notifications_after_chat_message
after insert on public.chat_messages
for each row execute function private.create_chat_notifications();

create trigger notifications_after_youth_voice_publish
after update of status on public.youth_voice_posts
for each row execute function private.create_youth_voice_notifications();

revoke all on function private.create_content_notifications() from public, anon, authenticated;
revoke all on function private.create_chat_notifications() from public, anon, authenticated;
revoke all on function private.create_youth_voice_notifications() from public, anon, authenticated;
