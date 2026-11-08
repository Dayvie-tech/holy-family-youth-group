-- Super Admin member roster controls.
-- Members are suspended, not deleted. Returning members go to pending review
-- and must pass through the existing membership approval workflow again.

create or replace function public.super_admin_remove_member(p_target_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_house_id smallint;
begin
  if v_actor is null then
    raise exception 'You must be signed in to manage membership.';
  end if;
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin may remove a member from active membership.';
  end if;
  if p_target_member_id is null then
    raise exception 'Choose a member to remove.';
  end if;
  if p_target_member_id = v_actor then
    raise exception 'You cannot remove your own account through member management.';
  end if;

  select p.membership_status, p.primary_prayer_house_id
    into v_status, v_house_id
  from public.profiles p
  where p.id = p_target_member_id
  for update;

  if not found then
    raise exception 'Member account not found.';
  end if;
  if v_status <> 'approved' then
    raise exception 'Only an approved member can be removed from active membership.';
  end if;
  if exists (
    select 1 from public.admin_assignments aa
    where aa.user_id = p_target_member_id and aa.is_active = true
  ) then
    raise exception 'This member still holds an active administrator appointment. End or transfer that appointment first.';
  end if;

  update public.profiles
  set membership_status = 'suspended',
      updated_at = pg_catalog.now()
  where id = p_target_member_id;

  insert into public.admin_activity_log(actor_id, action, target_user_id, details)
  values (
    v_actor,
    'member_removed_from_active_roster',
    p_target_member_id,
    pg_catalog.jsonb_build_object(
      'previous_status', v_status,
      'new_status', 'suspended',
      'prayer_house_id', v_house_id
    )
  );
end;
$$;

create or replace function public.super_admin_return_member_for_review(p_target_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_house_id smallint;
begin
  if v_actor is null then
    raise exception 'You must be signed in to manage membership.';
  end if;
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin may return a removed member to pending review.';
  end if;
  if p_target_member_id is null then
    raise exception 'Choose a member to return to review.';
  end if;
  if p_target_member_id = v_actor then
    raise exception 'You cannot change your own membership through member management.';
  end if;

  select p.membership_status, p.primary_prayer_house_id
    into v_status, v_house_id
  from public.profiles p
  where p.id = p_target_member_id
  for update;

  if not found then
    raise exception 'Member account not found.';
  end if;
  if v_status <> 'suspended' then
    raise exception 'Only a removed member can be returned to pending review.';
  end if;
  if exists (
    select 1 from public.admin_assignments aa
    where aa.user_id = p_target_member_id and aa.is_active = true
  ) then
    raise exception 'This member still holds an active administrator appointment. End or transfer that appointment first.';
  end if;

  update public.profiles
  set membership_status = 'pending',
      updated_at = pg_catalog.now()
  where id = p_target_member_id;

  insert into public.admin_activity_log(actor_id, action, target_user_id, details)
  values (
    v_actor,
    'member_returned_to_pending_review',
    p_target_member_id,
    pg_catalog.jsonb_build_object(
      'previous_status', v_status,
      'new_status', 'pending',
      'prayer_house_id', v_house_id
    )
  );
end;
$$;

revoke all on function public.super_admin_remove_member(uuid) from public, anon;
revoke all on function public.super_admin_return_member_for_review(uuid) from public, anon;
grant execute on function public.super_admin_remove_member(uuid) to authenticated;
grant execute on function public.super_admin_return_member_for_review(uuid) to authenticated;

comment on function public.super_admin_remove_member(uuid) is
  'Super Admin-only soft removal from active membership. Preserves the auth account and all historical records.';
comment on function public.super_admin_return_member_for_review(uuid) is
  'Super Admin-only transition from suspended to pending; existing approval workflow must approve the member again.';
