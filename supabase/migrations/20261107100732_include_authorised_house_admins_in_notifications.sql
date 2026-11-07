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
      or (
        new.scope = 'prayer_house'
        and (
          p.primary_prayer_house_id = new.prayer_house_id
          or exists (
            select 1 from public.admin_assignments aa
            where aa.user_id = p.id
              and aa.access_level = 'prayer_house_admin'
              and aa.prayer_house_id = new.prayer_house_id
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
    )
    and p.id <> coalesce(new.published_by, new.author_id)
  on conflict (user_id, notification_type, source_id) do nothing;

  return new;
end;
$$;
