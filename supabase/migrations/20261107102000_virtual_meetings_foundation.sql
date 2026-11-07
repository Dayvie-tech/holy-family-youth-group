create table if not exists public.virtual_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null default '' check (char_length(description) <= 3000),
  visibility text not null check (visibility in ('parish','prayer_house','invite_only')),
  prayer_house_id smallint references public.prayer_houses(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint virtual_meetings_time_order check (ends_at > starts_at),
  constraint virtual_meetings_scope_house check (
    (visibility = 'parish' and prayer_house_id is null)
    or (visibility in ('prayer_house','invite_only') and prayer_house_id is not null)
  )
);

create index if not exists virtual_meetings_starts_idx
  on public.virtual_meetings (starts_at asc) where status = 'scheduled';
create index if not exists virtual_meetings_house_idx
  on public.virtual_meetings (prayer_house_id, starts_at desc);

create table if not exists public.virtual_meeting_invitations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.virtual_meetings(id) on delete cascade,
  invited_user_id uuid references public.profiles(id) on delete cascade,
  guest_name text,
  guest_email text,
  invite_token_hash text,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint virtual_meeting_invitation_target check (
    (invited_user_id is not null and guest_name is null and guest_email is null and invite_token_hash is null)
    or
    (invited_user_id is null and guest_name is not null and guest_email is not null and invite_token_hash is not null)
  ),
  constraint virtual_meeting_guest_email_valid check (
    guest_email is null or guest_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  )
);

create index if not exists virtual_meeting_invites_meeting_idx
  on public.virtual_meeting_invitations (meeting_id, created_at desc);
create index if not exists virtual_meeting_invites_user_idx
  on public.virtual_meeting_invitations (invited_user_id) where invited_user_id is not null;

create or replace function private.can_manage_virtual_meeting(p_meeting_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.virtual_meetings vm
    where vm.id = p_meeting_id
      and (
        private.is_super_admin()
        or exists (
          select 1 from public.admin_assignments aa
          where aa.user_id = auth.uid()
            and aa.access_level = 'prayer_house_admin'
            and aa.is_active = true
            and aa.prayer_house_id = vm.prayer_house_id
            and vm.visibility in ('prayer_house','invite_only')
        )
      )
  );
$$;

create or replace function private.can_view_virtual_meeting(p_meeting_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.virtual_meetings vm
    join public.profiles p on p.id = auth.uid()
    where vm.id = p_meeting_id
      and p.membership_status = 'approved'
      and (
        private.can_manage_virtual_meeting(vm.id)
        or vm.visibility = 'parish'
        or (vm.visibility = 'prayer_house' and p.primary_prayer_house_id = vm.prayer_house_id)
        or exists (
          select 1 from public.virtual_meeting_invitations i
          where i.meeting_id = vm.id and i.invited_user_id = auth.uid()
            and i.revoked_at is null and i.expires_at > now()
        )
      )
  );
$$;

revoke all on function private.can_manage_virtual_meeting(uuid) from public, anon;
revoke all on function private.can_view_virtual_meeting(uuid) from public, anon;
grant execute on function private.can_manage_virtual_meeting(uuid) to authenticated;
grant execute on function private.can_view_virtual_meeting(uuid) to authenticated;

alter table public.virtual_meetings enable row level security;
alter table public.virtual_meeting_invitations enable row level security;
revoke all on public.virtual_meetings from anon, authenticated;
revoke all on public.virtual_meeting_invitations from anon, authenticated;
grant select, insert, update, delete on public.virtual_meetings to authenticated;
grant select, insert, update, delete on public.virtual_meeting_invitations to authenticated;

create policy virtual_meetings_select_authorised on public.virtual_meetings
for select to authenticated using (private.can_view_virtual_meeting(id));

create policy virtual_meetings_insert_authorised on public.virtual_meetings
for insert to authenticated with check (
  created_by = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.membership_status = 'approved')
  and (
    private.is_super_admin()
    or (
      visibility in ('prayer_house','invite_only') and prayer_house_id is not null
      and exists (
        select 1 from public.admin_assignments aa
        where aa.user_id = (select auth.uid()) and aa.access_level = 'prayer_house_admin'
          and aa.prayer_house_id = virtual_meetings.prayer_house_id and aa.is_active = true
      )
    )
  )
);

