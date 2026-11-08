-- Restrict Leadership Chat access to current leaders and authorised administrators.
-- Also revoke access immediately when a verified appointment is ended.

create or replace function private.has_active_leadership_appointment(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.appointments a
    where a.member_id = target_user_id
      and a.office_name in (
        'Chairperson', 'Vice Chairperson', 'Secretary', 'Vice Secretary',
        'Organizing Secretary', 'Treasurer', 'Project Manager',
        'Assistant Project Manager', 'Games Coordinator', 'Catechist',
        'Patron', 'Matron', 'Chaplain'
      )
      and a.scope in ('parish', 'prayer_house')
      and a.verification_status = 'verified'
      and (a.effective_from is null or a.effective_from <= current_date)
      and (a.effective_until is null or a.effective_until > current_date)
  );
$function$;

revoke all on function private.has_active_leadership_appointment(uuid)
  from public, anon, authenticated;

create or replace function private.can_access_chat_room(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.is_approved_chat_member() and exists (
    select 1
    from public.chat_rooms r
    where r.id = target_room_id
      and (
        r.room_type = 'general'
        or (
          r.room_type = 'prayer_house'
          and (
            exists (
              select 1 from public.profiles p
              where p.id = auth.uid()
                and p.primary_prayer_house_id = r.prayer_house_id
            )
            or private.is_house_admin(r.prayer_house_id)
          )
        )
        or (
          r.room_type = 'leadership'
          and (
            exists (
              select 1 from public.admin_assignments aa
              where aa.user_id = auth.uid() and aa.is_active = true
            )
            or private.has_active_leadership_appointment(auth.uid())
          )
        )
        or (
          r.room_type = 'patron_matron'
          and exists (
            select 1
            from public.appointments a
            where a.member_id = auth.uid()
              and a.office_name in ('Patron', 'Matron', 'Chaplain')
              and a.verification_status = 'verified'
              and (a.effective_from is null or a.effective_from <= current_date)
              and (a.effective_until is null or a.effective_until > current_date)
          )
        )
      )
  );
$function$;

-- Keep chat notification recipients aligned with actual room permissions.
create or replace function private.create_chat_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_room public.chat_rooms%rowtype;
  notification_text text;
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

  notification_text := case
    when new.message_type = 'audio' then new.author_display_name || ': Sent a voice note'
    else left(new.author_display_name || ': ' || new.body, 180)
  end;

  insert into public.notifications (
    user_id, notification_type, title, message, target_url, source_id
  )
  select
    p.id, 'chat', 'New message in ' || target_room.name,
    notification_text, 'chat.html?room=' || target_room.id::text, new.id
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
              and aa.access_level in ('parish_admin', 'super_admin')
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
          or private.has_active_leadership_appointment(p.id)
        )
      )
    )
  on conflict (user_id, notification_type, source_id) do nothing;

  return new;
end;
$function$;

-- Old chat notification previews must not remain visible after a member loses room access.
drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own
  on public.notifications
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (
      notification_type <> 'chat'
      or (
        target_url ~ '^chat\.html\?room=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and private.can_access_chat_room(substring(target_url from 16)::uuid)
      )
    )
  );
