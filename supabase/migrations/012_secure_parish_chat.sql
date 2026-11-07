-- Holy Family Youth Group: secure parish chat foundation (migration 012)
create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  room_type text not null check (room_type in ('general', 'prayer_house', 'leadership')),
  name text not null,
  prayer_house_id smallint references public.prayer_houses(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint chat_rooms_house_scope_check check ((room_type = 'prayer_house' and prayer_house_id is not null) or (room_type <> 'prayer_house' and prayer_house_id is null)),
  constraint chat_rooms_type_house_unique unique (room_type, prayer_house_id)
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete restrict,
  author_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  author_display_name text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null
);
create index if not exists chat_messages_room_created_idx on public.chat_messages(room_id, created_at desc);
create index if not exists chat_messages_author_created_idx on public.chat_messages(author_id, created_at desc);
alter table public.chat_rooms enable row level security;
alter table public.chat_messages enable row level security;
create or replace function private.is_approved_chat_member()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.membership_status = 'approved'); $$;
create or replace function private.can_access_chat_room(target_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select private.is_approved_chat_member() and exists (
    select 1 from public.chat_rooms r where r.id = target_room_id and (
      r.room_type = 'general'
      or (r.room_type = 'prayer_house' and (
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.primary_prayer_house_id = r.prayer_house_id)
        or private.is_house_admin(r.prayer_house_id)
      ))
      or (r.room_type = 'leadership' and (
        exists (select 1 from public.admin_assignments aa where aa.user_id = auth.uid() and aa.is_active = true)
        or exists (select 1 from public.appointments a where a.member_id = auth.uid() and a.verification_status = 'verified'
          and (a.effective_from is null or a.effective_from <= current_date)
          and (a.effective_until is null or a.effective_until >= current_date))
      ))
    )
  );
$$;
create or replace function private.can_moderate_chat_room(target_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select private.is_approved_chat_member() and exists (
    select 1 from public.chat_rooms r where r.id = target_room_id
      and (private.has_parish_admin_access() or (r.room_type = 'prayer_house' and private.is_house_admin(r.prayer_house_id)))
  );
$$;
create or replace function private.prepare_chat_message()
returns trigger language plpgsql security definer set search_path = public, private
as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or not private.is_approved_chat_member() then raise exception 'Only approved members can send chat messages'; end if;
    if not private.can_access_chat_room(new.room_id) then raise exception 'You are not allowed to access this chat room'; end if;
    select coalesce(nullif(btrim(p.display_name), ''), p.full_name) into v_name
    from public.profiles p where p.id = auth.uid() and p.membership_status = 'approved';
    if v_name is null then raise exception 'Your approved member profile could not be found'; end if;
    new.author_id := auth.uid(); new.author_display_name := v_name; new.body := btrim(new.body);
    new.created_at := now(); new.edited_at := null; new.deleted_at := null; new.deleted_by := null;
    if char_length(new.body) < 1 or char_length(new.body) > 2000 then raise exception 'Messages must contain between 1 and 2000 characters'; end if;
    return new;
  end if;
  if old.deleted_at is not null then raise exception 'This message has already been removed'; end if;
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is null or new.deleted_by is distinct from auth.uid()
       or new.body <> '[Message removed by an administrator]'
       or not private.can_moderate_chat_room(old.room_id) then raise exception 'You are not allowed to remove this message'; end if;
    new.edited_at := old.edited_at; return new;
  end if;
  if old.author_id <> auth.uid() or new.room_id <> old.room_id or new.author_id <> old.author_id
     or new.author_display_name <> old.author_display_name or new.created_at <> old.created_at
     or new.deleted_by is distinct from old.deleted_by then raise exception 'You can only edit your own message text'; end if;
  new.body := btrim(new.body);
  if char_length(new.body) < 1 or char_length(new.body) > 2000 then raise exception 'Messages must contain between 1 and 2000 characters'; end if;
  new.edited_at := now(); return new;
end;
$$;
drop trigger if exists chat_messages_prepare on public.chat_messages;
create trigger chat_messages_prepare before insert or update on public.chat_messages for each row execute function private.prepare_chat_message();
create or replace function public.moderate_chat_message(p_message_id uuid)
returns void language plpgsql security definer set search_path = public, private
as $$
declare v_room_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select m.room_id into v_room_id from public.chat_messages m where m.id = p_message_id and m.deleted_at is null;
  if v_room_id is null then raise exception 'Message not found or already removed'; end if;
  if not private.can_moderate_chat_room(v_room_id) then raise exception 'You are not allowed to moderate this chat room'; end if;
  update public.chat_messages set body = '[Message removed by an administrator]', deleted_at = now(), deleted_by = auth.uid()
  where id = p_message_id and deleted_at is null;
end;
$$;
drop policy if exists chat_rooms_read_authorised on public.chat_rooms;
create policy chat_rooms_read_authorised on public.chat_rooms for select to authenticated using (private.can_access_chat_room(id));
drop policy if exists chat_messages_read_authorised on public.chat_messages;
create policy chat_messages_read_authorised on public.chat_messages for select to authenticated using (private.can_access_chat_room(room_id));
drop policy if exists chat_messages_insert_authorised on public.chat_messages;
create policy chat_messages_insert_authorised on public.chat_messages for insert to authenticated with check (author_id = auth.uid() and private.can_access_chat_room(room_id));
drop policy if exists chat_messages_update_own on public.chat_messages;
create policy chat_messages_update_own on public.chat_messages for update to authenticated using (author_id = auth.uid() and deleted_at is null) with check (author_id = auth.uid() and deleted_at is null);
revoke all on public.chat_rooms from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
grant select on public.chat_rooms to authenticated;
grant select on public.chat_messages to authenticated;
grant insert (room_id, body) on public.chat_messages to authenticated;
grant update (body) on public.chat_messages to authenticated;
grant execute on function public.moderate_chat_message(uuid) to authenticated;
grant execute on function private.is_approved_chat_member() to authenticated;
grant execute on function private.can_access_chat_room(uuid) to authenticated;
grant execute on function private.can_moderate_chat_room(uuid) to authenticated;
insert into public.chat_rooms (room_type, name, prayer_house_id) values
('general','General Youth Chat',null),('prayer_house','Holy Family Nguviu',1),('prayer_house','Sacred Heart Kangenge',2),
('prayer_house','Our Lady of Assumption Gicherori',3),('prayer_house','St. Charles Kibugu',4),('prayer_house','St. John Chrysostom Kathangariri',5),
('prayer_house','Our Lady of Visitation Kianguchu',6),('prayer_house','St. Ruth Kathakwa',7),('prayer_house','St. Joseph Gatunduri',8),
('leadership','Leadership Chat',null) on conflict (room_type, prayer_house_id) do update set name = excluded.name;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
