-- Holy Family Youth Group
-- Migration 002: RLS policy planning and foreign-key index improvements.

drop policy if exists profiles_read_self_or_authorised_admin on public.profiles;
create policy profiles_read_self_or_authorised_admin
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.has_parish_admin_access())
    or (
      primary_prayer_house_id is not null
      and (select private.is_house_admin(primary_prayer_house_id))
    )
  );

drop policy if exists admin_assignments_read_self_or_super_admin on public.admin_assignments;
create policy admin_assignments_read_self_or_super_admin
  on public.admin_assignments for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_super_admin())
  );

drop policy if exists admin_assignments_super_admin_manage on public.admin_assignments;
drop policy if exists admin_assignments_super_admin_insert on public.admin_assignments;
create policy admin_assignments_super_admin_insert
  on public.admin_assignments for insert
  to authenticated
  with check ((select private.is_super_admin()));

drop policy if exists admin_assignments_super_admin_update on public.admin_assignments;
create policy admin_assignments_super_admin_update
  on public.admin_assignments for update
  to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

drop policy if exists admin_assignments_super_admin_delete on public.admin_assignments;
create policy admin_assignments_super_admin_delete
  on public.admin_assignments for delete
  to authenticated
  using ((select private.is_super_admin()));

drop policy if exists appointments_read_self_or_authorised_admin on public.appointments;
create policy appointments_read_self_or_authorised_admin
  on public.appointments for select
  to authenticated
  using (
    member_id = (select auth.uid())
    or (select private.has_parish_admin_access())
    or (
      prayer_house_id is not null
      and (select private.is_house_admin(prayer_house_id))
    )
  );

drop policy if exists appointments_submit_own_pending_claim on public.appointments;
create policy appointments_submit_own_pending_claim
  on public.appointments for insert
  to authenticated
  with check (
    member_id = (select auth.uid())
    and verification_status = 'pending'
    and verified_by is null
    and verified_at is null
  );

create index if not exists admin_assignments_assigned_by_idx
  on public.admin_assignments (assigned_by);
create index if not exists admin_assignments_house_active_idx
  on public.admin_assignments (prayer_house_id, is_active);
create index if not exists appointments_verified_by_idx
  on public.appointments (verified_by);