create policy virtual_meetings_update_authorised on public.virtual_meetings
for update to authenticated using (private.can_manage_virtual_meeting(id))
with check (private.can_manage_virtual_meeting(id));
create policy virtual_meetings_delete_authorised on public.virtual_meetings
for delete to authenticated using (private.can_manage_virtual_meeting(id));

create policy virtual_meeting_invitations_select_authorised on public.virtual_meeting_invitations
for select to authenticated using (
  private.can_manage_virtual_meeting(meeting_id) or invited_user_id = (select auth.uid())
);
create policy virtual_meeting_invitations_insert_authorised on public.virtual_meeting_invitations
for insert to authenticated with check (
  created_by = (select auth.uid()) and private.can_manage_virtual_meeting(meeting_id)
);
create policy virtual_meeting_invitations_update_authorised on public.virtual_meeting_invitations
for update to authenticated using (private.can_manage_virtual_meeting(meeting_id))
with check (private.can_manage_virtual_meeting(meeting_id));
create policy virtual_meeting_invitations_delete_authorised on public.virtual_meeting_invitations
for delete to authenticated using (private.can_manage_virtual_meeting(meeting_id));

alter table public.notifications drop constraint if exists notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
check (notification_type in ('announcement','event','chat','youth_voice','meeting'));

create or replace function private.create_virtual_meeting_notifications()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, notification_type, title, message, target_url, source_id)
  select p.id, 'meeting', 'New virtual meeting: ' || new.title,
         case when new.visibility = 'prayer_house' then 'A meeting has been scheduled for your prayer house.'
              else 'A new parish virtual meeting has been scheduled.' end,
         'virtual-meetings.html?meeting=' || new.id::text, new.id
  from public.profiles p
  where p.membership_status = 'approved' and p.id <> new.created_by
    and (new.visibility = 'parish'
      or (new.visibility = 'prayer_house' and p.primary_prayer_house_id = new.prayer_house_id))
  on conflict (user_id, notification_type, source_id) do nothing;
  return new;
end;
$$;

create or replace function private.create_virtual_meeting_invitation_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare meeting_title text;
begin
  if new.invited_user_id is null then return new; end if;
  select title into meeting_title from public.virtual_meetings where id = new.meeting_id;
  insert into public.notifications (user_id, notification_type, title, message, target_url, source_id)
  values (new.invited_user_id, 'meeting', 'You are invited: ' || coalesce(meeting_title,'Virtual meeting'),
          'You have received an invitation to a virtual meeting.',
          'virtual-meetings.html?meeting=' || new.meeting_id::text, new.id)
  on conflict (user_id, notification_type, source_id) do nothing;
  return new;
end;
$$;

revoke all on function private.create_virtual_meeting_notifications() from public, anon, authenticated;
revoke all on function private.create_virtual_meeting_invitation_notification() from public, anon, authenticated;
drop trigger if exists virtual_meeting_notify_members on public.virtual_meetings;
create trigger virtual_meeting_notify_members after insert on public.virtual_meetings
for each row execute function private.create_virtual_meeting_notifications();
drop trigger if exists virtual_meeting_notify_invitee on public.virtual_meeting_invitations;
create trigger virtual_meeting_notify_invitee after insert on public.virtual_meeting_invitations
for each row execute function private.create_virtual_meeting_invitation_notification();

create or replace function public.get_guest_virtual_meeting_invite(p_token_hash text)
returns table (meeting_id uuid,title text,description text,starts_at timestamptz,ends_at timestamptz,status text,guest_name text)
language sql stable security definer set search_path = ''
as $$
  select vm.id,vm.title,vm.description,vm.starts_at,vm.ends_at,vm.status,i.guest_name
  from public.virtual_meeting_invitations i
  join public.virtual_meetings vm on vm.id=i.meeting_id
  where i.invite_token_hash=p_token_hash and i.invited_user_id is null
    and i.revoked_at is null and i.expires_at>now() and vm.status='scheduled'
  limit 1;
$$;
revoke all on function public.get_guest_virtual_meeting_invite(text) from public;
grant execute on function public.get_guest_virtual_meeting_invite(text) to anon, authenticated;
