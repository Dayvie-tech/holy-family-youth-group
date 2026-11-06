-- Holy Family Youth Group
-- Migration 003: secure profile creation and optional appointment claims on signup.
-- User metadata is treated only as untrusted profile input, never as authorization.

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_phone text;
  v_house_id smallint;
  v_scope text;
  v_office text;
  v_valid_office boolean := false;
begin
  v_name := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  if v_name is null then
    v_name := coalesce(nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''), 'New member');
  end if;

  v_phone := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');

  if coalesce(new.raw_user_meta_data ->> 'prayer_house_id', '') ~ '^[1-8]$' then
    select ph.id into v_house_id
    from public.prayer_houses ph
    where ph.id = (new.raw_user_meta_data ->> 'prayer_house_id')::smallint
      and ph.is_active = true;
  end if;

  insert into public.profiles (
    id, full_name, primary_prayer_house_id, phone_private, membership_status
  )
  values (new.id, v_name, v_house_id, v_phone, 'pending');

  -- A claimed office is stored only as an unverified appointment. It never
  -- grants application access or an administrator role.
  v_scope := new.raw_user_meta_data ->> 'claim_scope';
  v_office := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'claim_office', '')), '');

  if v_office is not null and v_scope in ('parish', 'prayer_house') then
    if v_scope = 'parish' then
      v_valid_office := v_office in (
        'Moderator', 'Vice Moderator', 'Secretary', 'Vice Secretary',
        'Treasurer', 'Organizing Secretary', 'Project Manager',
        'Assistant Project Manager', 'Games Coordinator', 'Catechist'
      );
      if v_valid_office then
        insert into public.appointments (member_id, office_name, scope, prayer_house_id)
        values (new.id, v_office, 'parish', null);
      end if;
    elsif v_scope = 'prayer_house' and v_house_id is not null then
      v_valid_office := v_office in (
        'Chairperson', 'Vice Chairperson', 'Secretary', 'Vice Secretary',
        'Treasurer', 'Organizing Secretary', 'Project Manager',
        'Assistant Project Manager', 'Games Coordinator', 'Catechist'
      );
      if v_valid_office then
        insert into public.appointments (member_id, office_name, scope, prayer_house_id)
        values (new.id, v_office, 'prayer_house', v_house_id);
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();
