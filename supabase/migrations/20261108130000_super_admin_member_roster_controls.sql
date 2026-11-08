-- Super Admin member roster controls.
-- Members are suspended, not deleted. Returning members go to pending review
-- and must pass through the existing membership approval workflow again.
-- Status changes are guarded by RLS and an invoker trigger; no public
-- SECURITY DEFINER RPC is exposed.

drop function if exists public.super_admin_remove_member(uuid);
drop function if exists public.super_admin_return_member_for_review(uuid);

drop policy if exists profiles_super_admin_manage_membership on public.profiles;
create policy profiles_super_admin_manage_membership
  on public.profiles
  for update
  to authenticated
  using (
    (select private.is_super_admin())
    and membership_status in ('approved', 'suspended')
  )
  with check (
    (select private.is_super_admin())
    and membership_status in ('suspended', 'pending')
  );

-- The trigger runs as the requesting administrator. Its audit insert is
-- permitted only for Super Admins by the dedicated RLS policy below.
grant insert on public.admin_activity_log to authenticated;
drop policy if exists admin_activity_log_super_admin_insert on public.admin_activity_log;
create policy admin_activity_log_super_admin_insert
  on public.admin_activity_log
  for insert
  to authenticated
  with check ((select private.is_super_admin()));

create or replace function private.guard_member_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if old.membership_status = new.membership_status then
    return new;
  end if;

  -- Preserve the existing application approval path and its existing audit trigger.
  if old.membership_status = 'pending' and new.membership_status = 'approved' then
    return new;
  end if;

  if not (
    (old.membership_status = 'approved' and new.membership_status = 'suspended')
    or
    (old.membership_status = 'suspended' and new.membership_status = 'pending')
  ) then
    raise exception 'Unsupported membership status transition.';
  end if;

  if v_actor is null or not private.is_super_admin() then
    raise exception 'Only a signed-in Super Admin may change active membership status.';
  end if;
  if old.id = v_actor then
    raise exception 'You cannot change your own membership through member management.';
  end if;
  if exists (
    select 1
    from public.admin_assignments aa
    where aa.user_id = old.id and aa.is_active = true
  ) then
    raise exception 'This member still holds an active administrator appointment. End or transfer that appointment first.';
  end if;

  insert into public.admin_activity_log(actor_id, action, target_user_id, details)
  values (
    v_actor,
    case
      when new.membership_status = 'suspended' then 'member_removed_from_active_roster'
      else 'member_returned_to_pending_review'
    end,
    old.id,
    pg_catalog.jsonb_build_object(
      'previous_status', old.membership_status,
      'new_status', new.membership_status,
      'prayer_house_id', old.primary_prayer_house_id
    )
  );

  return new;
end;
$$;

revoke all on function private.guard_member_status_transition() from public, anon, authenticated;
drop trigger if exists guard_member_status_transition on public.profiles;
create trigger guard_member_status_transition
  before update of membership_status on public.profiles
  for each row
  execute function private.guard_member_status_transition();

comment on function private.guard_member_status_transition() is
  'Restricts member removal and return-to-pending transitions to Super Admins, prevents self-removal and removal of active administrators, and records an audit entry.';
